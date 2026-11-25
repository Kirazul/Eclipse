// The vector kit of the physics core: monomorphic classes of doubles and
// out-parameter helpers. Project law: nothing here allocates.
//
// RULES OF THIS FOLDER (they are what keeps a step at zero allocation in V8):
// - a helper takes object references and small integers, never a double. A
//   call V8 does not inline boxes every double argument and return value into
//   a fresh HeapNumber; a reference costs nothing. Doubles travel in fields.
// - a field is declared as a double from its first store (`= D`), so its map
//   never transitions from Smi to Double while the engine warms up.
// - no `length = 0` on a JS array (it frees the backing store): see IntVec.
// - a module constant meeting a computed double at a merge (`k < s ? k : s`, `let b = k`)
//   is written `+k`. A module constant loads typed Any, which makes the merge tagged, and
//   TurboFan then boxes the computed side into a fresh HeapNumber on every pass. `+k` is
//   typed Number and the merge stays an unboxed double.
//
// PRECISION: Eclipse's Physics.cpp runs in float. This port runs in double, as
// that same source does when it is compiled with float = double and exact
// estimates - with which it is bit for bit equal (the golden test proves it).
// So every float LITERAL of the C++ is the float's exact value here (`fround`)
// and every operation keeps the C++'s order: a + b + c stays (a + b) + c.
// The estimates: rsqrtss / rcpss cannot be reproduced in JS, so each estimate
// is the exact value and the client's one Newton step is kept as written.

export const fround = Math.fround;

/** First store of every double field, so its representation is Double from birth. */
export const D = 1.5;

export const kPi = fround(3.14159274);
export const kTiny = fround(1.17549435e-35); // 0x057A0000-class "is it zero" guards
export const kFltMin = fround(1.17549435e-38);
export const kFltMax = fround(3.40282347e38);
export const kHullRadius = fround(0.01); // every hull's radius (0x1005CEB80, 0x1005F1DE0)

export const kBodyDynamic = 0;
export const kBodyKinematic = 1;
export const kBodyStatic = 2;
export const kShapeSphere = 0;
export const kShapeCapsule = 1;
export const kShapeHull = 2;
export const kJointPrismatic = 5;
export const kJointRevolute = 6;
export const kJointShoulder = 7;
export const kJointWeld = 9;

export class V3 {
  x = D;
  y = D;
  z = D;
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
  }
}

export class Q {
  x = D;
  y = D;
  z = D;
  w = D;
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
  }
}

/** Row major, m0 m1 m2 / m3 m4 m5 / m6 m7 m8. Born zero (the C++'s Zero3()). */
export class M3 {
  m0 = D;
  m1 = D;
  m2 = D;
  m3 = D;
  m4 = D;
  m5 = D;
  m6 = D;
  m7 = D;
  m8 = D;
  constructor() {
    this.m0 = 0;
    this.m1 = 0;
    this.m2 = 0;
    this.m3 = 0;
    this.m4 = 0;
    this.m5 = 0;
    this.m6 = 0;
    this.m7 = 0;
    this.m8 = 0;
  }
}

/** A growing list of ints: it only reallocates at a new high-water mark. */
export class IntVec {
  a: Int32Array;
  n = 0;
  constructor(cap = 8) {
    this.a = new Int32Array(cap);
  }
  push(v: number): void {
    if (this.n === this.a.length) {
      const g = new Int32Array(this.a.length * 2);
      g.set(this.a);
      this.a = g;
    }
    this.a[this.n++] = v;
  }
}

export function copyV(o: V3, a: V3): void {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
}
export function zeroV(o: V3): void {
  o.x = 0;
  o.y = 0;
  o.z = 0;
}
export function copyQ(o: Q, a: Q): void {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  o.w = a.w;
}
export function copyM3(o: M3, a: M3): void {
  o.m0 = a.m0;
  o.m1 = a.m1;
  o.m2 = a.m2;
  o.m3 = a.m3;
  o.m4 = a.m4;
  o.m5 = a.m5;
  o.m6 = a.m6;
  o.m7 = a.m7;
  o.m8 = a.m8;
}
export function zeroM3(o: M3): void {
  o.m0 = 0;
  o.m1 = 0;
  o.m2 = 0;
  o.m3 = 0;
  o.m4 = 0;
  o.m5 = 0;
  o.m6 = 0;
  o.m7 = 0;
  o.m8 = 0;
}
export function addM3(o: M3, a: M3, b: M3): void {
  o.m0 = a.m0 + b.m0;
  o.m1 = a.m1 + b.m1;
  o.m2 = a.m2 + b.m2;
  o.m3 = a.m3 + b.m3;
  o.m4 = a.m4 + b.m4;
  o.m5 = a.m5 + b.m5;
  o.m6 = a.m6 + b.m6;
  o.m7 = a.m7 + b.m7;
  o.m8 = a.m8 + b.m8;
}

/** o = a x b; o may be a or b. */
export function cross(o: V3, a: V3, b: V3): void {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  o.x = ay * bz - az * by;
  o.y = az * bx - ax * bz;
  o.z = ax * by - ay * bx;
}

/** o = M v; o may be v. */
export function mulm(o: V3, M: M3, v: V3): void {
  const x = v.x;
  const y = v.y;
  const z = v.z;
  o.x = M.m0 * x + M.m1 * y + M.m2 * z;
  o.y = M.m3 * x + M.m4 * y + M.m5 * z;
  o.z = M.m6 * x + M.m7 * y + M.m8 * z;
}

/** o = a b, Hamilton product, (x, y, z, w) lanes; o may be a or b. */
export function mulq(o: Q, a: Q, b: Q): void {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const aw = a.w;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  const bw = b.w;
  o.x = aw * bx + ax * bw + ay * bz - az * by;
  o.y = aw * by - ax * bz + ay * bw + az * bx;
  o.z = aw * bz + ax * by - ay * bx + az * bw;
  o.w = aw * bw - ax * bx - ay * by - az * bz;
}

/** o = conj(a) b; o may be a or b. */
export function mulConjQ(o: Q, a: Q, b: Q): void {
  const ax = -a.x;
  const ay = -a.y;
  const az = -a.z;
  const aw = a.w;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  const bw = b.w;
  o.x = aw * bx + ax * bw + ay * bz - az * by;
  o.y = aw * by - ax * bz + ay * bw + az * bx;
  o.z = aw * bz + ax * by - ay * bx + az * bw;
  o.w = aw * bw - ax * bx - ay * by - az * bz;
}

/** o = a conj(b); o may be a or b. */
export function mulQConj(o: Q, a: Q, b: Q): void {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const aw = a.w;
  const bx = -b.x;
  const by = -b.y;
  const bz = -b.z;
  const bw = b.w;
  o.x = aw * bx + ax * bw + ay * bz - az * by;
  o.y = aw * by - ax * bz + ay * bw + az * bx;
  o.z = aw * bz + ax * by - ay * bx + az * bw;
  o.w = aw * bw - ax * bx - ay * by - az * bz;
}

/** v + 2 q.xyz x (q.xyz x v + w v), the client's rotate; o may be v. */
export function rot(o: V3, q: Q, v: V3): void {
  const ux = q.x;
  const uy = q.y;
  const uz = q.z;
  const w = q.w;
  const vx = v.x;
  const vy = v.y;
  const vz = v.z;
  const tx = uy * vz - uz * vy + vx * w;
  const ty = uz * vx - ux * vz + vy * w;
  const tz = ux * vy - uy * vx + vz * w;
  o.x = vx + (uy * tz - uz * ty) * 2;
  o.y = vy + (uz * tx - ux * tz) * 2;
  o.z = vz + (ux * ty - uy * tx) * 2;
}

/** rot(conj(q), v); o may be v. */
export function rotInv(o: V3, q: Q, v: V3): void {
  const ux = -q.x;
  const uy = -q.y;
  const uz = -q.z;
  const w = q.w;
  const vx = v.x;
  const vy = v.y;
  const vz = v.z;
  const tx = uy * vz - uz * vy + vx * w;
  const ty = uz * vx - ux * vz + vy * w;
  const tz = ux * vy - uy * vx + vz * w;
  o.x = vx + (uy * tz - uz * ty) * 2;
  o.y = vy + (uz * tx - ux * tz) * 2;
  o.z = vz + (ux * ty - uy * tx) * 2;
}

export function matOf(o: M3, q: Q): void {
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  o.m0 = 1 - 2 * (y * y + z * z);
  o.m1 = 2 * (x * y - w * z);
  o.m2 = 2 * (x * z + w * y);
  o.m3 = 2 * (x * y + w * z);
  o.m4 = 1 - 2 * (x * x + z * z);
  o.m5 = 2 * (y * z - w * x);
  o.m6 = 2 * (x * z - w * y);
  o.m7 = 2 * (y * z + w * x);
  o.m8 = 1 - 2 * (x * x + y * y);
}

/** o = a b; o must not be a or b. */
export function mulm3(o: M3, a: M3, b: M3): void {
  o.m0 = a.m0 * b.m0 + a.m1 * b.m3 + a.m2 * b.m6;
  o.m1 = a.m0 * b.m1 + a.m1 * b.m4 + a.m2 * b.m7;
  o.m2 = a.m0 * b.m2 + a.m1 * b.m5 + a.m2 * b.m8;
  o.m3 = a.m3 * b.m0 + a.m4 * b.m3 + a.m5 * b.m6;
  o.m4 = a.m3 * b.m1 + a.m4 * b.m4 + a.m5 * b.m7;
  o.m5 = a.m3 * b.m2 + a.m4 * b.m5 + a.m5 * b.m8;
  o.m6 = a.m6 * b.m0 + a.m7 * b.m3 + a.m8 * b.m6;
  o.m7 = a.m6 * b.m1 + a.m7 * b.m4 + a.m8 * b.m7;
  o.m8 = a.m6 * b.m2 + a.m7 * b.m5 + a.m8 * b.m8;
}

/** o = a^T; o must not be a. */
export function tr3(o: M3, a: M3): void {
  o.m0 = a.m0;
  o.m1 = a.m3;
  o.m2 = a.m6;
  o.m3 = a.m1;
  o.m4 = a.m4;
  o.m5 = a.m7;
  o.m6 = a.m2;
  o.m7 = a.m5;
  o.m8 = a.m8;
}

export function skew(o: M3, v: V3): void {
  o.m0 = 0;
  o.m1 = -v.z;
  o.m2 = v.y;
  o.m3 = v.z;
  o.m4 = 0;
  o.m5 = -v.x;
  o.m6 = -v.y;
  o.m7 = v.x;
  o.m8 = 0;
}

// Domino's 3x3 inverse: adjugate / det, 0 when |det| is not above the guard.
// `fast` is the position solvers': the same adjugate, 1 / det by rcp + Newton.
function inverseWith(o: M3, a: M3, fast: boolean): void {
  const r0x = a.m0;
  const r0y = a.m1;
  const r0z = a.m2;
  const r1x = a.m3;
  const r1y = a.m4;
  const r1z = a.m5;
  const r2x = a.m6;
  const r2y = a.m7;
  const r2z = a.m8;
  const c0x = r1y * r2z - r1z * r2y;
  const c0y = r1z * r2x - r1x * r2z;
  const c0z = r1x * r2y - r1y * r2x;
  const c1x = r2y * r0z - r2z * r0y;
  const c1y = r2z * r0x - r2x * r0z;
  const c1z = r2x * r0y - r2y * r0x;
  const c2x = r0y * r1z - r0z * r1y;
  const c2y = r0z * r1x - r0x * r1z;
  const c2z = r0x * r1y - r0y * r1x;
  const det = r0x * c0x + r0y * c0y + r0z * c0z;
  let k = 0;
  if (Math.abs(det) > kTiny) {
    if (fast) {
      const r = 1 / det;
      k = (1 - det * r) * r + r;
    } else {
      k = 1 / det;
    }
  }
  o.m0 = c0x * k;
  o.m1 = c1x * k;
  o.m2 = c2x * k;
  o.m3 = c0y * k;
  o.m4 = c1y * k;
  o.m5 = c2y * k;
  o.m6 = c0z * k;
  o.m7 = c1z * k;
  o.m8 = c2z * k;
}
export function inverse(o: M3, a: M3): void {
  inverseWith(o, a, false);
}
export function inverseFast(o: M3, a: M3): void {
  inverseWith(o, a, true);
}

// 0x10323C300: rotation -> quaternion. The client hands it the matrix with the
// axis images as ROWS; the quaternion is built unnormalised from the largest of
// trace / diagonal and renormalised by rsqrt + Newton.
export function matQ(o: Q, M: M3): void {
  const m00 = M.m0;
  const m11 = M.m4;
  const m22 = M.m8;
  const t = m22 + 1 + (m11 + m00);
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (t >= 1) {
    x = M.m5 - M.m7;
    y = M.m6 - M.m2;
    z = M.m1 - M.m3;
    w = t;
  } else if (m00 > m11 && m00 > m22) {
    x = m00 + 1 - (m11 + m22);
    y = M.m1 + M.m3;
    z = M.m2 + M.m6;
    w = M.m5 - M.m7;
  } else if (m11 > m22) {
    x = M.m1 + M.m3;
    y = m11 + 1 - (m00 + m22);
    z = M.m7 + M.m5;
    w = M.m6 - M.m2;
  } else {
    x = M.m2 + M.m6;
    y = M.m7 + M.m5;
    z = 1 - (m11 + m00) + m22;
    w = M.m1 - M.m3;
  }
  const n2 = z * z + w * w + (x * x + y * y);
  const r = 1 / Math.sqrt(n2);
  const k = r * -0.5 * (n2 * r * r + -3);
  o.x = x * k;
  o.y = y * k;
  o.z = z * k;
  o.w = w * k;
}

/** Registers of `atanApprox`: doubles cross the call in fields, unboxed. */
export class AtanReg {
  y = D;
  x = D;
  r = D;
}

const kAtan = fround(0.28);
const kHalfPi = kPi * 0.5;

// The client's fast atan2 (0.28 rational form), every quadrant as written
// (shoulder prepare 0x1006021C0 twist block).
export function atanApprox(R: AtanReg): void {
  const y = R.y;
  const x = R.x;
  if (x === 0) {
    R.r = y > 0 ? +kHalfPi : y === 0 ? 0 : -kHalfPi;
    return;
  }
  const r = y / x;
  if (Math.abs(r) < 1) {
    let a = r / (1 + kAtan * r * r);
    if (x < 0) a += y >= 0 ? +kPi : -kPi;
    R.r = a;
    return;
  }
  R.r = (y >= 0 ? +kHalfPi : -kHalfPi) - r / (r * r + kAtan);
}
