/**
 * One retail particle emitter, simulated. A port of the client's CParticleEmitter2
 * and its plane, sphere and spline emitters (Saty's 3.3.5 source,
 * Engine/Source/Services/ParticleSystem2.cpp, the same names used here), plus what
 * retail changed: packed gravity, EXP2's cutoff, three-texture layers, BlendAdd
 * (Eclipse's pipelines/mounts/KNOWLEDGE.md).
 *
 * No three.js, so it runs under a plain test. Everything lives in typed arrays sized
 * at load: an update allocates nothing, and an emitter with nothing alive and nothing
 * to emit costs one compare.
 *
 * Space. A world-space emitter's particles live in scene space, in the engine's Y-up
 * axes, and do not follow the model after birth. A local one (retail flag 0x10) keeps
 * them in the emitter's own frame, retail's axes, and draws through its matrix.
 */
import type { FxLifeCurve, FxParticle, FxTrack, FxValue } from "@eclipse/format";
import { compileTrack, type CompiledTrack } from "../wow/fx";

/** Floats per particle in the instance buffer. Layout in particles.ts. */
export const INSTANCE_STRIDE = 24;
/** Samples of each life curve. A flipbook of 64 cells still lands on every cell. */
export const LUT_SIZE = 128;
/** A cap for bad data: nothing retail ships comes close per emitter. */
const MAX_PARTICLES = 16384;

const MAX_STEP = 0.1;
const VEL_UPDATE_TIME = 0.033333335;
const MIN_ZSOURCE = 0.001;
const EPS = 2.3841858e-7;

// Particle fields, per particle in `p`.
const P_X = 0;
const P_VX = 3;
const P_AGE = 6;
const P_LIFE = 7;
const P_SX = 8;
const P_SY = 9;
const P_SPIN = 10;
const P_SPINRATE = 11;
const P_CELL = 12;
const P_TWINKLE = 13;
const P_L1 = 14;
const P_L1V = 16;
const P_L2 = 18;
const P_L2V = 20;
const P_STRIDE = 22;

// The client's emitter flags, retail flag -> what CM2Model::InitializeLoaded sets.
const F_LOCAL = 0x10;
const F_SORT = 0x2;
const F_ALIGN = 0x4;
const F_XFORM_SCALE = 0x20;
const F_INHERIT = 0x40;
const F_KILL_AT_CENTER = 0x80;
const F_VEL_Z = 0x100;
const F_RANDOM_SPIN_SIGN = 0x200;
const F_CLAMP_TAIL = 0x400;
const F_INTERP_SPAWN = 0x800;
const F_FLAT = 0x1000;
const F_PROJECT = 0x2000;
const F_FOLLOW = 0x4000;
const F_BURST = 0x8000;
const F_RANDOM_CELL = 0x10000;
const F_HEAD = 0x20000;
const F_TAIL = 0x40000;
const F_SEPARATE_SCALE = 0x80000;
/** Retail: the emitter's base tile comes from its RNG (client 0x101199F20). */
const F_RANDOM_BASE_TILE = 0x200000;

/** The client's s_rndTable: fixed noise for twinkling. */
const RND_TABLE = (() => {
  const t = new Float32Array(128);
  let s = 0x2f6e2b1;
  for (let i = 0; i < 128; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    t[i] = (s >>> 0) / 4294967296;
  }
  return t;
})();

/**
 * The RNG is a table read in place. A JS call returning a double boxes it unless it
 * inlines, and in a browser's optimised code an emission path this size does not inline
 * everything: measured 13 B per emitter per frame from a function-based RNG.
 */
const RND_SIZE = 1 << 14;
const RND_MASK = RND_SIZE - 1;
const RND = (() => {
  const t = new Float32Array(RND_SIZE);
  let s = 0x6d2b79f5;
  for (let i = 0; i < RND_SIZE; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    t[i] = (s >>> 0) / 4294967296;
  }
  return t;
})();

/** Retail's reading of a life curve: PartTrackKeys and PartTrackSample. */
export function curveAt(curve: FxLifeCurve, t: number, out: Float32Array | number[], stride: number): void {
  const { t: times, v: values } = curve;
  const n = values.length;
  const put = (a: number, b: number, f: number) => {
    const va = values[a]!;
    const vb = values[b]!;
    if (typeof va === "number") {
      out[0] = va + ((vb as number) - va) * f;
      return;
    }
    for (let c = 0; c < stride; c++) out[c] = va[c]! + ((vb as number[])[c]! - va[c]!) * f;
  };
  if (n === 0) return;
  if (n === 1) return put(0, 0, 0);
  if (n === 2) return put(0, 1, Math.max(0, Math.min(1, t)));
  if (n === 3) {
    const mid = times[1] ?? 0.5;
    if (t >= mid) return put(1, 2, mid >= 1 ? 0 : (t - mid) / (1 - mid));
    return put(0, 1, mid <= 0 ? 0 : t / mid);
  }
  if (t <= (times[0] ?? 0)) return put(0, 0, 0);
  let k = 0;
  while (k < n - 2 && times[k + 1]! <= t) k++;
  const span = times[k + 1]! - times[k]!;
  put(k, k + 1, span > 0 ? Math.max(0, Math.min(1, (t - times[k]!) / span)) : 0);
}

/** One of an emitter's animated parameters. */
export class ParamTrack {
  readonly track: CompiledTrack;
  private readonly hold: boolean;
  readonly stride: number;

  constructor(
    raw: FxTrack,
    loops: readonly number[],
    private readonly apply: (v: Float32Array) => void,
  ) {
    this.track = compileTrack(raw, loops)!;
    this.hold = raw.hold === true;
    const first = this.track.fallback ?? [...this.track.byClip.values()][0]!;
    this.stride = first.stride;
    this.track.now = first;
  }

  setClip(id: string | null): void {
    const t = this.track;
    t.now = (id !== null ? t.byClip.get(id) : undefined) ?? t.fallback;
    t.cursor = 0;
  }

  update(): void {
    const t = this.track;
    const k = t.now;
    if (!k) return;
    const time = t.loopMs > 0 ? FX_CLOCK[1]! % t.loopMs : FX_CLOCK[0]!;
    const { times, values, stride } = k;
    const n = times.length;
    if (n === 1 || time <= times[0]!) {
      for (let c = 0; c < stride; c++) SCRATCH[c] = values[c]!;
    } else if (time >= times[n - 1]!) {
      const at = (n - 1) * stride;
      for (let c = 0; c < stride; c++) SCRATCH[c] = values[at + c]!;
    } else {
      let i = t.cursor;
      if (i >= n - 1 || times[i]! > time) i = 0;
      while (times[i + 1]! < time) i++;
      t.cursor = i;
      const a = i * stride;
      if (this.hold) {
        for (let c = 0; c < stride; c++) SCRATCH[c] = values[a + c]!;
      } else {
        const f = (time - times[i]!) / (times[i + 1]! - times[i]!);
        for (let c = 0; c < stride; c++) SCRATCH[c] = values[a + c]! + (values[a + stride + c]! - values[a + c]!) * f;
      }
    }
    this.apply(SCRATCH);
  }
}

const SCRATCH = new Float32Array(4);

/**
 * What every emitter of a frame shares, in a typed array: a JS call boxes a double
 * argument unless it happens to inline, and that is an allocation per emitter per frame.
 * [0] clip time, [1] elapsed time, both ms; [2] this frame's step, seconds.
 */
export const FX_CLOCK = new Float64Array(3);

/** Every value a field can take: for the capacity, which never grows. */
function maxOf(v: FxValue | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v[0] ?? fallback;
  let m = -Infinity;
  for (const [, values] of Object.values(v.clips)) {
    for (const x of values) m = Math.max(m, typeof x === "number" ? x : (x[0] ?? 0));
  }
  return m === -Infinity ? fallback : m;
}

/** The first value of a field, the one the client starts from. */
function firstOf(v: FxValue | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v[0] ?? fallback;
  const list = v.clips["*"] ?? Object.values(v.clips)[0];
  const x = list?.[1][0];
  return typeof x === "number" ? x : (x?.[0] ?? fallback);
}

export interface EmitterEnv {
  /** Height of the floor, in scene space: where retail's flag 0x2000 lands a particle. */
  groundY: number;
  /** Seeds the RNG, so a test run repeats. */
  seed: number;
}

export class ParticleEmitterSim {
  readonly local: boolean;
  readonly head: boolean;
  readonly tail: boolean;
  readonly sorted: boolean;
  readonly aligned: boolean;
  readonly flat: boolean;
  readonly multi: boolean;
  readonly capacity: number;
  readonly flags: number;
  readonly cellW: number;
  readonly cellH: number;
  /** Live particles. */
  live = 0;
  /** Particles written to the instance buffer by the last `write`. */
  drawn = 0;
  /** Scale of the transform: the client's m_xformScale. */
  xformScale = 1;
  /** The third row of model-view, for retail's flag 2: draws far to near. */
  readonly viewZ = new Float64Array(4);
  /** This frame's step, read by update(). */
  frameDt = 0;
  /** The current step, read by what it calls. */
  private dt = 0;
  /** The emitter's matrix, column-major, updated by `setTransform`. */
  readonly xform = new Float32Array(16);
  /** PGD1 and the Effects switch. Off, it stops emitting; the live ones finish. */
  enabled = true;
  readonly tracks: ParamTrack[] = [];

  // Parameters, as the client's m_params.
  private speed = 0;
  private variation = 0;
  private latitude = 0;
  private longitude = 0;
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private life = 0;
  private readonly lifeVar: number;
  private rate = 0;
  private readonly rateVar: number;
  private width = 0;
  private height = 0;
  private zsource = 0;
  private visible = true;
  private burstFired = false;

  private readonly type: number;
  private readonly p: Float32Array;
  private readonly lut: Float32Array;
  private readonly cutLut: Float32Array | null;
  private readonly headLut: Float32Array | null;
  private readonly tailLut: Float32Array | null;
  private readonly order: Int32Array | null;
  private readonly depth: Float32Array | null;

  private readonly rows: number;
  private readonly cols: number;
  private readonly cellShift: number;
  private readonly baseTile: number;
  private readonly scaleVarX: number;
  private readonly scaleVarY: number;
  private readonly tailLength: number;
  private readonly twinkleFps: number;
  private readonly twinkleOnOff: number;
  private readonly twinkleBase: number;
  private readonly twinkleSpan: number;
  private readonly ivelScale: number;
  private readonly drag: number;
  private readonly spin0: number;
  private readonly spin0Var: number;
  private readonly spinRate: number;
  private readonly spinRateVar: number;
  private readonly windX: number;
  private readonly windY: number;
  private readonly windZ: number;
  private readonly windTime: number;
  private readonly followSlope: number;
  private readonly followIntercept: number;
  private readonly layerScale: Float32Array | null;
  private readonly p0: readonly number[] | null;
  private readonly p1: readonly number[] | null;
  private readonly spline: SplinePath | null;
  private readonly groundY: number;

  // State.
  /** Where this emitter is reading the table. */
  private ri: number;
  private accumulator = 0;
  private burstPending = false;
  private px = 0;
  private py = 0;
  private pz = 0;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private followX = 0;
  private followY = 0;
  private followZ = 0;
  private burstX = 0;
  private burstY = 0;
  private burstZ = 0;
  private velTimer = 0;
  private parentVx = 0;
  private parentVy = 0;
  private parentVz = 0;
  private hasTransform = false;
  private spawnTime = 0;
  private ox = 0;
  private oy = 0;
  private oz = 0;

  constructor(
    readonly data: FxParticle,
    private readonly globalLoops: readonly number[],
    env: EmitterEnv,
  ) {
    const f = data.flags;
    this.flags = f;
    this.type = data.type;
    this.local = (f & F_LOCAL) !== 0;
    this.head = (f & F_HEAD) !== 0;
    this.tail = (f & F_TAIL) !== 0;
    this.sorted = (f & F_SORT) !== 0;
    this.aligned = (f & F_ALIGN) !== 0;
    this.flat = (f & F_FLAT) !== 0;
    this.multi = !!data.multi;
    this.groundY = env.groundY;
    this.ri = env.seed & RND_MASK;

    // SetTextureDimensions refuses anything but powers of two, leaving one cell.
    const pot = (v: number | undefined) => (v && v > 0 && (v & (v - 1)) === 0 ? v : 0);
    const dims = pot(data.rows ?? 1) && pot(data.cols ?? 1);
    const rows = dims ? (data.rows ?? 1) : 1;
    const cols = dims ? (data.cols ?? 1) : 1;
    this.rows = rows;
    this.cols = cols;
    this.cellW = 1 / cols;
    this.cellH = 1 / rows;
    let shift = -1;
    for (let i = cols; i > 0; i >>= 1) shift++;
    this.cellShift = shift;
    const cells = rows * cols;

    this.scaleVarX = data.scaleVar?.[0] ?? 0;
    this.scaleVarY = data.scaleVar?.[1] ?? 0;
    this.lifeVar = data.lifeVar ?? 0;
    this.rateVar = data.rateVar ?? 0;
    this.tailLength = data.tailLength ?? 0;
    const tw = data.twinkle ?? [10, 1, 1, 1];
    this.twinkleFps = tw[0];
    this.twinkleOnOff = tw[1];
    this.twinkleBase = tw[2];
    this.twinkleSpan = tw[3] - tw[2];
    this.ivelScale = data.inherit ?? 1;
    this.drag = data.drag ?? 0;
    const spin = data.spin ?? [0, 0, 0, 0];
    this.spin0 = spin[0];
    this.spin0Var = spin[1];
    this.spinRate = spin[2];
    this.spinRateVar = spin[3];

    const wind = data.wind ?? [0, 0, 0, 0];
    this.windTime = wind[3];
    if (this.local) {
      this.windX = wind[0];
      this.windY = wind[1];
      this.windZ = wind[2];
    } else {
      this.windX = wind[1];
      this.windY = wind[2];
      this.windZ = wind[0];
    }
    const follow = data.follow ?? [0, 0, 0, 0];
    const speedDelta = follow[2] - follow[0];
    if (Math.abs(speedDelta) < EPS) {
      this.followSlope = 0;
      this.followIntercept = 0;
    } else {
      this.followSlope = (follow[3] - follow[1]) / speedDelta;
      this.followIntercept = follow[1] - follow[0] * this.followSlope;
    }

    // ---- life curves, sampled once
    const lut = new Float32Array(LUT_SIZE * 6);
    const tmp = new Float32Array(3);
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      curveAt(data.color, t, tmp, 3);
      lut[i * 6] = tmp[0]! / 255;
      lut[i * 6 + 1] = tmp[1]! / 255;
      lut[i * 6 + 2] = tmp[2]! / 255;
      curveAt(data.alpha, t, tmp, 1);
      lut[i * 6 + 3] = tmp[0]!;
      curveAt(data.scale, t, tmp, 2);
      lut[i * 6 + 4] = tmp[0]!;
      lut[i * 6 + 5] = tmp[1]!;
    }
    this.lut = lut;
    const single = (c: FxLifeCurve | undefined) => {
      if (!c) return null;
      const out = new Float32Array(LUT_SIZE);
      for (let i = 0; i < LUT_SIZE; i++) {
        curveAt(c, i / (LUT_SIZE - 1), tmp, 1);
        out[i] = tmp[0]!;
      }
      return out;
    };
    this.cutLut = single(data.cut);
    this.headLut = single(data.head);
    this.tailLut = single(data.tail);
    // Drawn once per emitter (client 0x101199F20), and only with a track.
    this.baseTile = f & F_RANDOM_BASE_TILE && cells > 1 && (data.head || data.tail) ? Math.floor(RND[this.ri]! * cells) : 0;

    // ---- layers of a three-texture emitter
    if (data.multi) {
      this.layerScale = new Float32Array(data.multi.scale);
      this.p0 = data.multi.p0;
      this.p1 = data.multi.p1;
    } else {
      this.layerScale = null;
      this.p0 = null;
      this.p1 = null;
    }
    this.spline = data.spline && data.spline.length >= 12 ? new SplinePath(data.spline) : null;

    // ---- parameters: a constant set now, a track bound for later
    this.bind(data.speed, 0, (v) => {
      this.speed = v[0]!;
    });
    // The client's default with no keys: Params::Params.
    this.bind(data.speedVar, 0.1, (v) => {
      this.variation = v[0]!;
    });
    this.bind(data.lat, 0, (v) => {
      this.latitude = v[0]!;
    });
    this.bind(data.lon, 0, (v) => {
      this.longitude = v[0]!;
    });
    this.bindGravity(data.gravity);
    this.bind(data.life, 0, (v) => {
      this.life = v[0]!;
    });
    this.bind(data.rate, 0, (v) => {
      this.rate = v[0]!;
    });
    this.bind(data.width, 0, (v) => {
      this.width = v[0]!;
    });
    this.bind(data.length, 0, (v) => {
      this.height = v[0]!;
    });
    this.bind(data.zsource, 0, (v) => {
      this.zsource = Math.abs(v[0]!) < MIN_ZSOURCE ? 0 : v[0]!;
    });
    this.bind(data.visible, 1, (v) => {
      this.visible = v[0]! > 0;
    });

    // ---- capacity: every particle a burst or the top rate can have alive at once
    const topRate = Math.max(0, maxOf(data.rate, 0)) + Math.abs(this.rateVar);
    const topLife = Math.max(0.001, maxOf(data.life, 0) + Math.abs(this.lifeVar));
    const cap = Math.ceil(topRate * topLife * 1.25) + Math.ceil(topRate) + 8;
    this.capacity = Math.min(MAX_PARTICLES, Math.max(8, cap));
    this.p = new Float32Array(this.capacity * P_STRIDE);
    this.order = this.sorted ? new Int32Array(this.capacity) : null;
    this.depth = this.sorted ? new Float32Array(this.capacity) : null;
  }

  private bind(v: FxValue | undefined, fallback: number, apply: (x: Float32Array) => void): void {
    SCRATCH[0] = firstOf(v, fallback);
    apply(SCRATCH);
    if (v !== undefined && typeof v === "object" && !Array.isArray(v) && Object.keys(v.clips).length > 0) {
      this.tracks.push(new ParamTrack(v, this.globalLoops, apply));
    }
  }

  private bindGravity(v: FxValue | undefined): void {
    const apply = (g: Float32Array, stride: number) => {
      // A number g is (0, 0, -g). A vector is retail's own and adds as it stands.
      const rx = stride >= 3 ? g[0]! : 0;
      const ry = stride >= 3 ? g[1]! : 0;
      const rz = stride >= 3 ? g[2]! : -g[0]!;
      if (this.local) {
        this.gx = rx;
        this.gy = ry;
        this.gz = rz;
      } else {
        this.gx = ry;
        this.gy = rz;
        this.gz = rx;
      }
    };
    if (v === undefined) {
      SCRATCH[0] = 0;
      apply(SCRATCH, 1);
      return;
    }
    if (typeof v === "number") {
      SCRATCH[0] = v;
      apply(SCRATCH, 1);
      return;
    }
    if (Array.isArray(v)) {
      SCRATCH[0] = v[0] ?? 0;
      SCRATCH[1] = v[1] ?? 0;
      SCRATCH[2] = v[2] ?? 0;
      apply(SCRATCH, 3);
      return;
    }
    const raw = v.clips["*"] ?? Object.values(v.clips)[0];
    const first = raw?.[1][0];
    if (Array.isArray(first)) {
      SCRATCH[0] = first[0]!;
      SCRATCH[1] = first[1]!;
      SCRATCH[2] = first[2]!;
      apply(SCRATCH, 3);
      this.tracks.push(new ParamTrack(v, this.globalLoops, (x) => apply(x, 3)));
    } else {
      SCRATCH[0] = (first as number | undefined) ?? 0;
      apply(SCRATCH, 1);
      this.tracks.push(new ParamTrack(v, this.globalLoops, (x) => apply(x, 1)));
    }
  }

  setClip(id: string | null): void {
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.setClip(id);
  }

  // --- The frame ------------------------------------------------------------

  /** True when there is anything for this emitter to do or draw. */
  get active(): boolean {
    return this.live > 0 || (this.enabled && this.visible);
  }

  /**
   * The emitter's frame for this update. `b` is its bone's world matrix, column-major,
   * in Y-up axes, and (px, py, pz) its model-space position. Retail's frame is
   * bone * T(position) * R, with R taking the emitter's X to retail +Y and its Y to
   * retail -X: in Y-up axes, x -> x, y -> -z, z -> y.
   */
  setTransform(b: ArrayLike<number>): void {
    const pos = this.data.pos;
    const x = pos[0];
    const y = pos[1];
    const z = pos[2];
    const m = this.xform;
    this.px = this.hasTransform ? m[12]! : b[0]! * x + b[4]! * y + b[8]! * z + b[12]!;
    this.py = this.hasTransform ? m[13]! : b[1]! * x + b[5]! * y + b[9]! * z + b[13]!;
    this.pz = this.hasTransform ? m[14]! : b[2]! * x + b[6]! * y + b[10]! * z + b[14]!;
    this.hasTransform = true;
    m[0] = b[0]!;
    m[1] = b[1]!;
    m[2] = b[2]!;
    m[3] = 0;
    m[4] = -b[8]!;
    m[5] = -b[9]!;
    m[6] = -b[10]!;
    m[7] = 0;
    m[8] = b[4]!;
    m[9] = b[5]!;
    m[10] = b[6]!;
    m[11] = 0;
    m[12] = b[0]! * x + b[4]! * y + b[8]! * z + b[12]!;
    m[13] = b[1]! * x + b[5]! * y + b[9]! * z + b[13]!;
    m[14] = b[2]! * x + b[6]! * y + b[10]! * z + b[14]!;
    m[15] = 1;
    this.cx = m[12]!;
    this.cy = m[13]!;
    this.cz = m[14]!;
    // Not Math.hypot: it is a real call, and each of its arguments would be boxed.
    this.xformScale = Math.sqrt(m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!);
  }

  updateParams(): void {
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.update();
  }

  /** CParticleEmitter2::Update of `frameDt`, after setTransform and updateParams. */
  update(): void {
    const dt = this.frameDt;
    const emitting = this.enabled && this.visible;
    if (this.flags & F_BURST) {
      if (emitting && this.rate > 0) {
        if (!this.burstFired) this.burstPending = true;
        this.burstFired = true;
      } else {
        this.burstFired = false;
      }
    }
    if (Math.abs(dt) < EPS) return;

    if (this.flags & F_FOLLOW) {
      let fx = this.cx - this.px;
      let fy = this.cy - this.py;
      let fz = this.cz - this.pz;
      const lengthSq = fx * fx + fy * fy + fz * fz;
      const speed = lengthSq > 0 ? Math.sqrt(lengthSq) / dt : 0;
      const follow = Math.max(0, Math.min(1, speed * this.followSlope + this.followIntercept));
      fx *= follow;
      fy *= follow;
      fz *= follow;
      this.followX = fx;
      this.followY = fy;
      this.followZ = fz;
    }
    if (this.flags & F_INHERIT) {
      this.velTimer += dt;
      if (this.velTimer > VEL_UPDATE_TIME) {
        const rate = this.velTimer * 29.999998;
        this.velTimer = 0;
        if (this.live > 0) {
          const scale = (1 / rate) * this.ivelScale;
          this.parentVx = (this.cx - this.px) * scale;
          this.parentVy = (this.cy - this.py) * scale;
          this.parentVz = (this.cz - this.pz) * scale;
        } else {
          this.parentVx = this.parentVy = this.parentVz = 0;
        }
      }
    }
    // InternalUpdate: a long frame runs as steps of at most 0.1 s, no more than the
    // particles' own life is worth.
    if (dt <= MAX_STEP) {
      this.burstX = this.followX;
      this.burstY = this.followY;
      this.burstZ = this.followZ;
      this.dt = dt;
      this.step();
      return;
    }
    let steps = Math.floor(dt * 10);
    const remainder = dt - steps * MAX_STEP;
    const maxSteps = Math.floor(this.life * 10);
    if (maxSteps < steps) steps = maxSteps;
    const count = Math.max(0, steps);
    const scale = 1 / (count + 1);
    this.burstX = this.followX * scale;
    this.burstY = this.followY * scale;
    this.burstZ = this.followZ * scale;
    this.dt = MAX_STEP;
    for (let i = 0; i < count; i++) this.step();
    this.dt = remainder;
    this.step();
  }

  private step(): void {
    const dt = this.dt;
    if (dt <= 0) return;
    if (this.enabled) this.emit();
    const p = this.p;
    const lifeVar = this.lifeVar;
    const lifeBase = Math.max(0.001, this.life);
    let i = 0;
    while (i < this.live) {
      const o = i * P_STRIDE;
      const age = p[o + P_AGE]! + dt;
      p[o + P_AGE] = age;
      const life = lifeVar === 0 ? lifeBase : p[o + P_LIFE]!;
      if (age < life && this.move(o)) {
        i++;
        continue;
      }
      // Swap with the last: a dead one's slot goes back in use.
      this.live--;
      if (i !== this.live) {
        const last = this.live * P_STRIDE;
        for (let k = 0; k < P_STRIDE; k++) p[o + k] = p[last + k]!;
      }
    }
  }

  /** CParticleEmitter2::MoveParticle. False: it went past the sphere's centre. */
  private move(o: number): boolean {
    const p = this.p;
    const dt = this.dt;
    const age = p[o + P_AGE]!;
    let vx = p[o + P_VX]!;
    let vy = p[o + P_VX + 1]!;
    let vz = p[o + P_VX + 2]!;
    if (this.windTime > age) {
      vx += this.windX * dt;
      vy += this.windY * dt;
      vz += this.windZ * dt;
    }
    let x = p[o + P_X]!;
    let y = p[o + P_X + 1]!;
    let z = p[o + P_X + 2]!;
    if (this.flags & F_FOLLOW && dt + dt < age) {
      x += this.burstX;
      y += this.burstY;
      z += this.burstZ;
    }
    const moveX = vx * dt;
    const moveY = vy * dt;
    const moveZ = vz * dt;
    const half = dt * dt * 0.5;
    p[o + P_X] = x + moveX + this.gx * half;
    p[o + P_X + 1] = y + moveY + this.gy * half;
    p[o + P_X + 2] = z + moveZ + this.gz * half;
    vx += this.gx * dt;
    vy += this.gy * dt;
    vz += this.gz * dt;
    if (this.drag !== 0) {
      const drag = Math.min(1, dt * this.drag);
      vx -= drag * vx;
      vy -= drag * vy;
      vz -= drag * vz;
    }
    p[o + P_VX] = vx;
    p[o + P_VX + 1] = vy;
    p[o + P_VX + 2] = vz;
    if (this.multi) {
      p[o + P_L1] = fract(p[o + P_L1]! + p[o + P_L1V]! * dt);
      p[o + P_L1 + 1] = fract(p[o + P_L1 + 1]! + p[o + P_L1V + 1]! * dt);
      p[o + P_L2] = fract(p[o + P_L2]! + p[o + P_L2V]! * dt);
      p[o + P_L2 + 1] = fract(p[o + P_L2 + 1]! + p[o + P_L2V + 1]! * dt);
    }
    if (this.type === 2 && this.flags & F_KILL_AT_CENTER) {
      const nx = p[o + P_X]! - (this.local ? 0 : this.cx);
      const ny = p[o + P_X + 1]! - (this.local ? 0 : this.cy);
      const nz = p[o + P_X + 2]! - (this.local ? 0 : this.cz);
      if (nx * moveX + ny * moveY + nz * moveZ > 0) return false;
    }
    return true;
  }

  /** CParticleEmitter2::EmitNewParticles. */
  private emit(): void {
    const dt = this.dt;
    const emitting = this.visible;
    const baseRate = this.flags & F_BURST ? this.rate : emitting ? this.rate : 0;
    let rate = baseRate;
    if (this.type === 3) rate *= Math.max(0, Math.min(1, this.height));
    if (this.rateVar !== 0) {
      this.ri = (this.ri + 1) & RND_MASK;
      rate += (1 - 2 * RND[this.ri]!) * this.rateVar;
    }
    if (this.burstPending) {
      let burst = Math.trunc(rate);
      this.spawnTime = 0;
      this.ox = this.cx;
      this.oy = this.cy;
      this.oz = this.cz;
      while (this.live < this.capacity && burst-- > 0) this.spawn();
      this.burstPending = false;
    }
    if (!emitting || this.flags & F_BURST) return;

    this.accumulator += rate * dt;
    let count = Math.trunc(this.accumulator + 0.5);
    let emitted = 0;
    this.spawnTime = dt;
    if (this.flags & F_INTERP_SPAWN) {
      const dx = this.cx - this.px;
      const dy = this.cy - this.py;
      const dz = this.cz - this.pz;
      while (count-- > 0 && this.live < this.capacity) {
        this.ri = (this.ri + 1) & RND_MASK;
        const t = RND[this.ri]!;
        this.ox = this.px + dx * t;
        this.oy = this.py + dy * t;
        this.oz = this.pz + dz * t;
        this.spawn();
        emitted++;
      }
    } else {
      this.ox = this.cx;
      this.oy = this.cy;
      this.oz = this.cz;
      while (count-- > 0 && this.live < this.capacity) {
        this.spawn();
        emitted++;
      }
    }
    this.accumulator -= emitted;
  }

  /** CreateParticle of the emitter's type, then what the client reads from its seed. */
  private spawn(): void {
    const o = this.live * P_STRIDE;
    const p = this.p;
    const r = RND;
    let ri = this.ri;
    this.live++;
    p[o + P_AGE] = r[(ri = (ri + 1) & RND_MASK)]! * this.spawnTime;
    const life = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.lifeVar + this.life;
    p[o + P_LIFE] = life > 0.001 ? life : 0.001;

    let x = 0;
    let y = 0;
    let z = 0;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    const speed = ((1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.variation + 1) * this.speed;
    if (this.type === 2) {
      // CSphereParticleEmitter: width and length are the radii.
      const radius = r[(ri = (ri + 1) & RND_MASK)]! * (this.height - this.width) + this.width;
      const lat = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.latitude;
      const lon = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.longitude;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);
      const dx = cosLon * cosLat;
      const dy = cosLat * sinLon;
      x = dx * radius;
      y = dy * radius;
      z = radius * sinLat;
      if (this.zsource !== 0) {
        const fx = x;
        const fy = y;
        const fz = z - this.zsource;
        const l = fx * fx + fy * fy + fz * fz;
        const s = l > EPS ? 1 / Math.sqrt(l) : 1;
        vx = fx * s * speed;
        vy = fy * s * speed;
        vz = fz * s * speed;
      } else if (this.flags & F_VEL_Z) {
        vz = speed;
      } else {
        vx = dx * speed;
        vy = dy * speed;
        vz = sinLat * speed;
      }
    } else if (this.type === 3 && this.spline) {
      // CSplineParticleEmitter: width and length are the span.
      const start = Math.max(0, Math.min(1, this.width));
      const end = Math.max(0, Math.min(1, this.height));
      this.spline.at((end - start) * r[(ri = (ri + 1) & RND_MASK)]! + start);
      x = this.spline.x;
      y = this.spline.y;
      z = this.spline.z;
      vz = speed;
      if (this.zsource !== 0) {
        const fz = z - this.zsource;
        const s = speed / Math.sqrt(x * x + y * y + fz * fz);
        vx = x * s;
        vy = y * s;
        vz = fz * s;
      } else if (this.latitude !== 0) {
        // Up, turned about the path's tangent.
        const tx = this.spline.tx;
        const ty = this.spline.ty;
        const tz = this.spline.tz;
        const a = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.latitude;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // (0, 0, 1) by Rodrigues about (tx, ty, tz).
        const dx = ty * s + tx * tz * (1 - c);
        const dy = -tx * s + ty * tz * (1 - c);
        const dz = c + tz * tz * (1 - c);
        if (this.longitude !== 0) {
          const dist = r[(ri = (ri + 1) & RND_MASK)]! * this.longitude;
          x += dx * dist;
          y += dy * dist;
          z += dz * dist;
        }
        vx = dx * speed;
        vy = dy * speed;
        vz = dz * speed;
      }
    } else {
      // CPlaneParticleEmitter.
      x = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.width * 0.5;
      y = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.height * 0.5;
      z = 0;
      if (this.zsource === 0) {
        const lat = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.latitude;
        const lon = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.longitude;
        const sinLat = Math.sin(lat);
        vx = Math.cos(lon) * sinLat * speed;
        vy = sinLat * Math.sin(lon) * speed;
        vz = speed * Math.cos(lat);
      } else {
        const fz = z - this.zsource;
        const s = speed / Math.sqrt(x * x + y * y + fz * fz);
        vx = x * s;
        vy = y * s;
        vz = fz * s;
      }
    }
    if (this.local) {
      p[o + P_X] = x;
      p[o + P_X + 1] = y;
      p[o + P_X + 2] = z;
      p[o + P_VX] = vx;
      p[o + P_VX + 1] = vy;
      p[o + P_VX + 2] = vz;
    } else {
      const m = this.xform;
      p[o + P_X] = m[0]! * x + m[4]! * y + m[8]! * z + this.ox;
      p[o + P_X + 1] = m[1]! * x + m[5]! * y + m[9]! * z + this.oy;
      p[o + P_X + 2] = m[2]! * x + m[6]! * y + m[10]! * z + this.oz;
      p[o + P_VX] = m[0]! * vx + m[4]! * vy + m[8]! * vz;
      p[o + P_VX + 1] = m[1]! * vx + m[5]! * vy + m[9]! * vz;
      p[o + P_VX + 2] = m[2]! * vx + m[6]! * vy + m[10]! * vz;
      if (this.flags & F_PROJECT) {
        const lut = this.lut;
        p[o + P_X + 1] = Math.max(lut[4]!, lut[5]!) + this.groundY;
      }
    }
    if (this.flags & F_INHERIT) {
      const s = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.variation + 1;
      p[o + P_VX] = p[o + P_VX]! + this.parentVx * s;
      p[o + P_VX + 1] = p[o + P_VX + 1]! + this.parentVy * s;
      p[o + P_VX + 2] = p[o + P_VX + 2]! + this.parentVz * s;
    }

    // What the client derives from the particle's seed each frame, kept instead.
    const r0 = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!);
    if (this.flags & F_SEPARATE_SCALE) {
      const r1 = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!);
      p[o + P_SX] = Math.max(0.0001, r0 * this.scaleVarX + 1);
      p[o + P_SY] = Math.max(0.0001, r1 * this.scaleVarY + 1);
    } else {
      const s = Math.max(0.0001, r0 * this.scaleVarX + 1);
      p[o + P_SX] = s;
      p[o + P_SY] = s;
    }
    let spin = this.spin0Var === 0 ? this.spin0 : (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.spin0Var + this.spin0;
    let rate = this.spinRateVar === 0 ? this.spinRate : (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!) * this.spinRateVar + this.spinRate;
    if (this.flags & F_RANDOM_SPIN_SIGN && r[(ri = (ri + 1) & RND_MASK)]! < 0.5) {
      spin = -spin;
      rate = -rate;
    }
    p[o + P_SPIN] = spin;
    p[o + P_SPINRATE] = rate;
    p[o + P_CELL] = this.flags & F_RANDOM_CELL && this.rows * this.cols > 1 ? Math.floor(r[(ri = (ri + 1) & RND_MASK)]! * this.rows * this.cols) : 0;
    p[o + P_TWINKLE] = Math.floor(r[(ri = (ri + 1) & RND_MASK)]! * 128);
    if (this.multi) {
      const p0 = this.p0!;
      const p1 = this.p1!;
      const r1 = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!);
      const r2 = (1 - 2 * r[(ri = (ri + 1) & RND_MASK)]!);
      p[o + P_L1] = r[(ri = (ri + 1) & RND_MASK)]!;
      p[o + P_L1 + 1] = r[(ri = (ri + 1) & RND_MASK)]!;
      p[o + P_L1V] = p0[0]! + r1 * p1[0]!;
      p[o + P_L1V + 1] = p0[1]! + r1 * p1[1]!;
      p[o + P_L2] = r[(ri = (ri + 1) & RND_MASK)]!;
      p[o + P_L2 + 1] = r[(ri = (ri + 1) & RND_MASK)]!;
      p[o + P_L2V] = p0[2]! + r2 * p1[2]!;
      p[o + P_L2V + 1] = p0[3]! + r2 * p1[3]!;
    }
    this.ri = ri;
  }

  /** Writes what the GPU draws. Returns the instance count. */
  write(out: Float32Array): number {
    const p = this.p;
    const lut = this.lut;
    const live = this.live;
    const order = this.order;
    if (order) {
      const depth = this.depth!;
      const vz0 = this.viewZ[0]!;
      const vz1 = this.viewZ[1]!;
      const vz2 = this.viewZ[2]!;
      const vz3 = this.viewZ[3]!;
      for (let i = 0; i < live; i++) {
        const o = i * P_STRIDE;
        depth[i] = vz0 * p[o]! + vz1 * p[o + 1]! + vz2 * p[o + 2]! + vz3;
        order[i] = i;
      }
      shellSortByDepth(order, depth, live);
    }
    const scaleWithModel = (this.flags & F_XFORM_SCALE) !== 0;
    const xformScale = this.xformScale;
    const mask = this.rows * this.cols - 1;
    const twinkling = this.twinkleOnOff < 1 || this.twinkleSpan !== 0;
    // BuildVertex: with no rate and no rate variation the quad does not turn at all.
    const spins = this.spinRate !== 0 || this.spinRateVar !== 0;
    let n = 0;
    for (let i = 0; i < live; i++) {
      const o = (order ? order[i]! : i) * P_STRIDE;
      const age = p[o + P_AGE]!;
      let twinkle = 0;
      if (twinkling) {
        twinkle = (((this.twinkleFps * age) & 0xff) + (p[o + P_TWINKLE]! | 0)) & 0x7f;
        if (this.twinkleOnOff < 1 && this.twinkleOnOff < RND_TABLE[twinkle]!) continue;
      }
      const life = this.lifeVar === 0 ? Math.max(0.001, this.life) : p[o + P_LIFE]!;
      const t = Math.min(1, age / life);
      const f = t * (LUT_SIZE - 1);
      const a = f | 0;
      const b = a + 1 < LUT_SIZE ? a + 1 : a;
      const w = f - a;
      const la = a * 6;
      const lb = b * 6;
      let sx = (lut[la + 4]! + (lut[lb + 4]! - lut[la + 4]!) * w) * p[o + P_SX]!;
      let sy = (lut[la + 5]! + (lut[lb + 5]! - lut[la + 5]!) * w) * p[o + P_SY]!;
      if (twinkling) {
        const ts = RND_TABLE[twinkle]! * this.twinkleSpan + this.twinkleBase;
        sx *= ts;
        sy *= ts;
      }
      if (scaleWithModel) {
        sx *= xformScale;
        sy *= xformScale;
      }
      // An integer throughout: a variable holding a double on one path and an integer on
      // the other is boxed once per particle in a browser's first optimising tier.
      let head = p[o + P_CELL]! | 0;
      if (this.headLut) head = (this.baseTile + (this.headLut[a]! | 0)) & mask;
      let tailCell = 0;
      if (this.tailLut) tailCell = (this.baseTile + (this.tailLut[a]! | 0)) & mask;

      const w0 = n * INSTANCE_STRIDE;
      // a0: position, spin angle
      out[w0] = p[o + P_X]!;
      out[w0 + 1] = p[o + P_X + 1]!;
      out[w0 + 2] = p[o + P_X + 2]!;
      out[w0 + 3] = spins ? age * p[o + P_SPINRATE]! + p[o + P_SPIN]! : 0;
      // a1: velocity, tail length
      out[w0 + 4] = p[o + P_VX]!;
      out[w0 + 5] = p[o + P_VX + 1]!;
      out[w0 + 6] = p[o + P_VX + 2]!;
      out[w0 + 7] = this.flags & F_CLAMP_TAIL && this.tailLength > age ? age : this.tailLength;
      // a2: colour, alpha
      out[w0 + 8] = lut[la]! + (lut[lb]! - lut[la]!) * w;
      out[w0 + 9] = lut[la + 1]! + (lut[lb + 1]! - lut[la + 1]!) * w;
      out[w0 + 10] = lut[la + 2]! + (lut[lb + 2]! - lut[la + 2]!) * w;
      out[w0 + 11] = lut[la + 3]! + (lut[lb + 3]! - lut[la + 3]!) * w;
      // a3: half size, head cell origin
      out[w0 + 12] = sx;
      out[w0 + 13] = sy;
      out[w0 + 14] = (head & (this.cols - 1)) * this.cellW;
      out[w0 + 15] = (head >> this.cellShift) * this.cellH;
      // a4: tail cell origin, cutoff
      out[w0 + 16] = (tailCell & (this.cols - 1)) * this.cellW;
      out[w0 + 17] = (tailCell >> this.cellShift) * this.cellH;
      out[w0 + 18] = this.cutLut ? this.cutLut[a]! : 0;
      out[w0 + 19] = 0;
      // a5: layer 1 and 2 offsets
      if (this.multi) {
        out[w0 + 20] = p[o + P_L1]!;
        out[w0 + 21] = p[o + P_L1 + 1]!;
        out[w0 + 22] = p[o + P_L2]!;
        out[w0 + 23] = p[o + P_L2 + 1]!;
      }
      n++;
    }
    this.drawn = n;
    return n;
  }

  /** Layer scales of a three-texture emitter, for the shader. */
  get layers(): Float32Array | null {
    return this.layerScale;
  }

  /** For tests: a particle's position, velocity, age. */
  particle(i: number): { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number } {
    const o = i * P_STRIDE;
    const p = this.p;
    return { x: p[o]!, y: p[o + 1]!, z: p[o + 2]!, vx: p[o + 3]!, vy: p[o + 4]!, vz: p[o + 5]!, age: p[o + P_AGE]!, life: p[o + P_LIFE]! };
  }

  /** Empties it: a clip restart or a model swap. */
  reset(): void {
    this.live = 0;
    this.drawn = 0;
    this.accumulator = 0;
    this.burstFired = false;
    this.burstPending = false;
    this.hasTransform = false;
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}

/** Back to front: retail's priority queue, without one. */
function shellSortByDepth(order: Int32Array, depth: Float32Array, n: number): void {
  for (let gap = n >> 1; gap > 0; gap = gap === 2 ? 1 : (gap / 2.2) | 0) {
    for (let i = gap; i < n; i++) {
      const v = order[i]!;
      const d = depth[v]!;
      let j = i;
      while (j >= gap && depth[order[j - gap]!]! > d) {
        order[j] = order[j - gap]!;
        j -= gap;
      }
      order[j] = v;
    }
  }
}

/** A Bezier path read by arc length (C3Spline_Bezier3::IPosArclength), sampled at load. */
export class SplinePath {
  x = 0;
  y = 0;
  z = 0;
  tx = 0;
  ty = 0;
  tz = 1;
  private readonly samples: Float32Array;
  private readonly count: number;

  constructor(points: readonly number[]) {
    const segments = Math.max(1, Math.floor((points.length / 3 - 1) / 3));
    const per = 16;
    const n = segments * per + 1;
    const raw = new Float32Array(n * 4);
    let total = 0;
    let lx = 0;
    let ly = 0;
    let lz = 0;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * segments;
      const seg = Math.min(segments - 1, Math.floor(u));
      const t = u - seg;
      const s = 1 - t;
      const b0 = s * s * s;
      const b1 = 3 * s * s * t;
      const b2 = 3 * s * t * t;
      const b3 = t * t * t;
      const at = (k: number, c: number) => points[(seg * 3 + k) * 3 + c] ?? 0;
      const x = b0 * at(0, 0) + b1 * at(1, 0) + b2 * at(2, 0) + b3 * at(3, 0);
      const y = b0 * at(0, 1) + b1 * at(1, 1) + b2 * at(2, 1) + b3 * at(3, 1);
      const z = b0 * at(0, 2) + b1 * at(1, 2) + b2 * at(2, 2) + b3 * at(3, 2);
      if (i > 0) total += Math.hypot(x - lx, y - ly, z - lz);
      lx = x;
      ly = y;
      lz = z;
      raw[i * 4] = x;
      raw[i * 4 + 1] = y;
      raw[i * 4 + 2] = z;
      raw[i * 4 + 3] = total;
    }
    this.samples = raw;
    this.count = n;
    for (let i = 0; i < n; i++) raw[i * 4 + 3] = total > 0 ? raw[i * 4 + 3]! / total : i / (n - 1);
  }

  at(t: number): void {
    const s = this.samples;
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid * 4 + 3]! <= t) lo = mid;
      else hi = mid;
    }
    const a = lo * 4;
    const b = hi * 4;
    const span = s[b + 3]! - s[a + 3]!;
    const f = span > 0 ? Math.max(0, Math.min(1, (t - s[a + 3]!) / span)) : 0;
    this.x = s[a]! + (s[b]! - s[a]!) * f;
    this.y = s[a + 1]! + (s[b + 1]! - s[a + 1]!) * f;
    this.z = s[a + 2]! + (s[b + 2]! - s[a + 2]!) * f;
    const tx = s[b]! - s[a]!;
    const ty = s[b + 1]! - s[a + 1]!;
    const tz = s[b + 2]! - s[a + 2]!;
    const l = Math.hypot(tx, ty, tz) || 1;
    this.tx = tx / l;
    this.ty = ty / l;
    this.tz = tz / l;
  }
}
