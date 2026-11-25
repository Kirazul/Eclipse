// The golden motion: a wearer's placement and bones over ~16 s (idle, walk, run, stop,
// jump, a 180 turn, sit, stand, a mount-style snap; frame times varying). Written in pure
// + - * / sqrt floor, which IEEE doubles compute identically everywhere, so gen.py's copy
// (`motion_*` there) and this one produce the same bits: the test asserts the hash.
import type { PhysFrame } from '../../../src/physics/index';

export interface MotionSpec {
  seed: number;
  scale: number;
  /** Radians of independent sway per bone; 0 = every bone is the root, as Eclipse's P2 gate. */
  wobble: number;
  seconds: number;
  dts: number[];
  /** camDist2 is past the cull distance in [t0, t1). */
  cull: number[] | null;
  /** From t0 on, the model's scale is s. */
  rescale: number[] | null;
  /** A further half turn from t0 at this rate (1 = 1 s), past the first one: 360 in all. */
  spin: number[] | null;
  /** The placement's third axis flipped: det -1. */
  mirror: boolean;
}

export const DEFAULT_DTS = [1 / 30, 1 / 60, 1 / 60, 1 / 75, 1 / 144];

export interface MotionFrame {
  dt: number;
  t: number;
}

/** The frame times, drawn with a small LCG (the same in Python and JS). */
export function motionTimes(spec: MotionSpec): MotionFrame[] {
  const out: MotionFrame[] = [];
  let s = spec.seed >>> 0;
  let t = 0;
  while (t < spec.seconds) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const dt = spec.dts[(s >>> 16) % spec.dts.length]!;
    t += dt;
    out.push({ dt, t });
  }
  return out;
}

function wave(t: number, hz: number): number {
  let p = t * hz;
  p = p - Math.floor(p);
  return p < 0.5 ? 16 * p * (0.5 - p) : -16 * (p - 0.5) * (1 - p);
}

type Q4 = [number, number, number, number];

function qmul(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qnorm(q: Q4): Q4 {
  const k = 1 / Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  return [q[0] * k, q[1] * k, q[2] * k, q[3] * k];
}
/** Row major 3x3 of a unit quaternion. */
function qmat(q: Q4): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/** The 16 doubles of the placement at time t, column form, row major. */
export function placementAt(spec: MotionSpec, t: number, out: Float64Array): void {
  let x = 0;
  let y = 0;
  let z = 0;
  let pitch = 0;
  let roll = 0;
  if (1 <= t && t < 3) {
    x = 2.5 * (t - 1);
    z = 0.03 * wave(t, 2);
    roll = 0.05 * wave(t, 1);
  } else if (t >= 3) {
    x = 5;
  }
  if (3 <= t && t < 5) {
    x = 5 + 7 * (t - 3);
    z = 0.06 * wave(t, 3);
    pitch = 0.1 * wave(t, 3);
  } else if (t >= 5) {
    x = 19;
  }
  if (5 <= t && t <= 6) z = 1.6 * 4 * (t - 5) * (6 - t);
  let s = (t - 6.5) / 0.5;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  if (8 <= t && t < 10) {
    let k = (t - 8) / 0.4;
    const k2 = (10 - t) / 0.4;
    if (k2 < k) k = k2;
    if (1 < k) k = 1;
    z = -0.5 * k;
    pitch = pitch + -0.17 * k;
  }
  if (t >= 11) {
    z = z + 1;
    y = 2;
  }
  const qy = qnorm([0, 0, s, 1 - s]);
  const qp = qnorm([0, pitch * 0.5, 0, 1]);
  const qr = qnorm([roll * 0.5, 0, 0, 1]);
  let q = qmul(qmul(qy, qp), qr);
  if (spec.spin) {
    let w = (t - spec.spin[0]!) * spec.spin[1]!;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    q = qmul(qnorm([0, 0, w, 1 - w]), q);
  }
  const R = qmat(qnorm(q));
  let sc = spec.scale;
  if (spec.rescale && t >= spec.rescale[0]!) sc = spec.rescale[1]!;
  const m = spec.mirror ? -1 : 1;
  out[0] = R[0]! * sc;
  out[1] = R[1]! * sc;
  out[2] = R[2]! * sc * m;
  out[3] = x;
  out[4] = R[3]! * sc;
  out[5] = R[4]! * sc;
  out[6] = R[5]! * sc * m;
  out[7] = y;
  out[8] = R[6]! * sc;
  out[9] = R[7]! * sc;
  out[10] = R[8]! * sc * m;
  out[11] = z + 1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
}

/** Every bone's world matrix: the placement, or with wobble the placement x a sway about
 *  the bone's pivot, on an axis and at a rate of its own. */
export function bonesAt(
  spec: MotionSpec,
  t: number,
  P: Float64Array,
  pivots: Float32Array,
  bones: number,
  out: Float64Array,
): void {
  if (spec.wobble === 0) {
    for (let b = 0; b < bones; b++) for (let k = 0; k < 16; k++) out[b * 16 + k] = P[k]!;
    return;
  }
  for (let b = 0; b < bones; b++) {
    const a = spec.wobble * wave(t, 0.7 + 0.13 * (b % 5));
    const ax = b % 3;
    const R = qmat(
      qnorm([ax === 0 ? a * 0.5 : 0, ax === 1 ? a * 0.5 : 0, ax === 2 ? a * 0.5 : 0, 1]),
    );
    const px = pivots[b * 3]!;
    const py = pivots[b * 3 + 1]!;
    const pz = pivots[b * 3 + 2]!;
    // [R | pv - R pv]
    const tx = px - (R[0]! * px + R[1]! * py + R[2]! * pz);
    const ty = py - (R[3]! * px + R[4]! * py + R[5]! * pz);
    const tz = pz - (R[6]! * px + R[7]! * py + R[8]! * pz);
    const o = b * 16;
    for (let r = 0; r < 3; r++) {
      const p0 = P[r * 4]!;
      const p1 = P[r * 4 + 1]!;
      const p2 = P[r * 4 + 2]!;
      out[o + r * 4] = p0 * R[0]! + p1 * R[3]! + p2 * R[6]!;
      out[o + r * 4 + 1] = p0 * R[1]! + p1 * R[4]! + p2 * R[7]!;
      out[o + r * 4 + 2] = p0 * R[2]! + p1 * R[5]! + p2 * R[8]!;
      out[o + r * 4 + 3] = p0 * tx + p1 * ty + p2 * tz + P[r * 4 + 3]!;
    }
    out[o + 12] = 0;
    out[o + 13] = 0;
    out[o + 14] = 0;
    out[o + 15] = 1;
  }
}

export function camAt(spec: MotionSpec, t: number): number {
  return spec.cull && t >= spec.cull[0]! && t < spec.cull[1]! ? 20000 : 0;
}

/** A rolling 32-bit FNV over the IEEE bits of doubles (-0 reads as +0). */
const hF = new Float64Array(1);
const hU = new Uint32Array(hF.buffer);
export function mixDouble(h: number, x: number): number {
  hF[0] = x + 0;
  h = Math.imul(h ^ hU[0]!, 16777619);
  return Math.imul(h ^ hU[1]!, 16777619);
}
export function mixInt(h: number, x: number): number {
  return Math.imul(h ^ x, 16777619);
}
export const HASH_SEED = 0x811c9dc5 | 0;

export function emptyFrame(bones: number, pivots: Float32Array): PhysFrame {
  return {
    boneWorld: new Float64Array(bones * 16),
    pivots,
    boneCount: bones,
    placement: new Float64Array(16),
    dt: 1.5,
    camDist2: 1.5,
  };
}
