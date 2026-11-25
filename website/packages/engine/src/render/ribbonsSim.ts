/**
 * Retail's ribbon, simulated: the client's CRibbonEmitter (Saty's 3.3.5 source,
 * Engine/Source/Services/RibbonEmitter.cpp). A ring of edges, each two vertices, written
 * as the emitter moves and aged out. No three.js, so it runs under a plain test, and an
 * update allocates nothing.
 */
import type { FxRibbon, FxTrack, FxValue } from "@eclipse/format";
import { ParamTrack } from "./particlesSim";

/** x, y, z, u, v, r, g, b, a. */
export const RIBBON_STRIDE = 9;

function isTrack(v: FxValue | undefined): v is FxTrack {
  return v !== undefined && typeof v === "object" && !Array.isArray(v);
}

function firstOf(v: FxValue | undefined): number[] | null {
  if (v === undefined) return null;
  if (typeof v === "number") return [v];
  if (Array.isArray(v)) return v;
  const raw = v.clips["*"] ?? Object.values(v.clips)[0];
  const x = raw?.[1][0];
  if (x === undefined) return null;
  return typeof x === "number" ? [x] : x;
}

export class RibbonEmitterSim {
  /** Interleaved vertices: two per edge. */
  readonly vertices: Float32Array;
  readonly edges: number;
  readonly tracks: ParamTrack[] = [];
  readonly offsets = new Float32Array(6);
  readPos = 0;
  writePos = 0;
  enabled = true;
  /** This frame's step, read by update(). */
  frameDt = 0;

  private readonly ages: Float32Array;
  private readonly lifetime: number;
  private readonly invLifetime: number;
  private readonly edgesPerSec: number;
  private readonly gravity: number;
  private readonly cellU: number;
  private readonly cellV: number;
  private readonly rows: number;
  private readonly cols: number;
  private r = 1;
  private g = 1;
  private b = 1;
  private alpha = 1;
  private above = 0;
  private below = 0;
  private slot = -1;
  private minU = 0;
  private minV = 0;
  private maxV = 1;
  private visible = true;

  private started = false;
  private firstUpdate = true;
  private edgeFraction = 0;
  private edgeT = 0;
  private edgeAge = 0;
  private dist = 0;
  private px = 0;
  private py = 0;
  private pz = 0;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private pdx = 0;
  private pdy = 0;
  private pdz = 0;
  private cdx = 0;
  private cdy = 0;
  private cdz = 0;
  private pux = 0;
  private puy = 0;
  private puz = 0;
  private cux = 0;
  private cuy = 0;
  private cuz = 0;

  constructor(
    readonly data: FxRibbon,
    private readonly globalLoops: readonly number[],
  ) {
    const eps = Math.ceil(data.edgesPerSec);
    const lifetime = Math.max(0.25, data.lifetime);
    this.edgesPerSec = eps;
    this.lifetime = lifetime;
    this.invLifetime = 1 / lifetime;
    this.edges = Math.ceil(eps * lifetime) + 2;
    this.ages = new Float32Array(this.edges);
    this.vertices = new Float32Array(this.edges * 2 * RIBBON_STRIDE);
    this.gravity = data.gravity ?? 0;
    this.rows = data.rows && data.rows > 0 ? data.rows : 1;
    this.cols = data.cols && data.cols > 0 ? data.cols : 1;
    this.cellU = 1 / this.cols;
    this.cellV = 1 / this.rows;
    // The client's defaults, before a track says otherwise.
    this.above = 10;
    this.below = 10;
    this.setSlot(0);
    this.bind(data.color, (v) => {
      this.r = v[0]!;
      this.g = v[1]!;
      this.b = v[2]!;
    });
    this.bind(data.alpha, (v) => {
      this.alpha = v[0]!;
    });
    this.bind(data.above, (v) => {
      this.above = v[0]!;
    });
    this.bind(data.below, (v) => {
      this.below = v[0]!;
    });
    this.bind(data.slot, (v) => this.setSlot(v[0]! | 0));
    this.bind(data.visible, (v) => {
      const on = v[0]! > 0;
      // SetDataEnabled: switched off, the next edge starts a new ribbon.
      if (!on) this.started = false;
      this.visible = on;
    });
  }

  private bind(v: FxValue | undefined, apply: (x: Float32Array) => void): void {
    const first = firstOf(v);
    if (first) {
      const s = new Float32Array(4);
      s.set(first.slice(0, 4));
      apply(s);
    }
    if (isTrack(v) && Object.keys(v.clips).length > 0) this.tracks.push(new ParamTrack(v, this.globalLoops, apply));
  }

  private setSlot(slot: number): void {
    if (slot === this.slot) return;
    this.slot = slot;
    const cols = this.cols;
    this.minU = (slot % cols) * this.cellU;
    this.minV = Math.floor(slot / cols) * this.cellV;
    this.maxV = this.minV + this.cellV;
  }

  setClip(id: string | null): void {
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.setClip(id);
  }

  updateParams(): void {
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.update();
  }

  get active(): boolean {
    return this.readPos !== this.writePos || (this.enabled && this.visible);
  }

  /** Edges drawn, which is what the index range needs. */
  get segments(): number {
    const n = this.writePos - this.readPos;
    return n >= 0 ? n : n + this.edges;
  }

  /**
   * CRibbonEmitter::SetPos. `b` is the bone's world matrix, column-major, Y-up: retail's
   * bone-local Y (the ribbon's up) is the engine's X, retail's Z its Y.
   */
  setPos(b: ArrayLike<number>): void {
    if (!this.enabled || !this.visible) return;
    const pos = this.data.pos;
    const x = pos[0];
    const y = pos[1];
    const z = pos[2];
    const wx = b[0]! * x + b[4]! * y + b[8]! * z + b[12]!;
    const wy = b[1]! * x + b[5]! * y + b[9]! * z + b[13]!;
    const wz = b[2]! * x + b[6]! * y + b[10]! * z + b[14]!;
    if (this.started) {
      this.px = this.cx;
      this.py = this.cy;
      this.pz = this.cz;
      this.pdx = this.cdx;
      this.pdy = this.cdy;
      this.pdz = this.cdz;
      this.pux = this.cux;
      this.puy = this.cuy;
      this.puz = this.cuz;
    } else {
      this.px = wx;
      this.py = wy;
      this.pz = wz;
      this.pdx = b[4]!;
      this.pdy = b[5]!;
      this.pdz = b[6]!;
      this.pux = b[0]!;
      this.puy = b[1]!;
      this.puz = b[2]!;
      this.edgeFraction = 0;
      this.started = true;
    }
    this.cx = wx;
    this.cy = wy;
    this.cz = wz;
    this.cdx = b[4]!;
    this.cdy = b[5]!;
    this.cdz = b[6]!;
    this.cux = b[0]!;
    this.cuy = b[1]!;
    this.cuz = b[2]!;
  }

  /** CRibbonEmitter::InterpEdge, with InitInterpDeltas folded in. */
  private interpEdge(advance: boolean): void {
    const v = this.vertices;
    const o = this.writePos * 2 * RIBBON_STRIDE;
    const t = this.edgeT;
    const dist = this.dist;
    const s = 1 - t;
    const stx = this.pdx * dist;
    const sty = this.pdy * dist;
    const stz = this.pdz * dist;
    const etx = this.cdx * dist;
    const ety = this.cdy * dist;
    const etz = this.cdz * dist;
    const a = this.above;
    const c = this.below;
    // Below
    v[o] = (this.cx - this.cux * c - s * etx) * t + (this.px - this.pux * c + stx * t) * s;
    v[o + 1] = (this.cy - this.cuy * c - s * ety) * t + (this.py - this.puy * c + sty * t) * s;
    v[o + 2] = (this.cz - this.cuz * c - s * etz) * t + (this.pz - this.puz * c + stz * t) * s;
    // Above
    const o2 = o + RIBBON_STRIDE;
    v[o2] = (this.cx + this.cux * a - s * etx) * t + (this.px + this.pux * a + stx * t) * s;
    v[o2 + 1] = (this.cy + this.cuy * a - s * ety) * t + (this.py + this.puy * a + sty * t) * s;
    v[o2 + 2] = (this.cz + this.cuz * a - s * etz) * t + (this.pz + this.puz * a + stz * t) * s;
    for (let k = 0; k < 2; k++) {
      const q = o + k * RIBBON_STRIDE + 5;
      v[q] = this.r;
      v[q + 1] = this.g;
      v[q + 2] = this.b;
      v[q + 3] = this.alpha;
    }
    this.ages[this.writePos] = this.edgeAge;
    if (advance) {
      this.writePos++;
      if (this.writePos >= this.edges) this.writePos -= this.edges;
    }
  }

  /** CRibbonEmitter::Update of `frameDt`. */
  update(): void {
    let dt = this.frameDt;
    if (this.firstUpdate && this.edgesPerSec > 0) dt = 1 / this.edgesPerSec + 0.0001;
    dt = dt < 0 ? 0 : this.lifetime <= dt ? this.lifetime : dt;
    const edges = this.edges;
    const ages = this.ages;
    while (this.readPos !== this.writePos) {
      if (ages[this.readPos]! + dt <= this.lifetime) break;
      if (++this.readPos >= edges) this.readPos -= edges;
    }
    if (this.enabled && this.visible && this.started) {
      const target = dt * this.edgesPerSec + this.edgeFraction;
      const dx = this.px - this.cx;
      const dy = this.py - this.cy;
      const dz = this.pz - this.cz;
      this.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (target >= 1) {
        const scale = 1 / (target - this.edgeFraction);
        const count = Math.floor(target - 1) + 1;
        let start = 1;
        for (let i = 0; i < count; i++) {
          const t = (start - this.edgeFraction) * scale;
          this.edgeT = t;
          this.edgeAge = -(t * dt);
          this.interpEdge(true);
          start += 1;
        }
      }
      this.edgeFraction = target - Math.floor(target);
      this.edgeT = 1;
      this.edgeAge = 0;
      this.interpEdge(false);
      const head = this.writePos * 2 * RIBBON_STRIDE;
      const v = this.vertices;
      v[head + 3] = this.minU;
      v[head + 4] = this.minV;
      v[head + RIBBON_STRIDE + 3] = this.minU;
      v[head + RIBBON_STRIDE + 4] = this.maxV;
    }
    const v = this.vertices;
    const g = this.gravity;
    const uAtAge = this.cellU * this.invLifetime;
    const minU = this.minU;
    const minV = this.minV;
    const maxV = this.maxV;
    for (let i = this.readPos; i !== this.writePos; ) {
      const o = i * 2 * RIBBON_STRIDE;
      const age = ages[i]!;
      if (g !== 0) {
        // Retail's z is the engine's y.
        const drop = (age * 2 + dt) * g * dt;
        v[o + 1] = v[o + 1]! + drop;
        v[o + RIBBON_STRIDE + 1] = v[o + RIBBON_STRIDE + 1]! + drop;
      }
      const next = age + dt;
      ages[i] = next;
      const u = next * uAtAge + minU;
      v[o + 3] = u;
      v[o + 4] = minV;
      v[o + RIBBON_STRIDE + 3] = u;
      v[o + RIBBON_STRIDE + 4] = maxV;
      if (++i >= edges) i -= edges;
    }
    this.firstUpdate = false;
  }

  /** Layer scroll: retail integrates speed x dt, mod 1, per ribbon (client 0x1011E90F0). */
  scroll(): void {
    const layers = this.data.layers;
    if (!layers) return;
    const dt = this.frameDt;
    for (let k = 0; k < 3; k++) {
      const speed = layers[k]!.speed;
      const x = this.offsets[k * 2]! + speed[0] * dt;
      const y = this.offsets[k * 2 + 1]! + speed[1] * dt;
      this.offsets[k * 2] = x - Math.floor(x);
      this.offsets[k * 2 + 1] = y - Math.floor(y);
    }
  }

  reset(): void {
    this.readPos = 0;
    this.writePos = 0;
    this.started = false;
    this.firstUpdate = true;
    this.edgeFraction = 0;
  }
}
