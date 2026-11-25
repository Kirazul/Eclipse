/**
 * One model in the scene graph: its meshes as retail batches, its bones, its mixer,
 * its look. Nothing here touches the live scene until the engine adds `root`, so a
 * figure can be built, compiled and posed entirely off stage. Owns all its GPU data.
 */
import {
  AnimationMixer,
  Group,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
  type Skeleton,
  type SkinnedMesh,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import type { SubmeshExtras } from "@eclipse/format";
import { GeosetLook } from "../logic/geosets";
import type { DrawnLayer } from "../wow/composite";
import { boneIndex } from "../logic/pivots";
import { BatchMaterial } from "../wow/material";
import { FxRuntime } from "../wow/fx";
import { batchRenderOrder } from "../wow/programs";
import { whiteTexture } from "./loaders";
import type { ModelAssets } from "./assets";
import type { FigureEmitters } from "../render/emitters";
import type { PhysicsRig } from "../physics/rig";

const NO_EXTRAS: SubmeshExtras = {
  hash: 0,
  geoset: 0,
  units: [],
  shader: 0,
  blend: 0,
  flags: 0,
  priority: 0,
  color: -1,
  opacity: -1,
};

export interface Part {
  mesh: Mesh;
  material: BatchMaterial;
  extras: SubmeshExtras;
  /** Wanted by the look. */
  shown: boolean;
  /** The Model Parts toggle: null follows the look. */
  userVisible: boolean | null;
  /** Its textures are in. A part never draws before they are. */
  ready: boolean;
  /** Units waiting on a texture that is still coming. */
  waiting: { unit: number; tex: number; wrapS: boolean; wrapT: boolean }[];
  /** Units that sample the runtime composite. */
  usesComposite: boolean[];
  /** Units reading a texture the model leaves to what it wears: a cloak's type 2 on geoset 15xx. */
  worn: { unit: number; type: number }[];
  /**
   * Units nothing has painted. A batch sampling one is not drawn at all: the white
   * placeholder would show as a flat sheet, and retail draws nothing it cannot bind
   * (Eclipse measured it in game: midnight_convert.py, the Oblivion Guise set).
   */
  blank: Set<number>;
  wireframe: boolean;
}

export interface FigureOptions {
  /** Draw order layer: 0 body, 1 collections, 2 attached models. */
  layer?: number;
  /** Prefix for node names: attached models hang under the body's bones, and names must not collide. */
  namePrefix?: string;
}

const UNIT_KEYS = ["uT0", "uT1", "uT2"] as const;
const _size = new Vector3();
const _mat = new Matrix4();

export class Figure {
  readonly root = new Group();
  readonly parts: Part[] = [];
  readonly byHash = new Map<number, Part[]>();
  readonly bones = new Map<string, Object3D>();
  readonly mixer: AnimationMixer;
  readonly fx: FxRuntime;
  readonly look: GeosetLook;
  skeleton: Skeleton | null = null;
  /** A body's skeleton this collection borrows: it is not this figure's to dispose. */
  foreignSkeleton: Skeleton | null = null;
  /** Retail bone index -> this model's own node. Empty for a model with no skin. */
  readonly boneList: Object3D[] = [];
  /** The body a collection is rebound to: its bones win over this figure's own. */
  host: Figure | null = null;
  /** Particles and ribbons. Null: it has none, or nobody asked. */
  emitters: FigureEmitters | null = null;
  /** The `.phys` simulation, once fetched. */
  rig: PhysicsRig | null = null;
  /** The grid's frame counter: a piece shared by cells advances once per frame. */
  poseStamp = -1;
  /** The look's composite, nothing worn over it. The wardrobe can show others; this one stays. */
  baseComposite: WebGLRenderTarget | null = null;
  /** The look's own layers, once a choice has changed them. Null: the manifest's. */
  drawnLayers: DrawnLayer[] | null = null;
  /** Names the layers above: the wardrobe keys its composites on it. */
  lookKey = "";
  private currentComposite: Texture | null = null;
  /** The textures a look put on this figure's types, for a part to share. */
  private readonly typeTextures = new Map<number, Texture | null>();
  /** Skinned customization parts: they draw with this body's composite, hair and fur. */
  private readonly followers: Figure[] = [];
  /** Bones a face bone set moved: their inverse-bind slot holds its matrix. */
  private readonly faceBones = new Set<number>();
  private readonly ownedTargets: WebGLRenderTarget[] = [];
  private readonly namePrefix: string;
  private disposed = false;
  /** This piece's own joints, hung on the body's bones: they leave with it. */
  readonly adopted: Object3D[] = [];
  /** A customizer's composite belongs to its cache, the first look's to this figure. */
  private ownsBase = true;
  /** Set when a late texture makes a part ready, so the engine can redraw. */
  onChange: (() => void) | null = null;

  constructor(
    readonly assets: ModelAssets,
    opts: FigureOptions = {},
  ) {
    this.namePrefix = opts.namePrefix ?? "";
    const layer = opts.layer ?? 0;
    const scene = assets.gltf.scene;
    this.root.name = assets.manifest.id;
    this.root.add(scene);

    const meshes: Mesh[] = [];
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
      else if (o.name) {
        if (this.namePrefix) o.name = this.namePrefix + o.name;
        this.bones.set(o.name, o);
      }
    });

    const pivots = assets.manifest.pivots;
    if (pivots) {
      for (const [name, node] of this.bones) {
        const bone = boneIndex(name);
        if (bone >= 0) applyPivot(node, pivots[bone * 3] ?? 0, pivots[bone * 3 + 1] ?? 0, pivots[bone * 3 + 2] ?? 0);
      }
    }

    const ids = new Set<number>();
    meshes.forEach((mesh, order) => {
      const raw = (mesh.material as Material).userData as Partial<SubmeshExtras> | undefined;
      const extras: SubmeshExtras = { ...NO_EXTRAS, ...raw, hash: raw?.hash ?? order };
      (mesh.material as Material).dispose();
      const material = new BatchMaterial(extras, !!(mesh.geometry as BufferGeometry).getAttribute("uv1"));
      mesh.material = material;
      mesh.frustumCulled = false;
      mesh.renderOrder = batchRenderOrder(extras.priority, order, layer);
      mesh.castShadow = !material.state.blended;
      ids.add(extras.geoset);

      if (!(mesh.geometry as BufferGeometry).getAttribute("normal")) {
        (mesh.geometry as BufferGeometry).computeVertexNormals();
      }

      const part: Part = {
        mesh,
        material,
        extras,
        shown: false,
        userVisible: null,
        ready: true,
        waiting: [],
        usesComposite: [],
        worn: [],
        blank: new Set(),
        wireframe: false,
      };
      this.bindUnits(part);
      this.parts.push(part);
      const same = this.byHash.get(extras.hash);
      if (same) same.push(part);
      else this.byHash.set(extras.hash, [part]);

      const skinned = mesh as SkinnedMesh;
      if (skinned.isSkinnedMesh) {
        // Nothing culls these and every batch has its own render order, so the sphere only feeds
        // a depth sort that never decides. three would skin every vertex on the CPU for it, on the
        // first frame: 300 ms on a big mount, measured. The file's own bounds answer for free.
        const sphere = (mesh.geometry as BufferGeometry).boundingSphere;
        if (sphere) skinned.boundingSphere = sphere;
        // Primitives of one skin share one bone texture.
        if (!this.skeleton) this.skeleton = skinned.skeleton;
        else if (sameBones(this.skeleton, skinned.skeleton)) {
          skinned.skeleton.dispose();
          skinned.skeleton = this.skeleton;
        }
      }
    });

    if (this.skeleton) this.boneList.push(...this.skeleton.bones);

    this.look = new GeosetLook(assets.manifest.defaultGeosets, ids);
    this.applyGeosets(this.look.visible);

    assets.onTexture = (index) => this.textureArrived(index);
    this.mixer = new AnimationMixer(this.root);
    const targets = this.parts.map((p) => ({ extras: p.extras, uniforms: p.material.uniforms as never }));
    this.fx = new FxRuntime(assets.fx, targets);
    this.fx.setClip(assets.defaultClip);
    this.fx.update(0, 0);
  }

  get id(): string {
    return this.assets.manifest.id;
  }

  /** The node that moves retail bone `index` of this model, on the body it is worn on if any. */
  boneAt(index: number): Object3D | null {
    const own = this.boneList[index];
    if (!own) return null;
    return this.host?.bones.get(own.name) ?? own;
  }

  /** A clip's tracks name nodes; an attached model's nodes carry a prefix. */
  adaptClip<T extends { tracks: { name: string }[] }>(clip: T): T {
    if (this.namePrefix) {
      for (const track of clip.tracks) {
        if (!track.name.startsWith(this.namePrefix)) track.name = this.namePrefix + track.name;
      }
    }
    return clip;
  }

  private bindUnits(part: Part): void {
    const { assets } = this;
    const { units } = part.extras;
    const u = part.material.uniforms;
    for (let i = 0; i < 3; i++) u[UNIT_KEYS[i]!].value = whiteTexture();
    units.forEach((unit, i) => {
      if (i >= 3 || unit.tex < 0) return;
      const entry = assets.manifest.textures[unit.tex];
      if (!entry) return;
      if (!entry.key) {
        // Produced at runtime. Only a type 1 has a composite to read.
        if (entry.type === 1) part.usesComposite[i] = true;
        else {
          part.worn.push({ unit: i, type: entry.type });
          part.blank.add(i);
        }
        return;
      }
      const texture = assets.textureFor(unit.tex, unit.wrapS, unit.wrapT);
      if (texture) {
        u[UNIT_KEYS[i]!].value = texture;
        if (i === 0) part.material.setShadowCut(texture);
      } else {
        part.ready = false;
        part.waiting.push({ unit: i, tex: unit.tex, wrapS: unit.wrapS, wrapT: unit.wrapT });
      }
    });
    if (part.usesComposite.some(Boolean)) part.ready = false;
  }

  private textureArrived(index: number): void {
    if (this.disposed) return;
    let changed = false;
    for (const part of this.parts) {
      const still = part.waiting.filter((w) => {
        if (w.tex !== index) return true;
        const texture = this.assets.textureFor(index, w.wrapS, w.wrapT);
        if (texture) {
          // Uploaded now, so showing this part later costs nothing.
          this.assets.env.renderer.initTexture(texture);
          part.material.uniforms[UNIT_KEYS[w.unit]!].value = texture;
          if (w.unit === 0) part.material.setShadowCut(texture);
        }
        return false;
      });
      if (still.length !== part.waiting.length) {
        part.waiting = still;
        changed = true;
        this.refreshReady(part);
      }
    }
    if (changed) {
      this.refreshVisibility();
      this.onChange?.();
    }
  }

  private refreshReady(part: Part): void {
    const compositeMissing = part.usesComposite.some(Boolean) && !this.currentComposite;
    part.ready = part.waiting.length === 0 && !compositeMissing;
  }

  setDrawnLayers(layers: DrawnLayer[], key: string): void {
    this.drawnLayers = layers;
    this.lookKey = key;
  }

  /** The look's composite. The old one stays with whoever cached it. */
  setBaseTarget(target: WebGLRenderTarget): void {
    if (this.ownsBase && this.baseComposite) this.ownedTargets.push(this.baseComposite);
    this.baseComposite = target;
    this.ownsBase = false;
  }

  /** A skinned part follows this figure's look from now on. */
  followedBy(part: Figure): void {
    this.followers.push(part);
    part.setComposite(this.currentComposite);
    for (const [type, texture] of this.typeTextures) part.setModelTexture(type, texture);
    // The first look's textures, from the manifest: a part's own slots have no file.
    for (const t of this.assets.manifest.textures) {
      if (t.key && t.type !== 0 && !this.typeTextures.has(t.type)) {
        const texture = this.assets.textures[this.assets.manifest.textures.indexOf(t)];
        if (texture) part.setModelTexture(t.type, texture);
      }
    }
  }

  /**
   * Points every unit of a retail texture type at this texture, in one step: hair 6,
   * eyes 19, fur 8. Null leaves them blank, as no art painted there.
   */
  setModelTexture(type: number, texture: Texture | null): void {
    this.typeTextures.set(type, texture);
    const textures = this.assets.manifest.textures;
    for (const part of this.parts) {
      let touched = false;
      part.extras.units.forEach((unit, i) => {
        if (i >= 3 || unit.tex < 0 || textures[unit.tex]?.type !== type) return;
        touched = true;
        part.waiting = part.waiting.filter((w) => w.unit !== i);
        const wrapped = texture ? this.assets.wrapped(texture, unit.wrapS, unit.wrapT) : whiteTexture();
        part.material.uniforms[UNIT_KEYS[i]!].value = wrapped;
        if (texture) part.blank.delete(i);
        else part.blank.add(i);
        if (i === 0) part.material.setShadowCut(texture ? wrapped : null);
      });
      if (touched) this.refreshReady(part);
    }
    for (const f of this.followers) f.setModelTexture(type, texture);
    this.refreshVisibility();
  }

  /**
   * A face bone set: the client multiplies each matrix in front of the posed bone, after
   * the hierarchy, so children don't inherit it. A skeleton's inverse bind is exactly
   * that slot (bone texture = world * inverse), and with identity binds it is free.
   */
  setBoneSet(entries: readonly (readonly [number, readonly number[]])[]): void {
    const skeleton = this.skeleton;
    if (!skeleton) return;
    for (const b of this.faceBones) skeleton.boneInverses[b]?.identity();
    this.faceBones.clear();
    for (const [bone, m] of entries) {
      const slot = skeleton.boneInverses[bone];
      if (!slot) continue;
      if (this.faceBones.has(bone)) slot.multiply(_mat.fromArray(m as number[]));
      else slot.fromArray(m as number[]);
      this.faceBones.add(bone);
    }
  }

  /** A look's glow: on every one-unit skin batch, as retail's case 10. Null: no glow armed. */
  setEmissive(texture: Texture | null): void {
    const textures = this.assets.manifest.textures;
    for (const part of this.parts) {
      const unit = part.extras.units[0];
      if (part.extras.units.length !== 1 || !unit || textures[unit.tex]?.type !== 1) continue;
      part.material.uniforms.uEm.value = texture;
      part.material.uniforms.uEmOn.value = texture ? 1 : 0;
    }
    for (const f of this.followers) f.setEmissive(texture);
  }

  /** A target this figure drew for its first look and frees with itself. */
  ownTarget(target: WebGLRenderTarget): void {
    this.ownedTargets.push(target);
  }

  /** A worn piece's inverse must equal the body's to share its skeleton: a face set doesn't count. */
  isFaceBone(bone: number): boolean {
    return this.faceBones.has(bone);
  }

  /**
   * What the outfit puts on the body's own texture slots, by type. A slot the outfit
   * leaves alone keeps what the look painted there: a Dracthyr's wings are type 10, and
   * putting on gloves must not take their art away. Nothing at all: the batch isn't drawn.
   */
  setWornTextures(byType: ReadonlyMap<number, Texture>): void {
    let changed = false;
    for (const part of this.parts) {
      if (part.worn.length === 0) continue;
      for (const { unit, type } of part.worn) {
        const texture = byType.get(type) ?? this.typeTextures.get(type) ?? null;
        part.material.uniforms[UNIT_KEYS[unit]!].value = texture ?? whiteTexture();
        if (texture) part.blank.delete(unit);
        else part.blank.add(unit);
        if (unit === 0) part.material.setShadowCut(texture);
      }
      changed = true;
    }
    if (changed) this.refreshVisibility();
  }

  /** What the look painted on a retail texture type. Null: nothing. */
  lookTexture(type: number): Texture | null {
    return this.typeTextures.get(type) ?? null;
  }

  /** Points every composite unit at this texture, in one step. */
  setComposite(texture: Texture | null): void {
    this.currentComposite = texture;
    for (const f of this.followers) f.setComposite(texture);
    for (const part of this.parts) {
      part.usesComposite.forEach((used, i) => {
        if (!used) return;
        part.material.uniforms[UNIT_KEYS[i]!].value = texture ?? whiteTexture();
        if (i === 0) part.material.setShadowCut(texture);
      });
      this.refreshReady(part);
    }
    this.refreshVisibility();
  }

  get composite(): Texture | null {
    return this.currentComposite;
  }

  /** The look's geosets decide what shows, in one step. */
  applyGeosets(visible: ReadonlySet<number>): void {
    for (const part of this.parts) {
      part.shown = visible.has(part.extras.geoset);
      if (part.shown) for (const w of part.waiting) this.assets.requestTexture(w.tex);
    }
    this.refreshVisibility();
    this.emitters?.applyGeosets(visible);
  }

  refreshVisibility(): void {
    for (const part of this.parts) {
      part.mesh.visible = part.ready && part.blank.size === 0 && (part.userVisible ?? part.shown);
    }
  }

  /** Bones and skin in their current pose, for anything that reads them off stage. */
  poseNow(): void {
    this.root.updateMatrixWorld(true);
    this.skeleton?.update();
  }

  /** Every texture this figure draws with, for upload before it joins the scene. */
  allTextures(): Texture[] {
    const out = new Set<Texture>();
    for (const part of this.parts) {
      const u = part.material.uniforms;
      for (const key of UNIT_KEYS) {
        const t = u[key].value;
        if (t) out.add(t);
      }
    }
    return [...out];
  }

  sizeHint(): number {
    const { min, max } = this.assets.manifest.bounds;
    _size.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return _size.length() / 2;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.emitters?.dispose();
    this.emitters = null;
    this.rig?.dispose();
    this.rig = null;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
    for (const o of this.adopted) o.removeFromParent();
    const skeletons = new Set<Skeleton>();
    for (const part of this.parts) {
      part.mesh.geometry.dispose();
      part.material.dispose();
      const sk = (part.mesh as SkinnedMesh).skeleton;
      if (sk) skeletons.add(sk);
    }
    if (this.skeleton) skeletons.add(this.skeleton);
    for (const sk of skeletons) if (sk !== this.foreignSkeleton) sk.dispose();
    if (this.ownsBase) this.baseComposite?.dispose();
    this.baseComposite = null;
    for (const t of this.ownedTargets) t.dispose();
    this.assets.onTexture = null;
    this.assets.dispose();
  }
}

/**
 * The bone composes T(pivot + t) R S T(-pivot), as retail's does. No allocation: this
 * runs for every animated bone every frame.
 */
function pivotUpdateMatrix(this: Object3D): void {
  this.matrix.compose(this.position, this.quaternion, this.scale);
  const p = this.userData.pivot as [number, number, number];
  const e = this.matrix.elements;
  e[12]! += p[0] - (e[0]! * p[0] + e[4]! * p[1] + e[8]! * p[2]);
  e[13]! += p[1] - (e[1]! * p[0] + e[5]! * p[1] + e[9]! * p[2]);
  e[14]! += p[2] - (e[2]! * p[0] + e[6]! * p[1] + e[10]! * p[2]);
  this.matrixWorldNeedsUpdate = true;
}

export function applyPivot(node: Object3D, x: number, y: number, z: number): void {
  if (x === 0 && y === 0 && z === 0) return;
  node.userData.pivot = [x, y, z];
  node.updateMatrix = pivotUpdateMatrix;
}

/** A clone loses the method but keeps userData: this puts the behaviour back. */
export function restorePivots(root: Object3D): void {
  root.traverse((o) => {
    const p = o.userData.pivot as [number, number, number] | undefined;
    if (p) o.updateMatrix = pivotUpdateMatrix;
  });
}

function sameBones(a: Skeleton, b: Skeleton): boolean {
  if (a === b || a.bones.length !== b.bones.length) return a === b;
  for (let i = 0; i < a.bones.length; i++) {
    if (a.bones[i] !== b.bones[i] || !a.boneInverses[i]!.equals(b.boneInverses[i]!)) return false;
  }
  return true;
}
