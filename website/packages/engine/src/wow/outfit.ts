/**
 * What an outfit is made of on one body: attached models on its attachments,
 * collections driven by its bones, body textures for its composite, geoset rules.
 * This file resolves and plans; nothing here changes what is on screen. The caller
 * applies a plan in one step, once everything in it can draw.
 */
import { Group, Matrix4, Skeleton, type Bone, type Object3D, type SkinnedMesh, type Texture } from "three";
import { ownedGeosets, packUrl, paths, type AttachedPiece, type ItemManifest, type SlotId, type Vec3 } from "@eclipse/format";
import { fetchBytes, fetchJson, isAbort } from "../net/fetchPack";
import { ModelAssets, registerManifests, type LoadEnv } from "../model/assets";
import { boneIndices } from "../model/loaders";
import { textureStore, type Lease } from "../model/shared";
import { boneIndex } from "../logic/pivots";
import { Figure } from "../model/figure";
import { outfitGeosets } from "../logic/geosets";
import { COMP_FLAGS, EMPTY_SLOT, SHEATH_POINTS, SLOTS, handPose, type GeoSlot } from "../logic/retailGeo";
import { DEFAULT_SECTIONS, PAINT_ORDER, componentSlot } from "../logic/slots";
import type { DrawnLayer } from "./composite";

export interface Piece {
  kind: "attached" | "collection";
  figure: Figure;
  /** Where it hangs. Null: the body could not take it. */
  parent: Object3D | null;
  /** What goes under `parent`. */
  node: Object3D;
  mirrored: boolean;
  /** Where it rests when the weapons are put away. Absent: it stays, or it is not a weapon. */
  stowed?: { parent: Object3D | null; matrix: Matrix4; mirrored: boolean };
  /** Where it hangs drawn. */
  drawn?: { parent: Object3D | null; matrix: Matrix4; mirrored: boolean };
  /** The slot it is worn in: the ranged weapon hangs on the back whatever the hands hold. */
  slot?: SlotId;
}

/** Moves a hand item between its drawn and its stowed place. A piece with no stowed place stays. */
export function placePiece(piece: Piece, stowed: boolean): void {
  const pose = stowed && piece.stowed ? piece.stowed : piece.drawn;
  if (!pose) return;
  (piece.node as Group).matrix.copy(pose.matrix);
  piece.node.matrixWorldNeedsUpdate = true;
  piece.parent = pose.parent;
  piece.mirrored = pose.mirrored;
  if (piece.node.parent && piece.node.parent !== pose.parent) pose.parent?.add(piece.node);
}

export interface ResolvedItem {
  id: string;
  manifest: ItemManifest;
  pieces: Piece[];
  layers: { section: number; texture: Texture }[];
  /** What it paints on the body's own texture slots, by type. */
  wornTextures: { type: number; texture: Texture }[];
  warnings: string[];
  /** Its holds on the textures above, which other items may read too. */
  leases: Lease[];
}

let pieceNames = 0;

/** Which hand a sheath or hand attachment belongs to, for the mirror bits. */
function handOf(slot: SlotId, attachment: number): 0 | 1 | -1 {
  if (attachment === 1) return 0;
  if (attachment === 2 || attachment === 0) return 1;
  if (slot === "mainhand" || slot === "ranged") return 0;
  if (slot === "offhand") return 1;
  return -1;
}

/**
 * The fallback retail takes for a collection: this body, its race and sex key, then
 * anything. `human-male` also tries `human`.
 */
export function collectionFor(
  collections: ItemManifest["collections"],
  bodyId: string,
): ItemManifest["collections"][string] | undefined {
  return collections[bodyId] ?? collections[bodyId.split("-")[0]!] ?? collections["*"];
}

/**
 * A collection shares the body's skeleton. Its joints are matched by node name; if
 * they all exist on the body the vertices are renumbered to the body's joints and
 * the body's own Skeleton is used, so a coat adds no bone texture and no skinning
 * state of its own. Otherwise it gets a Skeleton over the body's bones by name.
 */
export function rebindCollection(piece: Figure, body: Figure): number {
  piece.host = body;
  let matched = 0;
  const bodySkeleton = body.skeleton;
  // One GLB per file, whichever body wears it: its joints are the file's own, and a
  // joint is found on the body by what it is, its retail name hash, not where it sits.
  const pieceCrcs = piece.assets.manifest.boneCrcs;
  const bodyCrcs = body.assets.manifest.boneCrcs;
  let bodyAt: Map<number, number> | null = null;
  if (pieceCrcs && bodyCrcs) {
    bodyAt = new Map();
    for (let i = 0; i < bodyCrcs.length; i++) {
      const c = bodyCrcs[i]!;
      if (c && !bodyAt.has(c)) bodyAt.set(c, i);
    }
  }
  const onBody = (name: string): Bone | undefined => {
    if (!bodyAt || !pieceCrcs) return body.bones.get(name) as Bone | undefined;
    const own = boneIndex(name);
    const at = own >= 0 ? bodyAt.get(pieceCrcs[own] ?? 0) : undefined;
    return at === undefined ? undefined : (body.bones.get(`b${at}`) as Bone | undefined);
  };
  for (const part of piece.parts) {
    const mesh = part.mesh as SkinnedMesh;
    if (!mesh.isSkinnedMesh) continue;
    const own = mesh.skeleton;
    const mapped = own.bones.map((b) => onBody(b.name));
    matched += mapped.filter(Boolean).length;
    const identity = new Matrix4();
    const allThere = mapped.every(Boolean);
    if (allThere && bodySkeleton) {
      const index = new Map(bodySkeleton.bones.map((b, i) => [b.name, i]));
      const toBody = mapped.map((b) => index.get(b!.name) ?? -1);
      // A packer may fold its quantization into the inverse binds: only equal ones can share.
      // A face bone set lives in the body's inverse slot and is meant to carry the piece too.
      const sameInverses = toBody.every((to, i) => to >= 0 && (body.isFaceBone(to) || own.boneInverses[i]!.equals(bodySkeleton.boneInverses[to]!)));
      if (sameInverses) {
        const attr = mesh.geometry.getAttribute("skinIndex");
        const out = new Uint16Array(attr.count * 4);
        for (let i = 0; i < attr.count; i++) {
          out[i * 4] = toBody[attr.getX(i)]!;
          out[i * 4 + 1] = toBody[attr.getY(i)]!;
          out[i * 4 + 2] = toBody[attr.getZ(i)]!;
          out[i * 4 + 3] = toBody[attr.getW(i)]!;
        }
        mesh.geometry.setAttribute("skinIndex", boneIndices(out));
        if (own !== bodySkeleton) own.dispose();
        mesh.bind(bodySkeleton, identity);
        piece.foreignSkeleton = bodySkeleton;
        continue;
      }
    }
    // A joint the body doesn't have hangs from the joint above it, as in the file. Left
    // in the piece's own tree it would hold its bind pose while the body moves away.
    own.bones.forEach((b, i) => {
      if (mapped[i] || !b.parent) return;
      const above = own.bones.indexOf(b.parent as Bone);
      if (above >= 0 && mapped[above]) {
        mapped[above]!.add(b);
        piece.adopted.push(b);
      }
    });
    const bones = own.bones.map((b, i) => (mapped[i] ?? b) as Bone);
    const skeleton = new Skeleton(bones, own.boneInverses);
    own.dispose();
    mesh.bind(skeleton, identity);
  }
  // Rebound meshes no longer read this figure's skeleton.
  piece.skeleton = null;
  return matched;
}

interface LibraryEntry {
  promise: Promise<ResolvedItem>;
  abort: AbortController;
  used: number;
  /** Set once it has arrived. */
  item: ResolvedItem | null;
  /** Worn for real at some point: stays warm longer than something only hovered. */
  worn: boolean;
}

export class ItemLibrary {
  private readonly items = new Map<string, LibraryEntry>();
  private tick = 0;

  constructor(
    private readonly env: LoadEnv,
    private readonly body: Figure,
    /** Items kept ready for an instant re-hover. */
    private readonly keep = 12,
    /** On top of those, items that were worn: going back to the last few sets is instant. */
    private readonly keepWorn = 0,
  ) {}

  /** A hand item worn in the other hand is another piece: it hangs and mirrors for that hand. */
  resolve(id: string, worn?: SlotId, group = 0): Promise<ResolvedItem> {
    const key = itemKey(id, worn);
    const hit = this.items.get(key);
    if (hit) {
      hit.used = ++this.tick;
      return hit.promise;
    }
    const abort = new AbortController();
    const promise = this.load(id, abort.signal, worn, group);
    const entry: LibraryEntry = { promise, abort, used: ++this.tick, item: null, worn: false };
    this.items.set(key, entry);
    promise.then(
      (item) => {
        if (this.items.get(key) === entry) entry.item = item;
        // Cut loose while its last parts came in: nobody will ever free it otherwise.
        else disposeItem(item);
      },
      () => {
        if (this.items.get(key) === entry) this.items.delete(key);
      },
    );
    return promise;
  }

  /**
   * What the pointer may reach next, into the browser's cache and nothing further: no decode,
   * no upload, a low place in the queue, and a newer call drops what hasn't got a socket yet.
   * `whole` false stops at the manifest, which takes the first round trip off a later hover.
   */
  warm(entries: readonly (readonly [SlotId, string])[], whole: boolean): void {
    const channel = whole ? 1 : 0;
    this.warming[channel]?.abort();
    const abort = new AbortController();
    this.warming[channel] = abort;
    for (const [slot, id] of entries) {
      if (this.items.has(itemKey(id, slot))) continue;
      this.warmOne(id, whole, abort.signal).catch((err: unknown) => {
        if (!isAbort(err)) console.warn(`[eclipse] item ${id} could not be warmed:`, err);
      });
    }
  }

  private readonly warming: (AbortController | null)[] = [null, null];

  private async warmOne(id: string, whole: boolean, signal: AbortSignal): Promise<void> {
    const { env, body } = this;
    const manifest = await fetchJson<ItemManifest>(packUrl(env.base, paths.item(id)), { signal, priority: "low", finish: true });
    if (!whole) return;
    const keys = new Map<string, number>();
    const models = [...(manifest.attachedBy ? manifest.attachedBy[body.id] ?? [] : manifest.attached ?? []).map((a) => a.manifest)];
    const collection = collectionFor(manifest.collections ?? {}, body.id);
    if (collection) models.push(collection.manifest);
    for (const modelId of models) {
      const m = manifest.models?.[modelId];
      if (!m) continue;
      keys.set(m.glb.key, m.glb.bytes);
      if (m.fx) keys.set(m.fx.key, m.fx.bytes);
      for (const i of m.defaultTextures ?? []) {
        const t = m.textures[i];
        if (t?.key) keys.set(t.key, t.bytes);
      }
      const clip = m.clips.find((c) => c.id === m.defaultClip);
      if (clip) keys.set(clip.key, clip.bytes);
    }
    const sex = body.id.endsWith("-female") ? 1 : 0;
    const layers = manifest.bodyLayersBy ? manifest.bodyLayersBy[body.id] ?? [] : (manifest.bodyLayers ?? []).filter((l) => l.sex === undefined || l.sex === sex);
    for (const l of layers) keys.set(l.key, l.bytes);
    for (const t of manifest.bodyTextures ?? []) keys.set(t.key, t.bytes);
    await Promise.all([...keys].map(([key, bytes]) => fetchBytes(packUrl(env.base, key), { signal, priority: "low", expected: bytes, finish: true })));
  }

  /** The item, if it has arrived. Answers in the same tick, so a warm one swaps in the same frame. */
  peek(key: string): ResolvedItem | null {
    const entry = this.items.get(key);
    if (!entry?.item) return null;
    entry.used = ++this.tick;
    return entry.item;
  }

  /** This one was really worn: it stays warm in the longer list. */
  markWorn(key: string): void {
    const entry = this.items.get(key);
    if (entry) entry.worn = true;
  }

  private place(attachment: number, a: AttachedPiece, slot: SlotId, stowed: boolean): { parent: Object3D | null; matrix: Matrix4; mirrored: boolean } | null {
    const { body } = this;
    const point = body.assets.manifest.attachments.find((p) => p.id === attachment);
    if (!point) return null;
    const pose = handPose(a.handFlags ?? 0, handOf(slot, attachment), stowed);
    const matrix = new Matrix4();
    anchorMatrix(matrix, point.position, pose.scale, stowed ? a.sheath : undefined);
    return { parent: body.bones.get(`b${point.bone}`) ?? null, matrix, mirrored: pose.mirrored };
  }

  private async load(id: string, signal: AbortSignal, worn: SlotId | undefined, group: number): Promise<ResolvedItem> {
    const { env, body } = this;
    const manifest = await fetchJson<ItemManifest>(packUrl(env.base, paths.item(id)), { signal, priority: env.priority ?? "high", group, finish: true });
    registerManifests(manifest.models);
    const warnings: string[] = [];
    const piecePromises: Promise<Piece | null>[] = [];
    const slot = worn ?? manifest.slot;
    // An item retail cuts per body lists each body's pieces; a body it does not list wears none.
    const attachedList = manifest.attachedBy ? manifest.attachedBy[body.id] ?? [] : manifest.attached ?? [];
    const store = textureStore(env.renderer);
    const leases: Lease[] = [];
    const lease = (key: string, bytes: number, anisotropy: number): Promise<Texture> => {
      const held = store.acquire(packUrl(env.base, key), bytes, anisotropy, group, env.priority);
      leases.push(held);
      return held.texture;
    };

    for (const a of attachedList) {
      piecePromises.push(
        (async () => {
          const attachment = wornAttachment(slot, a.attachment);
          const drawn = this.place(attachment, a, slot, false);
          if (!drawn) {
            warnings.push(`body ${body.id} has no attachment ${attachment}`);
            return null;
          }
          const hand = slot === "offhand" ? 1 : 0;
          const stowPoint = a.sheathPoints?.[hand];
          const stowed = stowPoint !== undefined ? this.place(stowPoint, a, slot, true) : null;
          const assets = await ModelAssets.load(a.manifest, env, { signal, shared: true, group });
          const figure = new Figure(assets, { layer: 2, namePrefix: `p${++pieceNames}_` });
          const anchor = new Group();
          anchor.name = `attachment-${attachment}`;
          anchor.matrixAutoUpdate = false;
          anchor.matrix.copy(drawn.matrix);
          anchor.add(figure.root);
          startOwnClip(figure);
          return { kind: "attached" as const, figure, parent: drawn.parent, node: anchor, mirrored: drawn.mirrored, drawn, slot, ...(stowed ? { stowed } : {}) };
        })(),
      );
    }

    const collection = collectionFor(manifest.collections ?? {}, body.id);
    if (collection) {
      // A set's combined model holds every slot's parts: this item shows its own. Baked
      // manifests from before the baker knew say more, and the rule is the same one.
      const model = manifest.models?.[collection.manifest];
      if (model) model.defaultGeosets = ownedGeosets(model.defaultGeosets, manifest.slot);
      if (!model || model.defaultGeosets.length > 0) {
        piecePromises.push(
          (async () => {
            const assets = await ModelAssets.load(collection.manifest, env, { signal, shared: true, group });
            const figure = new Figure(assets, { layer: 1 });
            rebindCollection(figure, body);
            return { kind: "collection" as const, figure, parent: body.root, node: figure.root, mirrored: false, slot };
          })(),
        );
      }
    }

    const sex = body.id.endsWith("-female") ? 1 : 0;
    const layerList: { section: number; key: string; bytes: number }[] = manifest.bodyLayersBy
      ? manifest.bodyLayersBy[body.id] ?? []
      : (manifest.bodyLayers ?? []).filter((l) => l.sex === undefined || l.sex === sex);
    const layerPromises = layerList.map(async (l) => ({ section: l.section, texture: await lease(l.key, l.bytes, 1) }));
    const wornPromises = (manifest.bodyTextures ?? []).map(async (t) => ({ type: t.type, texture: await lease(t.key, t.bytes, env.anisotropy()) }));

    // Everything settles before the answer: what did arrive of a failed item is freed here,
    // or it would hang on the body's bones with nothing left to find it by.
    const [pieces, layers, wornTextures] = await Promise.all([Promise.allSettled(piecePromises), Promise.allSettled(layerPromises), Promise.allSettled(wornPromises)]);
    const failure = [...pieces, ...layers, ...wornTextures].find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      for (const r of pieces) {
        if (r.status === "fulfilled" && r.value) {
          r.value.node.removeFromParent();
          r.value.figure.dispose();
        }
      }
      for (const l of leases) l.release();
      throw failure.reason;
    }
    const kept = <T,>(list: PromiseSettledResult<T>[]): T[] => list.map((r) => (r as PromiseFulfilledResult<T>).value);
    return { id, manifest, pieces: kept(pieces).filter((p): p is Piece => p !== null), layers: kept(layers), wornTextures: kept(wornTextures), warnings, leases };
  }

  /** Stops a fetch nobody wants any more. A finished item stays for a re-hover. */
  cancelUnwanted(wanted: ReadonlySet<string>): void {
    for (const [id, entry] of this.items) {
      if (wanted.has(id) || entry.item) continue;
      entry.abort.abort();
      this.items.delete(id);
    }
  }

  /** Keeps the cache to size. Nothing in use and nothing still loading is touched. */
  async trim(inUse: ReadonlySet<string>, dispose: (item: ResolvedItem) => void): Promise<void> {
    const free = [...this.items.entries()].filter(([id, e]) => !inUse.has(id) && e.item).sort((a, b) => b[1].used - a[1].used);
    // Newest first: what is past its list's length goes, the oldest of it having waited longest.
    let keep = this.keep;
    let keepWorn = this.keepWorn;
    for (const [id, entry] of free) {
      if (entry.worn && keepWorn > 0) {
        keepWorn--;
        continue;
      }
      if (keep > 0) {
        keep--;
        continue;
      }
      this.items.delete(id);
      dispose(entry.item!);
    }
  }

  disposeAll(): void {
    for (const w of this.warming) w?.abort();
    for (const entry of this.items.values()) {
      entry.abort.abort();
      // One that was cut loose is freed when it lands.
      if (entry.item) disposeItem(entry.item);
    }
    this.items.clear();
  }
}

/** A hand slot's copy is its own piece. Everything else is one piece wherever it is worn. */
export function itemKey(id: string, worn?: SlotId): string {
  return worn === "mainhand" || worn === "offhand" || worn === "ranged" ? `${id}@${worn}` : id;
}

/** The two hands take anything: an item goes where it is worn, a shield stays on the arm. */
export function wornAttachment(worn: SlotId, baked: number): number {
  if (worn === "mainhand") return 1;
  if (worn === "offhand") return baked === 0 ? 0 : 2;
  return baked;
}

export function disposeItem(item: ResolvedItem): void {
  for (const piece of item.pieces) {
    piece.node.removeFromParent();
    piece.figure.dispose();
  }
  for (const l of item.leases) l.release();
}

function anchorMatrix(out: Matrix4, position: Vec3, scale: readonly [number, number, number], sheath?: number[]): void {
  out.makeScale(scale[0], scale[1], scale[2]);
  if (sheath?.length === 16) out.premultiply(new Matrix4().fromArray(sheath));
  out.premultiply(new Matrix4().makeTranslation(position[0], position[1], position[2]));
}

/** An attached model plays its own default clip, on its own mixer. */
function startOwnClip(figure: Figure): void {
  const id = figure.assets.defaultClip;
  const clip = id ? figure.assets.clips.cached(id) : undefined;
  if (clip) {
    figure.mixer.clipAction(figure.adaptClip(clip)).play();
    figure.mixer.update(0);
  }
}

// --- Planning ---------------------------------------------------------------

export interface OutfitPlan {
  /** Which geosets show on the body. */
  visible: Set<number>;
  /** Layers for the body's composite: the body's own, then the items', in paint order. */
  layers: DrawnLayer[];
  /** Same key, same composite. Empty: the body's own composite will do. */
  compositeKey: string;
  pieces: Piece[];
  /** Type -> what the outfit paints on the body's own slots. */
  wornTextures: Map<number, Texture>;
}

export function planOutfit(body: Figure, worn: ReadonlyMap<SlotId, ResolvedItem>): OutfitPlan {
  const slots: GeoSlot[] = Array.from({ length: SLOTS }, () => EMPTY_SLOT);
  let compFlags = 0;
  const helmHide = new Set<number>();
  const pieces: Piece[] = [];
  const wornTextures = new Map<number, Texture>();

  for (const [slot, item] of worn) {
    const m = item.manifest;
    const c = componentSlot(slot);
    if (c >= 0) {
      const gg = [0, 0, 0, 0, 0, 0];
      for (const [k, v] of Object.entries(m.geosetGroups ?? {})) {
        const i = Number(k);
        if (i >= 0 && i < 6) gg[i] = v;
      }
      let regions = m.regions ?? 0;
      if (m.regions === undefined) for (const l of m.bodyLayers ?? []) regions |= 1 << l.section;
      slots[c] = { worn: true, gg, pad: m.pad ?? 0, regions };
    }
    compFlags |= (m.compFlags ?? 0) & (COMP_FLAGS.legsOff | COMP_FLAGS.guild);
    const hide = m.helmetHide?.[body.id] ?? m.helmetHide?.["*"];
    if (hide) for (const g of hide) helmHide.add(g);
    pieces.push(...item.pieces);
    for (const t of item.wornTextures) wornTextures.set(t.type, t.texture);
  }
  // The hands keep their hands, and the ranged weapon hangs: its drawn point is a hand, and
  // the attach clears the point it lands on (Eclipse DressRoom.cpp).
  const handsFull = worn.has("mainhand") || worn.has("offhand");
  for (const piece of worn.get("ranged")?.pieces ?? []) placePiece(piece, handsFull);

  const composite = body.assets.manifest.composite;
  const layers: DrawnLayer[] = [];
  const keys: string[] = [];
  if (composite) {
    if (body.drawnLayers) layers.push(...body.drawnLayers);
    else
      for (const { layer, texture } of body.assets.layers) {
        if (texture && layer.targetType === 1) layers.push({ rect: layer.rect, blend: layer.blend, texture });
      }
    for (const slot of PAINT_ORDER) {
      const item = worn.get(slot);
      if (!item) continue;
      for (const l of item.layers) {
        const rect = sectionRect(l.section, composite);
        if (!rect) continue;
        layers.push({ rect, blend: 9, texture: l.texture });
        keys.push(`${item.id}:${l.section}`);
      }
    }
  }

  return {
    visible: outfitGeosets(body.look, slots, compFlags, [...helmHide]),
    layers,
    // Empty: the look's own composite will do. A look change redraws what an item paints over it.
    compositeKey: keys.length ? `${body.lookKey}@${keys.join("|")}` : "",
    pieces,
    wornTextures,
  };
}

function sectionRect(
  section: number,
  composite: { width: number; height: number; sections?: Record<number, { x: number; y: number; w: number; h: number }> },
): { x: number; y: number; w: number; h: number } | null {
  const own = composite.sections?.[section];
  if (own) return own;
  const f = DEFAULT_SECTIONS[section];
  if (!f) return null;
  return {
    x: f.x * composite.width,
    y: f.y * composite.height,
    w: f.w * composite.width,
    h: f.h * composite.height,
  };
}
