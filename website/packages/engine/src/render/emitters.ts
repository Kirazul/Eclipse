/**
 * Every particle emitter and ribbon of one figure: what the engine's frame loop updates.
 * Its meshes hang in scene space under `root`, because a world-space particle must not
 * follow the model once it is born. A figure with neither costs nothing: `create`
 * returns null and the loop does one compare. One with nothing alive and nothing to emit
 * returns false from `update` without touching the GPU.
 */
import { Group, type Camera, type Object3D, type Texture } from "three";
import type { FxData, FxParticle, FxRibbon } from "@eclipse/format";
import type { Figure } from "../model/figure";
import { FLOOR_ROW, ParticleMesh } from "./particles";
import { FX_CLOCK, ParticleEmitterSim } from "./particlesSim";
import { RibbonMesh } from "./ribbons";
import { RibbonEmitterSim } from "./ribbonsSim";

const RENDER_LAYER = 3e7;

/** Bone, and the emitter's model-space position, in world-matrix lookups. */
interface ParticleSlot {
  sim: ParticleEmitterSim;
  draw: ParticleMesh;
  bone: Object3D | null;
  textures: (Texture | null)[];
  bound: boolean;
}
interface RibbonSlot {
  sim: RibbonEmitterSim;
  draw: RibbonMesh;
  bone: Object3D | null;
  bound: boolean;
}

let seedCounter = 0x51ed27;

export class FigureEmitters {
  readonly root = new Group();
  private readonly particles: ParticleSlot[] = [];
  private readonly ribbons: RibbonSlot[] = [];
  private enabled = true;
  private clip: string | null = null;
  private ownClockMs = 0;
  private readonly ownDurationMs: number;
  /** Set for a figure that plays its own clip: an attached piece. */
  ownClock = false;
  /** Everything it wrote last frame, so a tick can say whether the picture changed. */
  liveLastFrame = false;

  static create(figure: Figure): FigureEmitters | null {
    const fx = figure.assets.fx;
    if (!fx) return null;
    if ((fx.particles?.length ?? 0) === 0 && (fx.ribbons?.length ?? 0) === 0) return null;
    const made = new FigureEmitters(figure, fx);
    if (made.count > 0) return made;
    // Every one reads a texture its display never filled.
    made.dispose();
    return null;
  }

  private constructor(
    private readonly figure: Figure,
    fx: FxData,
  ) {
    this.root.name = "emitters";
    this.root.matrixAutoUpdate = false;
    const loops = fx.globalLoops ?? [];
    const textures = figure.assets.manifest.textures;
    const displayColors = figure.assets.manifest.particleColors;
    (fx.particles as FxParticle[]).forEach((raw, i) => {
      // A slot the display never filled has nothing to draw: retail would bind nothing.
      const missing = raw.tex.some((t) => !textures[t]?.key);
      if (missing || !(raw.flags & 0x60000)) return;
      // CParticleEmitter2::SetParticleColors: the display's three colours, on the curve's keys.
      const set = raw.colorIndex ? displayColors?.[raw.colorIndex] : undefined;
      const data = set ? { ...raw, color: { t: [0, raw.color.t.length === 3 ? raw.color.t[1]! : 0.5, 1], v: set } } : raw;
      const sim = new ParticleEmitterSim(data, loops, { groundY: 0, seed: seedCounter++ });
      const draw = new ParticleMesh(sim, RENDER_LAYER + ((data.priority ?? 0) + 128) * 4096 + i);
      this.root.add(draw.mesh);
      this.particles.push({ sim, draw, bone: figure.boneAt(data.bone), textures: data.tex.map(() => null), bound: false });
    });
    (fx.ribbons as FxRibbon[]).forEach((data, i) => {
      if (data.tex.length === 0 || data.tex.some((t) => !textures[t]?.key)) return;
      const sim = new RibbonEmitterSim(data, loops);
      const draw = new RibbonMesh(sim, RENDER_LAYER + 512 * 4096 + ((data.priority ?? 0) + 128) * 8 + i * 4);
      for (const m of draw.meshes) this.root.add(m);
      this.ribbons.push({ sim, draw, bone: figure.boneAt(data.bone), bound: false });
    });
    const defaultClip = figure.assets.defaultClip;
    this.ownDurationMs = defaultClip ? (figure.assets.clips.entry(defaultClip)?.durationMs ?? 0) : 0;
    this.setClip(defaultClip);
    this.applyGeosets(new Set(figure.assets.manifest.defaultGeosets));
    this.bindTextures();
  }

  get count(): number {
    return this.particles.length + this.ribbons.length;
  }

  setClip(id: string | null): void {
    if (id === this.clip) return;
    this.clip = id;
    for (let i = 0; i < this.particles.length; i++) this.particles[i]!.sim.setClip(id);
    for (let i = 0; i < this.ribbons.length; i++) this.ribbons[i]!.sim.setClip(id);
  }

  /** PGD1: an emitter with a geoset id runs only while that geoset shows (client 0x1010C0DA0). */
  applyGeosets(visible: ReadonlySet<number>): void {
    for (let i = 0; i < this.particles.length; i++) {
      const s = this.particles[i]!;
      const g = s.sim.data.geoset ?? 0;
      s.sim.enabled = this.enabled && (g === 0 || visible.has(g));
    }
  }

  /** The Effects switch. Off empties everything: nothing is drawn or updated at all. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.root.visible = on;
    for (let i = 0; i < this.particles.length; i++) {
      const s = this.particles[i]!;
      s.sim.reset();
      s.draw.hide();
    }
    for (let i = 0; i < this.ribbons.length; i++) {
      const s = this.ribbons[i]!;
      s.sim.reset();
      s.sim.enabled = on;
      s.draw.hide();
    }
    this.applyGeosets(this.figure.look.visible);
  }

  private bindTextures(): boolean {
    const assets = this.figure.assets;
    let all = true;
    for (let i = 0; i < this.particles.length; i++) {
      const s = this.particles[i]!;
      if (s.bound) continue;
      const { tex, wrap, multi } = s.sim.data;
      let ready = true;
      for (let k = 0; k < tex.length; k++) {
        // Layers scroll, so they wrap whatever the texture's own flags say.
        const w = wrap[k] ?? 0;
        const t = assets.textureFor(tex[k]!, !!multi || (w & 1) !== 0, !!multi || (w & 2) !== 0);
        if (t) s.draw.setTexture(k, t);
        else ready = false;
      }
      s.bound = ready;
      all &&= ready;
    }
    for (let i = 0; i < this.ribbons.length; i++) {
      const s = this.ribbons[i]!;
      if (s.bound) continue;
      const { tex, wrap, layers } = s.sim.data;
      let ready = true;
      if (s.draw.three) {
        for (let k = 0; k < 3; k++) {
          const w = wrap[k] ?? 0;
          const t = assets.textureFor(tex[k]!, !!layers || (w & 1) !== 0, !!layers || (w & 2) !== 0);
          if (t) s.draw.setTexture(0, k, t);
          else ready = false;
        }
      } else {
        for (let p = 0; p < s.draw.meshes.length; p++) {
          const w = wrap[p] ?? 0;
          const t = assets.textureFor(tex[p]!, (w & 1) !== 0, (w & 2) !== 0);
          if (t) s.draw.setTexture(p, 0, t);
          else ready = false;
        }
      }
      s.bound = ready;
      all &&= ready;
    }
    return all;
  }

  /** Textures to upload before this can draw, and meshes for the compiler. */
  textures(): Texture[] {
    const out = new Set<Texture>();
    const assets = this.figure.assets;
    for (const s of this.particles) {
      for (const t of s.sim.data.tex) {
        const texture = assets.textures[t];
        if (texture) out.add(texture);
      }
    }
    for (const s of this.ribbons) {
      for (const t of s.sim.data.tex) {
        const texture = assets.textures[t];
        if (texture) out.add(texture);
      }
    }
    return [...out];
  }

  /**
   * One frame, after the bones' world matrices are current, with FX_CLOCK set. Returns
   * true when something is alive, so the loop knows to draw.
   */
  update(camera: Camera): boolean {
    if (!this.enabled) return false;
    const dt = FX_CLOCK[2]!;
    const viewInverse = camera.matrixWorldInverse.elements;
    const cw = camera.matrixWorld.elements;
    const floor = FLOOR_ROW.value;
    floor.x = cw[1]!;
    floor.y = cw[5]!;
    floor.z = cw[9]!;
    floor.w = cw[13]!;
    let live = false;
    const bodyClip = FX_CLOCK[0]!;
    if (this.ownClock) {
      this.ownClockMs += dt * 1000;
      if (this.ownDurationMs > 0) this.ownClockMs %= this.ownDurationMs;
      FX_CLOCK[0] = this.ownClockMs;
    }
    let unbound = false;
    for (let i = 0; i < this.particles.length; i++) {
      const s = this.particles[i]!;
      const sim = s.sim;
      if (!s.bone) continue;
      sim.updateParams();
      if (!sim.active) {
        if (sim.drawn > 0) {
          sim.drawn = 0;
          s.draw.hide();
        }
        continue;
      }
      if (!s.bound) {
        unbound = true;
        continue;
      }
      sim.setTransform(s.bone.matrixWorld.elements);
      sim.frameDt = dt;
      sim.update();
      s.draw.draw(viewInverse);
      if (sim.live > 0) live = true;
    }
    for (let i = 0; i < this.ribbons.length; i++) {
      const s = this.ribbons[i]!;
      const sim = s.sim;
      if (!s.bone) continue;
      sim.updateParams();
      if (!sim.active) {
        s.draw.hide();
        continue;
      }
      if (!s.bound) {
        unbound = true;
        continue;
      }
      sim.setPos(s.bone.matrixWorld.elements);
      sim.frameDt = dt;
      sim.update();
      sim.scroll();
      s.draw.draw();
      if (sim.segments > 0) live = true;
    }
    FX_CLOCK[0] = bodyClip;
    if (unbound) this.bindTextures();
    const changed = live || this.liveLastFrame;
    this.liveLastFrame = live;
    return changed;
  }

  /** For tests and the frame budget. */
  stats(): { emitters: number; ribbons: number; live: number; drawn: number; segments: number } {
    let live = 0;
    let drawn = 0;
    let segments = 0;
    for (const s of this.particles) {
      live += s.sim.live;
      drawn += s.sim.drawn;
    }
    for (const s of this.ribbons) segments += s.sim.segments;
    return { emitters: this.particles.length, ribbons: this.ribbons.length, live, drawn, segments };
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const s of this.particles) s.draw.dispose();
    for (const s of this.ribbons) s.draw.dispose();
    this.particles.length = 0;
    this.ribbons.length = 0;
  }
}
