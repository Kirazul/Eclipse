// The narrowphases: capsule against capsule (0x1005CD880), hull against capsule
// (0x1005DC920), hull against hull (0x1005E11D0). Port of Physics.cpp, operation
// for operation; see math.ts for the rules of this folder.
import {
  D,
  V3,
  M3,
  Q,
  copyV,
  fround,
  kFltMax,
  kFltMin,
  kHullRadius,
  kTiny,
  matOf,
  mulm,
  tr3,
  zeroV,
} from './math';

const kEps = fround(1.1920929e-7); // FLT_EPSILON
const kHullPair = fround(0.02); // both hulls' 0.01 radii make a 0.02 margin
const kCosParallel = fround(0.998782039);
const k5Deg = fround(0.99619472);
const k0005 = fround(0.005);
const k09 = fround(0.9);
const k00025 = fround(0.0025);
const k098 = fround(0.98);
const k099 = fround(0.99);
const k00004 = fround(0.0004);

// --- the data ---------------------------------------------------------------
// A hull as the client keeps it (0x1005DCA30 builds it from PLYT): vertices, face
// planes, each face's first half-edge, half-edges of 4 bytes (+0 twin offset i8,
// +1 origin vertex, +2 face, +3 next edge in the face); the file's centroid and
// volume are kept (scaled) and are what mass and centre use.
export class Hull {
  centroid = new V3();
  volume = D;
  area = D;
  v: V3[] = [];
  n: V3[] = []; // face normals
  d: number[] = []; // face plane offsets
  face: Uint8Array = EMPTY_U8; // first half-edge of each face
  edge: Uint8Array = EMPTY_U8; // 4 bytes per half-edge
  constructor() {
    this.volume = 0;
    this.area = 0;
  }
}
const EMPTY_U8 = new Uint8Array(0);

// The manifold (0x100 bytes in the client): up to 4 points, each with its world
// point, 8-byte feature key (+0x10), separation (+0x18), normal impulse (+0x1C);
// the summed normal (+0xC0); the friction state carried between steps: world
// tangent impulse (+0xD0), rolling impulse (+0xE0), twist impulse (+0xF0).
export class ManifoldPoint {
  p = new V3();
  key = 0;
  sep = D;
  Pn = D;
  constructor() {
    this.sep = 0;
    this.Pn = 0;
  }
}
export class Manifold {
  n = 0;
  pt: ManifoldPoint[] = [
    new ManifoldPoint(),
    new ManifoldPoint(),
    new ManifoldPoint(),
    new ManifoldPoint(),
  ];
  normal = new V3();
  Pt = new V3();
  Proll = new V3();
  Ptw = D;
  constructor() {
    this.Ptw = 0;
  }
}

// the hull narrowphases' GJK simplex cache (12 bytes in the client: the metric,
// then the simplex's vertex indices on A and on B; 0xFF on A ends it) and the
// hull-hull SAT cache (8 bytes: separation, two feature indices, type 1 face of A
// / 2 face of B / 3 edge pair; 0 = none)
export class ContactCache {
  metric = D;
  a = new Uint8Array(4);
  b = new Uint8Array(4);
  satSep = D;
  satA = 0;
  satB = 0;
  satType = 0;
  constructor() {
    this.reset();
  }
  reset(): void {
    this.metric = 0;
    this.a[0] = 0xff;
    this.a[1] = 0xff;
    this.a[2] = 0xff;
    this.a[3] = 0xff;
    this.b[0] = 0;
    this.b[1] = 0;
    this.b[2] = 0;
    this.b[3] = 0;
    this.satSep = 0;
    this.satA = 0;
    this.satB = 0;
    this.satType = 0;
  }
}

/** The radii cross the calls below in these registers: doubles stay unboxed. */
export class NarrowReg {
  ra = D;
  rb = D;
  r = D;
}
export const NR = new NarrowReg();

function key(iA: number, iB: number, tA: number, tB: number): number {
  return (iA & 255) | ((iB & 255) << 8) | ((tA & 255) << 16) | ((tB & 255) << 24);
}

// half-edge fields
function twin(H: Hull, e: number): number {
  return e + ((H.edge[e * 4]! << 24) >> 24);
}
function origin(H: Hull, e: number): number {
  return H.edge[e * 4 + 1]!;
}
function faceOf(H: Hull, e: number): number {
  return H.edge[e * 4 + 2]!;
}
function nextEdge(H: Hull, e: number): number {
  return H.edge[e * 4 + 3]!;
}

/** x / d by the client's rcp + one refinement, clamped to 0..1 when asked. */
class DivReg {
  x = D;
  d = D;
  r = D;
}
const DV = new DivReg();
function divN(R: DivReg): void {
  const r = 1 / R.d;
  const q = R.x * r;
  R.r = (R.x - R.d * q) * r + q;
}
function divClamp(R: DivReg): void {
  divN(R);
  const c = 1 < R.r ? 1 : R.r;
  R.r = 0 < c ? c : 0;
}

// --- capsule against capsule --------------------------------------------------
const ccA = new V3();
const ccB = new V3();
const ccDA = new V3();
const ccDB = new V3();
const ccR = new V3();
const ccAend0 = new V3();
const ccAend1 = new V3();
const ccAcc = new V3();

function ccFinish(A: V3, B: V3, k: number, m: Manifold): void {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const dz = B.z - A.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const ra = NR.ra;
  const rb = NR.rb;
  const rs = ra + rb;
  if (rs * rs < d2) return;
  const r0 = 1 / Math.sqrt(d2);
  const dist = Math.abs(d2) < kFltMin ? 0 : d2 * r0 * -0.5 * (d2 * r0 * r0 + -3);
  let nx: number;
  let ny: number;
  let nz: number;
  if (kTiny < d2) {
    const rp = (0.5 - d2 * 0.5 * (r0 * r0)) * r0 + r0;
    nx = dx * rp;
    ny = dy * rp;
    nz = dz * rp;
  } else {
    nx = 1;
    ny = 0;
    nz = 0;
  }
  m.normal.x = nx;
  m.normal.y = ny;
  m.normal.z = nz;
  m.n = 1;
  const p0 = m.pt[0]!;
  const s = (ra - rb + dist) * 0.5;
  p0.p.x = A.x + nx * s;
  p0.p.y = A.y + ny * s;
  p0.p.z = A.z + nz * s;
  p0.sep = dist - rs;
  p0.key = k;
}

/** Capsule A (a1, a2, NR.ra) against capsule B (b1, b2, NR.rb), world. The point
 *  sits between the surfaces, the normal points from A to B. */
export function capsuleCapsule(a1: V3, a2: V3, b1: V3, b2: V3, m: Manifold): void {
  m.n = 0;
  zeroV(m.normal);
  const ra = NR.ra;
  const rb = NR.rb;
  ccDA.x = a2.x - a1.x;
  ccDA.y = a2.y - a1.y;
  ccDA.z = a2.z - a1.z;
  ccDB.x = b2.x - b1.x;
  ccDB.y = b2.y - b1.y;
  ccDB.z = b2.z - b1.z;
  ccR.x = a1.x - b1.x;
  ccR.y = a1.y - b1.y;
  ccR.z = a1.z - b1.z;
  const dA = ccDA;
  const dB = ccDB;
  const r = ccR;
  const c = dA.x * r.x + dA.y * r.y + dA.z * r.z;
  const f = r.x * dB.x + r.y * dB.y + r.z * dB.z;
  const e = dB.x * dB.x + dB.y * dB.y + dB.z * dB.z;
  const a = dA.x * dA.x + dA.y * dA.y + dA.z * dA.z;
  const rs = ra + rb;
  const rs2 = rs * rs;
  const okE = e * e * 3 > kTiny;
  const okA = a * a * 3 > kTiny;
  if (!(okE && okA)) {
    // a degenerate segment
    copyV(ccA, a1);
    copyV(ccB, b1);
    if (okA) {
      DV.x = -c;
      DV.d = a;
      divClamp(DV);
      const s = DV.r;
      ccA.x = a1.x + dA.x * s;
      ccA.y = a1.y + dA.y * s;
      ccA.z = a1.z + dA.z * s;
    } else if (okE) {
      DV.x = f;
      DV.d = e;
      divClamp(DV);
      const s = DV.r;
      ccB.x = b1.x + dB.x * s;
      ccB.y = b1.y + dB.y * s;
      ccB.z = b1.z + dB.z * s;
    }
    ccFinish(ccA, ccB, 0, m);
    return;
  }
  const b = dA.x * dB.x + dA.y * dB.y + dA.z * dB.z;
  DV.x = b * b;
  DV.d = a * e;
  divN(DV);
  const cos2 = DV.r;
  if (!(kCosParallel <= cos2)) {
    // the closest points of the two lines, clamped
    let r0 = 1 / Math.sqrt(a);
    const rsA = (0.5 - a * 0.5 * (r0 * r0)) * r0 + r0;
    r0 = 1 / Math.sqrt(e);
    const rsB = (0.5 - e * 0.5 * (r0 * r0)) * r0 + r0;
    const uAx = dA.x * rsA;
    const uAy = dA.y * rsA;
    const uAz = dA.z * rsA;
    const uBx = dB.x * rsB;
    const uBy = dB.y * rsB;
    const uBz = dB.z * rsB;
    const num =
      ((uBx * r.x + uBy * r.y + uBz * r.z) * (uAx * uBx + uAy * uBy + uAz * uBz) -
        (uAx * r.x + uAy * r.y + uAz * r.z)) *
      rsA;
    DV.x = num;
    DV.d = 1 - cos2;
    divClamp(DV);
    let s = DV.r;
    DV.x = s * b + f;
    DV.d = e;
    divN(DV);
    let t = DV.r;
    if (0 <= t) {
      if (!(t <= 1)) {
        t = 1;
        DV.x = b - c;
        DV.d = a;
        divClamp(DV);
        s = DV.r;
      }
    } else {
      t = 0;
      DV.x = -c;
      DV.d = a;
      divClamp(DV);
      s = DV.r;
    }
    const iA = s === 0 ? 0 : s === 1 ? 1 : 0;
    const tA = s === 0 || s === 1 ? 2 : 1;
    const iB = t === 0 ? 0 : t === 1 ? 1 : 0;
    const tB = t === 0 || t === 1 ? 2 : 1;
    ccA.x = a1.x + dA.x * s;
    ccA.y = a1.y + dA.y * s;
    ccA.z = a1.z + dA.z * s;
    ccB.x = b1.x + dB.x * t;
    ccB.y = b1.y + dB.y * t;
    ccB.z = b1.z + dB.z * t;
    ccFinish(ccA, ccB, key(iA, iB, tA, tB), m);
    return;
  }
  // parallel: each end of A against B, at most two points; an end clamped to B
  // goes back onto A along B's normal plane, (B - a1).dB / (dA.dB), so the gap is
  // perpendicular to B (0x1005CD880)
  const invE = 1 / e;
  const invB = 1 / b;
  zeroV(ccAcc);
  zeroV(ccAend0);
  zeroV(ccAend1);
  let cnt = 0;
  for (let i = 0; i < 2; i++) {
    const P = i === 0 ? a1 : a2;
    const A = ccA;
    const B = ccB;
    let iA = 0;
    let iB = 0;
    let tA = 0;
    let tB = 0;
    const t =
      ((P.x - b1.x) * dB.x + (P.y - b1.y) * dB.y + (P.z - b1.z) * dB.z) * invE;
    let project = true;
    if (0 < t) {
      if (t < 1) {
        B.x = b1.x + dB.x * t;
        B.y = b1.y + dB.y * t;
        B.z = b1.z + dB.z * t;
        copyV(A, P);
        iA = i;
        tA = 2;
        iB = 0;
        tB = 1;
        project = false;
      } else {
        copyV(B, b2);
        iB = 1;
        tB = 2;
      }
    } else {
      copyV(B, b1);
      iB = 0;
      tB = 2;
    }
    if (project) {
      const s =
        ((B.x - a1.x) * dB.x + (B.y - a1.y) * dB.y + (B.z - a1.z) * dB.z) * invB;
      if (0 < s) {
        if (s < 1) {
          A.x = a1.x + dA.x * s;
          A.y = a1.y + dA.y * s;
          A.z = a1.z + dA.z * s;
          iA = 0;
          tA = 1;
        } else {
          copyV(A, a2);
          iA = 1;
          tA = 2;
        }
      } else {
        copyV(A, a1);
        iA = 0;
        tA = 2;
      }
    }
    copyV(i === 0 ? ccAend0 : ccAend1, A);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const dz = B.z - A.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (rs2 < d2) continue;
    const mp = m.pt[cnt]!;
    if (d2 <= kTiny) {
      mp.p.x = A.x + (ra - rb) * 0.5;
      mp.p.y = A.y + 0;
      mp.p.z = A.z + 0;
      mp.sep = -rs;
    } else {
      const r0 = 1 / Math.sqrt(d2);
      const dist =
        Math.abs(d2) < kFltMin ? 0 : d2 * r0 * -0.5 * (d2 * r0 * r0 + -3);
      const rp = (0.5 - d2 * 0.5 * (r0 * r0)) * r0 + r0;
      const k = ra - rb + dist;
      mp.p.x = dx * 0.5 * rp * k + A.x;
      mp.p.y = dy * 0.5 * rp * k + A.y;
      mp.p.z = dz * 0.5 * rp * k + A.z;
      mp.sep = dist - rs;
    }
    mp.key = key(iA, iB, tA, tB);
    ccAcc.x = ccAcc.x + dx;
    ccAcc.y = ccAcc.y + dy;
    ccAcc.z = ccAcc.z + dz;
    cnt++;
  }
  m.n = cnt;
  const l2 = ccAcc.x * ccAcc.x + ccAcc.y * ccAcc.y + ccAcc.z * ccAcc.z;
  if (kTiny < l2) {
    const r0 = 1 / Math.sqrt(l2);
    const rp = (0.5 - l2 * 0.5 * (r0 * r0)) * r0 + r0;
    m.normal.x = ccAcc.x * rp;
    m.normal.y = ccAcc.y * rp;
    m.normal.z = ccAcc.z * rp;
  } else {
    m.normal.x = 1;
    m.normal.y = 0;
    m.normal.z = 0;
  }
  if (cnt !== 0 && ccAend0.x === ccAend1.x && ccAend0.y === ccAend1.y && ccAend0.z === ccAend1.z)
    m.n = 1;
}

// --- GJK (0x1005D05A0): Box2D's b2Distance in 3D, A and B point sets in one frame.
// Warm-started from the contact's cache: the cached simplex is kept when its
// metric is within 0.25..4 x the cached one (and >= FLT_EPSILON); at most 20
// iterations; a repeated support pair ends it.
class SV {
  wA = new V3();
  wB = new V3();
  w = new V3();
  a = D;
  iA = 0;
  iB = 0;
  constructor() {
    this.a = 0;
  }
}
function copySV(o: SV, s: SV): void {
  copyV(o.wA, s.wA);
  copyV(o.wB, s.wB);
  copyV(o.w, s.w);
  o.a = s.a;
  o.iA = s.iA;
  o.iB = s.iB;
}
function mkSV(n: number): SV[] {
  const r: SV[] = [];
  for (let i = 0; i < n; i++) r.push(new SV());
  return r;
}
function mkV3(n: number): V3[] {
  const r: V3[] = [];
  for (let i = 0; i < n; i++) r.push(new V3());
  return r;
}

class GjkOut {
  pA = new V3();
  pB = new V3();
  normal = new V3();
  dist = D;
  metric = D; // the register of metricOf
}
const G = new GjkOut();
const laB = mkV3(256);
const lbB = mkV3(8);
const gS = mkSV(5);
const gSa = new Int32Array(4);
const gSb = new Int32Array(4);

function supportP(p: V3[], n: number, d: V3): number {
  let best = 0;
  const p0 = p[0]!;
  let bv = p0.x * d.x + p0.y * d.y + p0.z * d.z;
  for (let i = 1; i < n; i++) {
    const q = p[i]!;
    const v = q.x * d.x + q.y * d.y + q.z * d.z;
    if (v > bv) {
      best = i;
      bv = v;
    }
  }
  return best;
}

// the cache metric of a simplex (0x1005D08AD): squared length, squared doubled
// area, signed doubled volume; in G.metric
function metricOf(v: SV[], n: number): void {
  if (n === 2) {
    const a = v[0]!.w;
    const b = v[1]!.w;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    G.metric = ex * ex + ey * ey + ez * ez;
    return;
  }
  if (n === 3 || n === 4) {
    const a = v[0]!.w;
    const b = v[1]!.w;
    const c = v[2]!.w;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const wx = c.x - a.x;
    const wy = c.y - a.y;
    const wz = c.z - a.z;
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    if (n === 3) {
      G.metric = cx * cx + cy * cy + cz * cz;
    } else {
      const d = v[3]!.w;
      G.metric = cx * (d.x - a.x) + cy * (d.y - a.y) + cz * (d.z - a.z);
    }
    return;
  }
  G.metric = 0;
}

// closest point of triangle (a, b, c) to the origin, as barycentrics
class Bary {
  u = D;
  v = D;
  w = D;
}
const BC = new Bary();
function closestTri(a: V3, b: V3, c: V3): void {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const acz = c.z - a.z;
  const apx = -a.x;
  const apy = -a.y;
  const apz = -a.z;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    BC.u = 1;
    BC.v = 0;
    BC.w = 0;
    return;
  }
  const bpx = -b.x;
  const bpy = -b.y;
  const bpz = -b.z;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    BC.v = 1;
    BC.u = 0;
    BC.w = 0;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    BC.u = 1 - t;
    BC.v = t;
    BC.w = 0;
    return;
  }
  const cpx = -c.x;
  const cpy = -c.y;
  const cpz = -c.z;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    BC.w = 1;
    BC.u = 0;
    BC.v = 0;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    BC.u = 1 - t;
    BC.w = t;
    BC.v = 0;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    BC.v = 1 - t;
    BC.w = t;
    BC.u = 0;
    return;
  }
  const k = 1 / (va + vb + vc);
  BC.v = vb * k;
  BC.w = vc * k;
  BC.u = 1 - BC.v - BC.w;
}

const stTmp = mkSV(3);
/** t (3) reduced into out; returns the count. */
function solveTri(t: SV[], out: SV[]): number {
  closestTri(t[0]!.w, t[1]!.w, t[2]!.w);
  let k = 0;
  if (BC.u > 0) {
    copySV(stTmp[k]!, t[0]!);
    stTmp[k]!.a = BC.u;
    k++;
  }
  if (BC.v > 0) {
    copySV(stTmp[k]!, t[1]!);
    stTmp[k]!.a = BC.v;
    k++;
  }
  if (BC.w > 0) {
    copySV(stTmp[k]!, t[2]!);
    stTmp[k]!.a = BC.w;
    k++;
  }
  for (let i = 0; i < k; i++) copySV(out[i]!, stTmp[i]!);
  return k;
}

const sT = mkSV(3);
const sR = mkSV(3);
const sKeep = mkSV(3);
const F4 = new Int32Array([0, 1, 2, 3, 0, 2, 3, 1, 0, 3, 1, 2, 1, 3, 2, 0]);

// reduce the simplex to the feature nearest the origin; -1 = it holds the origin,
// otherwise the new count
function solveSimplex(s: SV[], n: number): number {
  if (n === 1) {
    s[0]!.a = 1;
    return 1;
  }
  if (n === 2) {
    const a = s[0]!.w;
    const b = s[1]!.w;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const ez = b.z - a.z;
    const d2 = -(a.x * ex + a.y * ey + a.z * ez);
    if (d2 <= 0) {
      s[0]!.a = 1;
      return 1;
    }
    const d1 = b.x * ex + b.y * ey + b.z * ez;
    if (d1 <= 0) {
      s[1]!.a = 1;
      copySV(s[0]!, s[1]!);
      return 1;
    }
    const k = 1 / (d1 + d2);
    s[0]!.a = d1 * k;
    s[1]!.a = d2 * k;
    return 2;
  }
  if (n === 3) {
    copySV(sT[0]!, s[0]!);
    copySV(sT[1]!, s[1]!);
    copySV(sT[2]!, s[2]!);
    return solveTri(sT, s);
  }
  // inside = strictly on the opposite vertex's side of every face; otherwise the
  // nearest of all four faces (a flat tetrahedron - four points of one hull face -
  // has no inside and is solved by its nearest triangle)
  let inside = true;
  for (let f = 0; f < 4; f++) {
    const a = s[F4[f * 4]!]!.w;
    const b = s[F4[f * 4 + 1]!]!.w;
    const c = s[F4[f * 4 + 2]!]!.w;
    const d = s[F4[f * 4 + 3]!]!.w;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const wx = c.x - a.x;
    const wy = c.y - a.y;
    const wz = c.z - a.z;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const o = -a.x * nx + -a.y * ny + -a.z * nz;
    const e = (d.x - a.x) * nx + (d.y - a.y) * ny + (d.z - a.z) * nz;
    if (!(o * e > 0)) {
      inside = false;
      break;
    }
  }
  if (inside) return -1;
  let best = +kFltMax;
  let keepN = 0;
  for (let f = 0; f < 4; f++) {
    copySV(sT[0]!, s[F4[f * 4]!]!);
    copySV(sT[1]!, s[F4[f * 4 + 1]!]!);
    copySV(sT[2]!, s[F4[f * 4 + 2]!]!);
    const rn = solveTri(sT, sR);
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i < rn; i++) {
      const r = sR[i]!;
      px = px + r.w.x * r.a;
      py = py + r.w.y * r.a;
      pz = pz + r.w.z * r.a;
    }
    const d2 = px * px + py * py + pz * pz;
    if (d2 < best) {
      best = d2;
      keepN = rn;
      for (let i = 0; i < rn; i++) copySV(sKeep[i]!, sR[i]!);
    }
  }
  for (let i = 0; i < keepN; i++) copySV(s[i]!, sKeep[i]!);
  return keepN;
}

const gD = new V3();
const gND = new V3();

// the result in G
function gjk(A: V3[], nA0: number, B: V3[], nB0: number, cache: ContactCache): void {
  const ox = B[0]!.x; // everything relative to B's first point, as the client does
  const oy = B[0]!.y;
  const oz = B[0]!.z;
  const nA = nA0 < 256 ? nA0 : 256;
  const nB = nB0 < 8 ? nB0 : 8;
  for (let i = 0; i < nA; i++) {
    const p = A[i]!;
    const q = laB[i]!;
    q.x = p.x - ox;
    q.y = p.y - oy;
    q.z = p.z - oz;
  }
  for (let i = 0; i < nB; i++) {
    const p = B[i]!;
    const q = lbB[i]!;
    q.x = p.x - ox;
    q.y = p.y - oy;
    q.z = p.z - oz;
  }
  const s = gS;
  let n = 0;
  while (n < 4 && cache.a[n]! !== 0xff) n++;
  for (let i = 0; i < n; i++) {
    const v = s[i]!;
    const ca = cache.a[i]!;
    const cb = cache.b[i]!;
    v.iA = ca < nA - 1 ? ca : nA - 1;
    v.iB = cb < nB - 1 ? cb : nB - 1;
    copyV(v.wA, laB[v.iA]!);
    copyV(v.wB, lbB[v.iB]!);
    v.w.x = v.wB.x - v.wA.x;
    v.w.y = v.wB.y - v.wA.y;
    v.w.z = v.wB.z - v.wA.z;
  }
  if (n > 1) {
    metricOf(s, n);
    const m2 = G.metric;
    const m1 = cache.metric;
    if (!(m2 >= 0.25 * m1 && !(4 * m1 < m2) && m2 >= kEps)) n = 0;
  }
  if (n === 0) {
    const v = s[0]!;
    v.iA = 0;
    v.iB = 0;
    copyV(v.wA, laB[0]!);
    copyV(v.wB, lbB[0]!);
    v.w.x = v.wB.x - v.wA.x;
    v.w.y = v.wB.y - v.wA.y;
    v.w.z = v.wB.z - v.wA.z;
    n = 1;
  }
  let overlap = false;
  for (let iter = 0; iter < 20; iter++) {
    const sn = n;
    for (let i = 0; i < n; i++) {
      gSa[i] = s[i]!.iA;
      gSb[i] = s[i]!.iB;
    }
    const got = solveSimplex(s, n);
    if (got < 0) {
      overlap = true;
      break;
    }
    n = got;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const v = s[i]!;
      cx = cx + v.w.x * v.a;
      cy = cy + v.w.y * v.a;
      cz = cz + v.w.z * v.a;
    }
    gD.x = -cx;
    gD.y = -cy;
    gD.z = -cz;
    if (gD.x * gD.x + gD.y * gD.y + gD.z * gD.z < kEps * kEps) break;
    const v = s[n]!;
    gND.x = -gD.x;
    gND.y = -gD.y;
    gND.z = -gD.z;
    v.iA = supportP(laB, nA, gND);
    copyV(v.wA, laB[v.iA]!);
    v.iB = supportP(lbB, nB, gD);
    copyV(v.wB, lbB[v.iB]!);
    v.w.x = v.wB.x - v.wA.x;
    v.w.y = v.wB.y - v.wA.y;
    v.w.z = v.wB.z - v.wA.z;
    let dup = false;
    for (let i = 0; i < sn; i++) {
      if (gSa[i]! === v.iA && gSb[i]! === v.iB) {
        dup = true;
        break;
      }
    }
    if (dup) break;
    n++;
  }
  if (overlap) {
    s[0]!.a = 0.25;
    s[1]!.a = 0.25;
    s[2]!.a = 0.25;
    s[3]!.a = 0.25;
  }
  let pAx = 0;
  let pAy = 0;
  let pAz = 0;
  let pBx = 0;
  let pBy = 0;
  let pBz = 0;
  for (let i = 0; i < n; i++) {
    const v = s[i]!;
    pAx = pAx + v.wA.x * v.a;
    pAy = pAy + v.wA.y * v.a;
    pAz = pAz + v.wA.z * v.a;
    pBx = pBx + v.wB.x * v.a;
    pBy = pBy + v.wB.y * v.a;
    pBz = pBz + v.wB.z * v.a;
  }
  if (overlap) {
    pBx = pAx;
    pBy = pAy;
    pBz = pAz;
  }
  const nx = pBx - pAx;
  const ny = pBy - pAy;
  const nz = pBz - pAz;
  G.normal.x = nx;
  G.normal.y = ny;
  G.normal.z = nz;
  G.dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
  G.pA.x = pAx + ox;
  G.pA.y = pAy + oy;
  G.pA.z = pAz + oz;
  G.pB.x = pBx + ox;
  G.pB.y = pBy + oy;
  G.pB.z = pBz + oz;
  metricOf(s, n);
  cache.metric = G.metric;
  for (let i = 0; i < 4; i++) {
    cache.a[i] = i < n ? s[i]!.iA : 0xff;
    cache.b[i] = i < n ? s[i]!.iB : 0;
  }
}

// 0x1005D1780 with both radii 0: the closest points of segments (P1, Q1), (P2, Q2)
function closestSegSeg(P1: V3, Q1: V3, P2: V3, Q2: V3, c1: V3, c2: V3): void {
  const d1x = Q1.x - P1.x;
  const d1y = Q1.y - P1.y;
  const d1z = Q1.z - P1.z;
  const d2x = Q2.x - P2.x;
  const d2y = Q2.y - P2.y;
  const d2z = Q2.z - P2.z;
  const rx = P1.x - P2.x;
  const ry = P1.y - P2.y;
  const rz = P1.z - P2.z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const okE = e * e * 3 > kTiny;
  const okA = a * a * 3 > kTiny;
  let s = 0;
  let t = 0;
  if (!okE && !okA) {
    copyV(c1, P1);
    const gx = P2.x - P1.x;
    const gy = P2.y - P1.y;
    const gz = P2.z - P1.z;
    copyV(c2, gx * gx + gy * gy + gz * gz > kTiny ? P2 : P1);
    return;
  }
  const f = d2x * rx + d2y * ry + d2z * rz;
  if (!okA) {
    DV.x = f;
    DV.d = e;
    divClamp(DV);
    t = DV.r;
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (!okE) {
      DV.x = -c;
      DV.d = a;
      divClamp(DV);
      s = DV.r;
    } else {
      const b = d2x * d1x + d2y * d1y + d2z * d1z;
      const denom = e * a - b * b;
      if (denom * denom * 3 > kTiny) {
        DV.x = b * f - e * c;
        DV.d = denom;
        divClamp(DV);
        s = DV.r;
      } else {
        s = 0;
      }
      DV.x = b * s + f;
      DV.d = e;
      divN(DV);
      t = DV.r;
      if (!(0 <= t)) {
        t = 0;
        DV.x = -c;
        DV.d = a;
        divClamp(DV);
        s = DV.r;
      } else if (!(t <= 1)) {
        t = 1;
        DV.x = b - c;
        DV.d = a;
        divClamp(DV);
        s = DV.r;
      }
    }
  }
  const c1x = P1.x + d1x * s;
  const c1y = P1.y + d1y * s;
  const c1z = P1.z + d1z * s;
  const c2x = P2.x + d2x * t;
  const c2y = P2.y + d2y * t;
  const c2z = P2.z + d2z * t;
  c1.x = c1x;
  c1.y = c1y;
  c1.z = c1z;
  const gx = c2x - c1x;
  const gy = c2y - c1y;
  const gz = c2z - c1z;
  if (!(gx * gx + gy * gy + gz * gz > kTiny)) {
    c2.x = c1x;
    c2.y = c1y;
    c2.z = c1z;
  } else {
    c2.x = c2x;
    c2.y = c2y;
    c2.z = c2z;
  }
}

// --- hull against capsule ----------------------------------------------------
class ClipPt {
  p = new V3();
  key = 0;
}
function copyClip(o: ClipPt, a: ClipPt): void {
  copyV(o.p, a.p);
  o.key = a.key;
}
const fcCur = [new ClipPt(), new ClipPt(), new ClipPt()];
const fcNxt = [new ClipPt(), new ClipPt(), new ClipPt()];

// 0x1005DBAB0: the capsule's segment clipped to hull face f's side planes (its
// half-edges in `next` order; a side plane under the guard is skipped, the first
// one ends it); fewer than 2 points after a plane = no contact. A point within
// (d + 0.01) + r of the face is kept on the capsule's surface. r = NR.r.
function faceCapsule(H: Hull, f: number, c1: V3, c2: V3, m: Manifold): void {
  m.n = 0;
  const r = NR.r;
  const n = H.n[f]!;
  const cur0 = fcCur[0]!;
  const cur1 = fcCur[1]!;
  copyV(cur0.p, c1);
  cur0.key = key(f, 0, 0, 2);
  copyV(cur1.p, c2);
  cur1.key = key(f, 1, 0, 2);
  const e0 = H.face[f]!;
  let e = e0;
  const P0 = H.v[origin(H, e0)]!;
  let Px = P0.x;
  let Py = P0.y;
  let Pz = P0.z;
  let first = true;
  do {
    const en = nextEdge(H, e);
    const Qv = H.v[origin(H, en)]!;
    const ex = Qv.x - Px;
    const ey = Qv.y - Py;
    const ez = Qv.z - Pz;
    let Nx = ey * n.z - ez * n.y;
    let Ny = ez * n.x - ex * n.z;
    let Nz = ex * n.y - ey * n.x;
    const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
    if (l2 > kTiny) {
      const r0 = 1 / Math.sqrt(l2);
      const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
      Nx = Nx * kk;
      Ny = Ny * kk;
      Nz = Nz * kk;
      const dP = Px * Nx + Py * Ny + Pz * Nz;
      const dA = cur0.p.x * Nx + cur0.p.y * Ny + cur0.p.z * Nz - dP;
      const dB = cur1.p.x * Nx + cur1.p.y * Ny + cur1.p.z * Nz - dP;
      let k = 0;
      if (!(0 < dA)) copyClip(fcNxt[k++]!, cur0);
      if (!(0 < dB)) copyClip(fcNxt[k++]!, cur1);
      if (!(0 <= dA * dB)) {
        const den = dA - dB;
        const rc = 1 / den;
        const t1x = (cur1.p.x - cur0.p.x) * dA;
        const t1y = (cur1.p.y - cur0.p.y) * dA;
        const t1z = (cur1.p.z - cur0.p.z) * dA;
        const qx = t1x * rc;
        const qy = t1y * rc;
        const qz = t1z * rc;
        const nn = fcNxt[k++]!;
        nn.p.x = (t1x - qx * den) * rc + qx + cur0.p.x;
        nn.p.y = (t1y - qy * den) * rc + qy + cur0.p.y;
        nn.p.z = (t1z - qz * den) * rc + qz + cur0.p.z;
        nn.key = key(e & 0xfe, 0, 1, 1);
      }
      if (k !== 2) return;
      copyClip(cur0, fcNxt[0]!);
      copyClip(cur1, fcNxt[1]!);
    } else if (first) {
      return;
    }
    first = false;
    Px = Qv.x;
    Py = Qv.y;
    Pz = Qv.z;
    e = en;
  } while (e !== e0);
  const thr = H.d[f]! + kHullRadius + r;
  let k = 0;
  for (let i = 0; i < 2; i++) {
    const c = i === 0 ? cur0 : cur1;
    const sep = c.p.x * n.x + c.p.y * n.y + c.p.z * n.z - thr;
    if (0 < sep) continue;
    const mp = m.pt[k]!;
    mp.p.x = c.p.x - n.x * r;
    mp.p.y = c.p.y - n.y * r;
    mp.p.z = c.p.z - n.z * r;
    mp.sep = sep;
    mp.key = c.key;
    k++;
  }
  copyV(m.normal, n);
  m.n = k;
}

// the half-edge (even of its pair) from vertex a to vertex b, -1 when none (0x1005DD9F0)
function edgeBetween(H: Hull, a: number, b: number): number {
  const ne = (H.edge.length / 4) | 0;
  for (let e = 0; e < ne; e++) {
    if (origin(H, e) === a && origin(H, twin(H, e)) === b) return e & 0xfffe;
  }
  return -1;
}

const hcSeg = [new V3(), new V3()];
const hcCA = new V3();
const hcCB = new V3();

// 0x1005DC920 -> 0x1005DC020: hull (its own frame) against a capsule (c1, c2, r =
// NR.r) in that frame. A hull carries a 0.01 radius; contacts are kept out to r +
// 0.01. GJK first: a clear gap (>= 0.005) takes the face within 5 deg of the GJK
// normal (clipped) or else one point from the GJK features; a deeper touch runs
// SAT (faces, then edges whose arcs the segment's great circle crosses, an edge
// winning only past 0.9 x best + 0.0025).
export function hullCapsule(H: Hull, c1: V3, c2: V3, m: Manifold, cache: ContactCache): void {
  m.n = 0;
  zeroV(m.normal);
  if (H.v.length === 0 || H.n.length === 0) return;
  const r = NR.r;
  const margin = r + kHullRadius;
  copyV(hcSeg[0]!, c1);
  copyV(hcSeg[1]!, c2);
  gjk(H.v, H.v.length, hcSeg, 2, cache);
  const gn = G.normal;
  const gdist = G.dist;
  if (!(gdist <= margin)) return;
  const n2 = gn.x * gn.x + gn.y * gn.y + gn.z * gn.z;
  const A = cache.a;
  const B = cache.b;
  const partial = A[0]! === 0xff || A[1]! === 0xff || A[2]! === 0xff || A[3]! === 0xff;
  if (n2 > kTiny && k0005 <= gdist && partial) {
    const r0 = 1 / Math.sqrt(n2);
    const kk = r0 * -0.5 * (n2 * r0 * r0 + -3);
    const Nx = gn.x * kk;
    const Ny = gn.y * kk;
    const Nz = gn.z * kk;
    let best = 0;
    let bv = -kFltMax;
    for (let i = 0; i < H.n.length; i++) {
      const fn = H.n[i]!;
      const d = fn.x * Nx + fn.y * Ny + fn.z * Nz;
      if (d > bv) best = i;
      bv = d < bv ? bv : d;
    }
    if (bv > k5Deg) faceCapsule(H, best, c1, c2, m);
    if (m.n !== 0) return;
    // one point; its key from the GJK simplex (vertex 2, edge 1, none 3)
    let ia = A[0]!;
    let ib = B[0]!;
    let ta = 2;
    let tb = 2;
    if (A[0]! !== 0xff && A[1]! !== 0xff) {
      if (A[2]! === 0xff) {
        const sameB = B[1]! === B[0]!;
        if (A[1]! !== A[0]!) {
          const e = edgeBetween(H, A[0]!, A[1]!);
          ia = e >= 0 ? e : 0;
          ta = e < 0 ? 3 : 1;
          if (!sameB) {
            tb = 1;
            ib = 0;
          }
        } else if (!sameB) {
          tb = 1;
          ib = 0;
        }
      } else if (A[3]! === 0xff) {
        const sameB = B[1]! === B[0]! && B[2]! === B[0]!;
        if (A[1]! !== A[0]! || A[2]! !== A[0]!) {
          const e = edgeBetween(H, A[0]!, A[1]! !== A[0]! ? A[1]! : A[2]!);
          ia = e >= 0 ? e : 0;
          ta = e < 0 ? 3 : 1;
          if (!sameB) {
            tb = 1;
            ib = 0;
          }
        } else if (!sameB) {
          tb = 1;
          ib = 0;
        }
      }
    }
    m.n = 1;
    m.normal.x = Nx;
    m.normal.y = Ny;
    m.normal.z = Nz;
    const p0 = m.pt[0]!;
    p0.p.x = G.pB.x - Nx * r;
    p0.p.y = G.pB.y - Ny * r;
    p0.p.z = G.pB.z - Nz * r;
    p0.key = key(ia, ib, ta, tb);
    p0.sep = gdist - margin;
    return;
  }
  let bestSep = -kFltMax;
  let bestIdx = -1;
  let type = 2;
  for (let i = 0; i < H.n.length; i++) {
    const fn = H.n[i]!;
    const sA = c1.x * fn.x + c1.y * fn.y + c1.z * fn.z;
    const sB = c2.x * fn.x + c2.y * fn.y + c2.z * fn.z;
    const sep = (sB <= sA ? sB : sA) - H.d[i]!;
    if (!(sep <= margin)) return;
    if (!(sep <= bestSep)) {
      bestSep = sep;
      bestIdx = i;
      type = 0;
    }
  }
  const Dx = c2.x - c1.x;
  const Dy = c2.y - c1.y;
  const Dz = c2.z - c1.z;
  const ne = (H.edge.length / 4) | 0;
  const cen = H.centroid;
  for (let e = 0; e < ne; e += 2) {
    const tw = twin(H, e);
    const na = H.n[faceOf(H, e)]!;
    const nb = H.n[faceOf(H, tw)]!;
    const dA = na.x * Dx + na.y * Dy + na.z * Dz;
    const dB = nb.x * Dx + nb.y * Dy + nb.z * Dz;
    if (dB * dA >= 0) continue;
    const P = H.v[origin(H, e)]!;
    const Qo = H.v[origin(H, tw)]!;
    const ex = Qo.x - P.x;
    const ey = Qo.y - P.y;
    const ez = Qo.z - P.z;
    let Nx = ey * Dz - ez * Dy;
    let Ny = ez * Dx - ex * Dz;
    let Nz = ex * Dy - ey * Dx;
    const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
    let sep = -kFltMax;
    if (!(l2 < kEps)) {
      const r0 = 1 / Math.sqrt(l2);
      const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
      Nx = Nx * kk;
      Ny = Ny * kk;
      Nz = Nz * kk;
      if (!(Nx * (P.x - cen.x) + Ny * (P.y - cen.y) + Nz * (P.z - cen.z) >= 0)) {
        Nx = -Nx;
        Ny = -Ny;
        Nz = -Nz;
      }
      sep = (c1.x - P.x) * Nx + (c1.y - P.y) * Ny + (c1.z - P.z) * Nz;
    }
    if (!(sep <= margin)) return;
    if (!(sep <= bestSep * k09 + k00025)) {
      bestSep = sep;
      bestIdx = e;
      type = 1;
    }
  }
  if (type === 0) {
    faceCapsule(H, bestIdx, c1, c2, m);
    return;
  }
  if (type !== 1) return;
  const e = bestIdx;
  const tw = twin(H, e);
  const P = H.v[origin(H, e)]!;
  const Qv = H.v[origin(H, tw)]!;
  closestSegSeg(P, Qv, c1, c2, hcCA, hcCB);
  const ex = Qv.x - P.x;
  const ey = Qv.y - P.y;
  const ez = Qv.z - P.z;
  let Nx = ey * Dz - ez * Dy;
  let Ny = ez * Dx - ex * Dz;
  let Nz = ex * Dy - ey * Dx;
  const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
  if (l2 < kEps) return;
  const r0 = 1 / Math.sqrt(l2);
  const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
  Nx = Nx * kk;
  Ny = Ny * kk;
  Nz = Nz * kk;
  if (!((P.x - cen.x) * Nx + (P.y - cen.y) * Ny + (P.z - cen.z) * Nz >= 0)) {
    Nx = -Nx;
    Ny = -Ny;
    Nz = -Nz;
  }
  const dx = (hcCB.x - hcCA.x) * Nx;
  const dy = (hcCB.y - hcCA.y) * Ny;
  const dz = (hcCB.z - hcCA.z) * Nz;
  m.n = 1;
  m.normal.x = Nx;
  m.normal.y = Ny;
  m.normal.z = Nz;
  const p0 = m.pt[0]!;
  p0.p.x = (hcCA.x + hcCB.x) * 0.5;
  p0.p.y = (hcCA.y + hcCB.y) * 0.5;
  p0.p.z = (hcCA.z + hcCB.z) * 0.5;
  p0.sep = dz + dx + (dy - (kHullRadius + r));
  p0.key = key(e, 0, 1, 1);
}

// --- hull against hull (0x1005E11D0 -> 0x1005E0500): Gregorius' SAT with a
// per-contact feature cache ---------------------------------------------------

// 0x1005DD8B0: the support vertex along d (measured from vertex 0, first wins)
function supportIdx(H: Hull, d: V3): number {
  let idx = 0;
  let best = 0;
  const v0 = H.v[0]!;
  for (let i = 1; i < H.v.length; i++) {
    const p = H.v[i]!;
    const s = (p.x - v0.x) * d.x + (p.y - v0.y) * d.y + (p.z - v0.z) * d.z;
    if (!(s <= best)) {
      best = s;
      idx = i;
    }
  }
  return idx;
}

// 0x1005DD940: of the faces around vertex `vert`, the one most along d
function incidentFace(H: Hull, vert: number, d: V3): number {
  let ret = -1;
  let best = -kFltMax;
  for (let f = 0; f < H.n.length; f++) {
    const fn = H.n[f]!;
    const s = fn.x * d.x + fn.y * d.y + fn.z * d.z;
    if (!(s > best)) continue;
    const e0 = H.face[f]!;
    let e = e0;
    do {
      if (origin(H, e) === vert) {
        best = s;
        ret = f;
        break;
      }
      e = nextEdge(H, e);
    } while (e !== e0);
  }
  return ret;
}

class XF {
  R = new M3();
  t = new V3();
}
/** o = X.R v + X.t; o may be v. */
function xfApply(o: V3, X: XF, v: V3): void {
  const R = X.R;
  const x = v.x;
  const y = v.y;
  const z = v.z;
  const px = R.m0 * x + R.m1 * y + R.m2 * z;
  const py = R.m3 * x + R.m4 * y + R.m5 * z;
  const pz = R.m6 * x + R.m7 * y + R.m8 * z;
  o.x = px + X.t.x;
  o.y = py + X.t.y;
  o.z = pz + X.t.z;
}

class PolyV {
  p = new V3();
  edge = 0;
  key = 0;
  sep = D;
}
function copyPoly(o: PolyV, a: PolyV): void {
  copyV(o.p, a.p);
  o.edge = a.edge;
  o.key = a.key;
  o.sep = a.sep;
}
function mkPoly(n: number): PolyV[] {
  const r: PolyV[] = [];
  for (let i = 0; i < n; i++) r.push(new PolyV());
  return r;
}
const fhA = mkPoly(33);
const fhB = mkPoly(33);
const fhKeep = mkPoly(33);

// 0x1005DB4A0: more than 4 points -> 4: furthest along a tangent, furthest from
// it, largest triangle, furthest outside it (each pick with a 0.99 hysteresis;
// under 0.02^2 stops)
function reduce(p: PolyV[], n: number, nrm: V3, m: Manifold): void {
  let ux: number;
  let uy: number;
  let uz: number;
  if (Math.abs(nrm.y) > 0.5) {
    ux = nrm.y;
    uy = -nrm.x;
    uz = 0;
  } else {
    ux = nrm.z;
    uy = 0;
    uz = -nrm.x;
  }
  {
    const l2 = ux * ux + uy * uy + uz * uz;
    const r0 = 1 / Math.sqrt(l2);
    const k = r0 * -0.5 * (l2 * r0 * r0 + -3);
    ux = ux * k;
    uy = uy * k;
    uz = uz * k;
  }
  let i0 = -1;
  let best = -kFltMax;
  for (let i = 0; i < n; i++) {
    const q = p[i]!.p;
    const d = q.x * ux + q.y * uy + q.z * uz;
    if (d * k099 > best) {
      best = d;
      i0 = i;
    }
  }
  if (i0 < 0) i0 = 0;
  putPoint(m, 0, p[i0]!);
  const a = p[i0]!.p;
  let i1 = -1;
  best = -kFltMax;
  for (let i = 0; i < n; i++) {
    const q = p[i]!.p;
    const ex = q.x - a.x;
    const ey = q.y - a.y;
    const ez = q.z - a.z;
    const d = ex * ex + ey * ey + ez * ez;
    if (d * k099 > best) {
      best = d;
      i1 = i;
    }
  }
  if (!(best >= k00004) || i1 < 0) {
    m.n = 1;
    return;
  }
  putPoint(m, 1, p[i1]!);
  const b = p[i1]!.p;
  const Ex = b.x - a.x;
  const Ey = b.y - a.y;
  const Ez = b.z - a.z;
  let i2 = -1;
  best = -kFltMax;
  for (let i = 0; i < n; i++) {
    const q = p[i]!.p;
    const fx = q.x - a.x;
    const fy = q.y - a.y;
    const fz = q.z - a.z;
    const cx = Ey * fz - Ez * fy;
    const cy = Ez * fx - Ex * fz;
    const cz = Ex * fy - Ey * fx;
    const d = Math.abs(cx * nrm.x + cy * nrm.y + cz * nrm.z);
    if (d * k099 > best) {
      best = d;
      i2 = i;
    }
  }
  if (!(best >= k00004) || i2 < 0) {
    m.n = 2;
    return;
  }
  putPoint(m, 2, p[i2]!);
  const c = p[i2]!.p;
  const afx = c.x - a.x;
  const afy = c.y - a.y;
  const afz = c.z - a.z;
  const area =
    (Ey * afz - Ez * afy) * nrm.x + (Ez * afx - Ex * afz) * nrm.y + (Ex * afy - Ey * afx) * nrm.z;
  const inv = 1 / area;
  let i3 = -1;
  best = +kFltMax;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = c.z - b.z;
  const acx = a.x - c.x;
  const acy = a.y - c.y;
  const acz = a.z - c.z;
  for (let i = 0; i < n; i++) {
    const q = p[i]!.p;
    const q0x = q.x - b.x;
    const q0y = q.y - b.y;
    const q0z = q.z - b.z;
    const q1x = q.x - c.x;
    const q1y = q.y - c.y;
    const q1z = q.z - c.z;
    const q2x = q.x - a.x;
    const q2y = q.y - a.y;
    const q2z = q.z - a.z;
    const w0 =
      (cby * q0z - cbz * q0y) * nrm.x +
      (cbz * q0x - cbx * q0z) * nrm.y +
      (cbx * q0y - cby * q0x) * nrm.z;
    const w1 =
      (acy * q1z - acz * q1y) * nrm.x +
      (acz * q1x - acx * q1z) * nrm.y +
      (acx * q1y - acy * q1x) * nrm.z;
    const w2 =
      (Ey * q2z - Ez * q2y) * nrm.x +
      (Ez * q2x - Ex * q2z) * nrm.y +
      (Ex * q2y - Ey * q2x) * nrm.z;
    const v2 = w2 * inv;
    const v1 = w1 * inv;
    const m1 = v1 < v2 ? v1 : v2; // std::min(w2 inv, w1 inv)
    const v0 = w0 * inv;
    const mn = v0 < m1 ? v0 : m1;
    if (mn * k099 < best) {
      best = mn;
      i3 = i;
    }
  }
  if (best > 0 || !(Math.abs(best * area) >= k00004) || i3 < 0) {
    m.n = 3;
    return;
  }
  putPoint(m, 3, p[i3]!);
  m.n = 4;
}
function putPoint(m: Manifold, k: number, s: PolyV): void {
  const d = m.pt[k]!;
  copyV(d.p, s.p);
  d.key = s.key;
  d.sep = s.sep;
}

// 0x1005DF950: the incident face's polygon (moved into the reference frame by x)
// clipped to the reference face's side planes pushed out by 0.02; points within
// 0.02 of the reference face are projected onto it
function faceHull(ref: Hull, rf: number, inc: Hull, incF: number, x: XF, m: Manifold): void {
  m.n = 0;
  if (rf < 0 || incF < 0) return;
  // the C++'s stack buffers are born zero; only `edge` can be read unwritten
  for (let i = 0; i < 33; i++) {
    fhA[i]!.edge = 0;
    fhB[i]!.edge = 0;
  }
  let cnt = 0;
  {
    const first = inc.face[incF]!;
    const r10 = nextEdge(inc, first);
    let r11 = first;
    let r12 = r10;
    for (;;) {
      const cur = r11;
      r11 = r12;
      const vtx = origin(inc, cur);
      const a = fhA[cnt]!;
      xfApply(a.p, x, inc.v[vtx]!);
      a.edge = cur & 0xfe;
      a.key = key(rf, vtx, 0, 2);
      r12 = nextEdge(inc, r11);
      cnt++;
      if (r12 === r10 || cnt >= 32) break;
    }
  }
  const n = ref.n[rf]!;
  const d = ref.d[rf]!;
  let inP = fhA;
  let outP = fhB;
  const first = ref.face[rf]!;
  let r10 = first;
  const P0 = ref.v[origin(ref, first)]!;
  let Px = P0.x;
  let Py = P0.y;
  let Pz = P0.z;
  do {
    const cur = r10;
    r10 = nextEdge(ref, cur);
    const Qv = ref.v[origin(ref, r10)]!;
    const ex = Qv.x - Px;
    const ey = Qv.y - Py;
    const ez = Qv.z - Pz;
    let Nx = ey * n.z - ez * n.y;
    let Ny = ez * n.x - ex * n.z;
    let Nz = ex * n.y - ey * n.x;
    {
      const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
      const r0 = 1 / Math.sqrt(l2);
      const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
      Nx = Nx * kk;
      Ny = Ny * kk;
      Nz = Nz * kk;
    }
    const off = Px * Nx + Py * Ny + Pz * Nz + kHullPair;
    const ce = cur & 0xfe;
    Px = Qv.x;
    Py = Qv.y;
    Pz = Qv.z;
    let k = 0;
    if (cnt === 1) {
      const a = inP[0]!.p;
      if (!(0 < a.x * Nx + a.y * Ny + a.z * Nz - off)) copyPoly(outP[k++]!, inP[0]!);
    } else if (cnt === 2) {
      const a = inP[0]!.p;
      const b = inP[1]!.p;
      const dA = a.x * Nx + a.y * Ny + a.z * Nz - off;
      const dB = b.x * Nx + b.y * Ny + b.z * Nz - off;
      if (!(0 < dA)) copyPoly(outP[k++]!, inP[0]!);
      if (!(0 < dB)) copyPoly(outP[k++]!, inP[1]!);
      if (!(0 <= dB * dA)) {
        const den = dA - dB;
        const rc = 1 / den;
        const t1x = (b.x - a.x) * dA;
        const t1y = (b.y - a.y) * dA;
        const t1z = (b.z - a.z) * dA;
        const qx = t1x * rc;
        const qy = t1y * rc;
        const qz = t1z * rc;
        const o = outP[k]!;
        o.p.x = (t1x - qx * den) * rc + qx + a.x; // its edge word is left as it was
        o.p.y = (t1y - qy * den) * rc + qy + a.y;
        o.p.z = (t1z - qz * den) * rc + qz + a.z;
        o.key = key(ce, inP[0]!.edge, 1, 1);
        k++;
      }
    } else if (cnt >= 3) {
      let prev = cnt - 1;
      for (let i = 0; i < cnt && k < 32; i++) {
        const pp = inP[prev]!.p;
        const dP = pp.x * Nx + pp.y * Ny + pp.z * Nz - off;
        if (!(0 < dP)) copyPoly(outP[k++]!, inP[prev]!);
        const pc = inP[i]!.p;
        const dC = pc.x * Nx + pc.y * Ny + pc.z * Nz - off;
        if (!(0 <= dC * dP) && k < 32) {
          const den = dP - dC;
          const rc = 1 / den;
          const t1x = (pc.x - pp.x) * dP;
          const t1y = (pc.y - pp.y) * dP;
          const t1z = (pc.z - pp.z) * dP;
          const qx = t1x * rc;
          const qy = t1y * rc;
          const qz = t1z * rc;
          const o = outP[k]!;
          o.p.x = (t1x - qx * den) * rc + qx + pp.x;
          o.p.y = (t1y - qy * den) * rc + qy + pp.y;
          o.p.z = (t1z - qz * den) * rc + qz + pp.z;
          o.key = key(ce, inP[prev]!.edge, 1, 1);
          o.edge = inP[prev]!.edge;
          k++;
        }
        prev = i;
      }
    }
    cnt = k;
    const sw = inP;
    inP = outP;
    outP = sw;
  } while (r10 !== first);
  copyV(m.normal, n);
  if (cnt <= 0) return;
  let k = 0;
  for (let i = 0; i < cnt; i++) {
    const a = inP[i]!;
    const s = a.p.x * n.x + a.p.y * n.y + a.p.z * n.z - d;
    if (kHullPair < s || k > 31) continue;
    const o = fhKeep[k]!;
    o.p.x = a.p.x - n.x * s;
    o.p.y = a.p.y - n.y * s;
    o.p.z = a.p.z - n.z * s;
    o.sep = s - kHullPair;
    o.key = a.key;
    k++;
  }
  if (k > 4) {
    reduce(fhKeep, k, n, m);
    return;
  }
  for (let i = 0; i < k; i++) putPoint(m, i, fhKeep[i]!);
  m.n = k;
}

class SatResult {
  sep = D;
  a = -1;
  b = -1;
  type = 0;
  constructor() {
    this.sep = -kFltMax;
  }
}
function satReset(s: SatResult): void {
  s.sep = -kFltMax;
  s.a = -1;
  s.b = -1;
  s.type = 0;
}

const ehPB = new V3();
const ehQB = new V3();
const ehCA = new V3();
const ehCB = new V3();

// 0x1005E0030: the edge pair's contact (closest points, normal EA x EB away from
// A's centroid); `check`: the points must agree with the separation
function edgeHull(A: Hull, B: Hull, x: XF, r: SatResult, check: boolean, m: Manifold): void {
  m.n = 0;
  const eA = r.a;
  const eB = r.b;
  const PA = A.v[origin(A, eA)]!;
  const QA = A.v[origin(A, twin(A, eA))]!;
  xfApply(ehPB, x, B.v[origin(B, eB)]!);
  xfApply(ehQB, x, B.v[origin(B, twin(B, eB))]!);
  closestSegSeg(PA, QA, ehPB, ehQB, ehCA, ehCB);
  if (check) {
    const gx = ehCB.x - ehCA.x;
    const gy = ehCB.y - ehCA.y;
    const gz = ehCB.z - ehCA.z;
    if (!(Math.sqrt(gx * gx + gy * gy + gz * gz) * 0.5 <= Math.abs(kHullPair + r.sep))) return;
  }
  const ex = QA.x - PA.x;
  const ey = QA.y - PA.y;
  const ez = QA.z - PA.z;
  const fx = ehQB.x - ehPB.x;
  const fy = ehQB.y - ehPB.y;
  const fz = ehQB.z - ehPB.z;
  let Nx = ey * fz - ez * fy;
  let Ny = ez * fx - ex * fz;
  let Nz = ex * fy - ey * fx;
  const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
  if (!(l2 > kTiny)) return;
  const r0 = 1 / Math.sqrt(l2);
  const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
  Nx = Nx * kk;
  Ny = Ny * kk;
  Nz = Nz * kk;
  const c = A.centroid;
  if (!((PA.x - c.x) * Nx + (PA.y - c.y) * Ny + (PA.z - c.z) * Nz >= 0)) {
    Nx = -Nx;
    Ny = -Ny;
    Nz = -Nz;
  }
  const dx = (ehCB.x - ehCA.x) * Nx;
  const dy = (ehCB.y - ehCA.y) * Ny;
  const dz = (ehCB.z - ehCA.z) * Nz;
  m.n = 1;
  m.normal.x = Nx;
  m.normal.y = Ny;
  m.normal.z = Nz;
  const p0 = m.pt[0]!;
  p0.p.x = (ehCA.x + ehCB.x) * 0.5;
  p0.p.y = (ehCA.y + ehCB.y) * 0.5;
  p0.p.z = (ehCA.z + ehCB.z) * 0.5;
  p0.sep = dz + dx + (dy - kHullPair);
  p0.key = key(eA, eB, 1, 1);
}

const foDir = new V3();

// a face of B as the reference: clipped in B's frame, back to A's (normal negated,
// the key's A and B halves swapped)
function faceOfB(
  A: Hull,
  B: Hull,
  toA: XF,
  toB: XF,
  refB: number,
  vertA: number,
  m: Manifold,
): void {
  mulm(foDir, toA.R, B.n[refB]!);
  foDir.x = -foDir.x;
  foDir.y = -foDir.y;
  foDir.z = -foDir.z;
  const incA = incidentFace(A, vertA, foDir);
  faceHull(B, refB, A, incA, toB, m);
  mulm(m.normal, toA.R, m.normal);
  m.normal.x = -m.normal.x;
  m.normal.y = -m.normal.y;
  m.normal.z = -m.normal.z;
  for (let i = 0; i < m.n; i++) {
    const p = m.pt[i]!;
    const k = p.key;
    p.key = key((k >>> 8) & 255, k & 255, (k >>> 24) & 255, (k >>> 16) & 255);
    xfApply(p.p, toA, p.p);
  }
}

const eqC = new V3();
const eqDv = new V3();
const eqEB = new V3();
const eqT = new V3();
const eqPB = new V3();

// 0x1005DF430: every edge pair whose arcs cross on the Gauss map; false when one
// separates (the cache then holds it)
function edgeQuery(A: Hull, B: Hull, x: XF, best: SatResult, cache: ContactCache): boolean {
  satReset(best);
  const nA = ((A.edge.length / 4) | 0) & ~1;
  const nB = (B.edge.length / 4) | 0;
  if (nB <= 0 || nA < 2) return true;
  const cenA = A.centroid;
  const cenB = B.centroid;
  for (let j = 0; j < nB; j += 2) {
    mulm(eqC, x.R, B.n[faceOf(B, j)]!);
    mulm(eqDv, x.R, B.n[faceOf(B, j + 1)]!);
    const pj = B.v[origin(B, j)]!;
    const qj = B.v[origin(B, twin(B, j))]!;
    eqT.x = qj.x - pj.x;
    eqT.y = qj.y - pj.y;
    eqT.z = qj.z - pj.z;
    mulm(eqEB, x.R, eqT);
    const cx = eqC.x;
    const cy = eqC.y;
    const cz = eqC.z;
    const dx = eqDv.x;
    const dy = eqDv.y;
    const dz = eqDv.z;
    const EBx = eqEB.x;
    const EBy = eqEB.y;
    const EBz = eqEB.z;
    for (let i = 0; i < nA; i += 2) {
      const a = A.n[faceOf(A, i)]!;
      const b = A.n[faceOf(A, i + 1)]!;
      const PA = A.v[origin(A, i)]!;
      const QA = A.v[origin(A, twin(A, i))]!;
      const EAx = QA.x - PA.x;
      const EAy = QA.y - PA.y;
      const EAz = QA.z - PA.z;
      const cE = EAx * cx + EAy * cy + EAz * cz;
      const dE = EAx * dx + EAy * dy + EAz * dz;
      const aE = a.x * EBx + a.y * EBy + a.z * EBz;
      const bE = b.x * EBx + b.y * EBy + b.z * EBz;
      const m1 = aE * bE;
      const m2 = dE * cE;
      const mx1 = m1 < m2 ? m2 : m1; // std::max(aE bE, dE cE)
      const m0 = cE * bE;
      const mx = m0 < mx1 ? mx1 : m0;
      if (!(mx < 0)) continue;
      let Nx = EAy * EBz - EAz * EBy;
      let Ny = EAz * EBx - EAx * EBz;
      let Nz = EAx * EBy - EAy * EBx;
      const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
      if (!(l2 > kTiny)) continue;
      const r0 = 1 / Math.sqrt(l2);
      const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
      Nx = Nx * kk;
      Ny = Ny * kk;
      Nz = Nz * kk;
      const sA = (PA.x - cenA.x) * Nx + (PA.y - cenA.y) * Ny + (PA.z - cenA.z) * Nz;
      eqT.x = pj.x - cenB.x;
      eqT.y = pj.y - cenB.y;
      eqT.z = pj.z - cenB.z;
      mulm(eqT, x.R, eqT);
      const sB = eqT.x * Nx + eqT.y * Ny + eqT.z * Nz;
      const flip = Math.abs(sB) < Math.abs(sA) ? sA < 0 : 0 < sB;
      if (flip) {
        Nx = -Nx;
        Ny = -Ny;
        Nz = -Nz;
      }
      xfApply(eqPB, x, pj);
      const sep =
        (eqPB.x - PA.x) * Nx + (eqPB.y - PA.y) * Ny + (eqPB.z - PA.z) * Nz - kHullPair;
      if (!(sep <= 0)) {
        cache.satType = 3;
        cache.satSep = sep;
        cache.satA = i;
        cache.satB = j;
        return false;
      }
      if (!(sep <= best.sep)) {
        best.sep = sep;
        best.a = i;
        best.b = j;
        best.type = 3;
      }
    }
  }
  return true;
}

const hhToA = new XF();
const hhToB = new XF();
const hhNegP = new V3();
const hhDir = new V3();
const hhDir2 = new V3();
const hhP = new V3();
const hhEB = new V3();
const hhT = new V3();
const hhFace = new SatResult();
const hhEdge = new SatResult();
const hhSat = new SatResult();

/** qBA, pBA: B's frame in A's. */
export function hullHull(
  A: Hull,
  B: Hull,
  qBA: Q,
  pBA: V3,
  m: Manifold,
  cache: ContactCache,
): void {
  m.n = 0;
  zeroV(m.normal);
  if (A.v.length === 0 || B.v.length === 0 || A.n.length === 0 || B.n.length === 0) return;
  const toA = hhToA;
  const toB = hhToB;
  matOf(toA.R, qBA);
  copyV(toA.t, pBA);
  tr3(toB.R, toA.R);
  mulm(hhNegP, toB.R, pBA);
  toB.t.x = -hhNegP.x;
  toB.t.y = -hhNegP.y;
  toB.t.z = -hhNegP.z;
  // last frame's feature, while its separation moved under 0.005
  if (cache.satType === 1 || cache.satType === 2) {
    const onA = cache.satType === 1;
    const rf = onA ? cache.satA : cache.satB;
    const R = onA ? A : B;
    const I = onA ? B : A;
    const toR = onA ? toA : toB;
    const toI = onA ? toB : toA;
    if (rf < R.n.length) {
      const fn = R.n[rf]!;
      mulm(hhDir, toI.R, fn);
      hhDir.x = -hhDir.x;
      hhDir.y = -hhDir.y;
      hhDir.z = -hhDir.z;
      const v = supportIdx(I, hhDir);
      xfApply(hhP, toR, I.v[v]!);
      const sep = hhP.x * fn.x + hhP.y * fn.y + hhP.z * fn.z - (R.d[rf]! + kHullPair);
      if (!(sep <= 0)) return;
      if (Math.abs(sep - cache.satSep) < k0005) {
        if (onA) faceHull(A, rf, B, incidentFace(B, v, hhDir), toA, m);
        else faceOfB(A, B, toA, toB, rf, v, m);
        if (m.n > 0) return;
      }
    }
  } else if (cache.satType === 3) {
    const eA = cache.satA;
    const eB = cache.satB;
    const neA = (A.edge.length / 4) | 0;
    const neB = (B.edge.length / 4) | 0;
    if (eA + 1 < neA + 1 && eB + 1 < neB + 1) {
      const PA = A.v[origin(A, eA)]!;
      const QA = A.v[origin(A, twin(A, eA))]!;
      const EAx = QA.x - PA.x;
      const EAy = QA.y - PA.y;
      const EAz = QA.z - PA.z;
      mulm(hhDir, toA.R, B.n[faceOf(B, eB)]!);
      mulm(hhDir2, toA.R, B.n[faceOf(B, eB + 1)]!);
      const cE = hhDir.x * EAx + hhDir.y * EAy + hhDir.z * EAz;
      const dE = hhDir2.x * EAx + hhDir2.y * EAy + hhDir2.z * EAz;
      const pb = B.v[origin(B, eB)]!;
      const qb = B.v[origin(B, twin(B, eB))]!;
      hhT.x = qb.x - pb.x;
      hhT.y = qb.y - pb.y;
      hhT.z = qb.z - pb.z;
      mulm(hhEB, toA.R, hhT);
      const na = A.n[faceOf(A, eA)]!;
      const nb = A.n[faceOf(A, eA + 1)]!;
      const bE = -na.x * hhEB.x + -na.y * hhEB.y + -na.z * hhEB.z;
      const aE = -nb.x * hhEB.x + -nb.y * hhEB.y + -nb.z * hhEB.z;
      if (dE * cE < 0 && bE * aE < 0 && aE * cE > 0) {
        let Nx = EAy * hhEB.z - EAz * hhEB.y;
        let Ny = EAz * hhEB.x - EAx * hhEB.z;
        let Nz = EAx * hhEB.y - EAy * hhEB.x;
        const l2 = Nz * Nz + Ny * Ny + Nx * Nx;
        let sep = -kFltMax;
        if (l2 > kTiny) {
          const r0 = 1 / Math.sqrt(l2);
          const kk = r0 * -0.5 * (l2 * r0 * r0 + -3);
          Nx = Nx * kk;
          Ny = Ny * kk;
          Nz = Nz * kk;
          const c = A.centroid;
          if (!((PA.x - c.x) * Nx + (PA.y - c.y) * Ny + (PA.z - c.z) * Nz >= 0)) {
            Nx = -Nx;
            Ny = -Ny;
            Nz = -Nz;
          }
          xfApply(hhP, toA, pb);
          sep = (hhP.x - PA.x) * Nx + (hhP.y - PA.y) * Ny + (hhP.z - PA.z) * Nz + -kHullPair;
        }
        if (!(sep <= 0)) return;
        if (Math.abs(sep - cache.satSep) < k0005) {
          hhSat.sep = sep;
          hhSat.a = eA;
          hhSat.b = eB;
          hhSat.type = 3;
          edgeHull(A, B, toA, hhSat, true, m);
          if (m.n > 0) return;
        }
      }
    }
  }
  // full SAT: faces of A, faces of B (a B face must beat 0.98 x best + 0.0025)
  const face = hhFace;
  satReset(face);
  for (let i = 0; i < A.n.length; i++) {
    const fn = A.n[i]!;
    mulm(hhDir, toB.R, fn);
    hhDir.x = -hhDir.x;
    hhDir.y = -hhDir.y;
    hhDir.z = -hhDir.z;
    const v = supportIdx(B, hhDir);
    xfApply(hhP, toA, B.v[v]!);
    const sep = hhP.x * fn.x + hhP.y * fn.y + hhP.z * fn.z - (A.d[i]! + kHullPair);
    if (!(sep <= 0)) {
      cache.satType = 1;
      cache.satSep = sep;
      cache.satA = i;
      cache.satB = v;
      return;
    }
    if (!(sep <= face.sep)) {
      face.sep = sep;
      face.a = i;
      face.b = v;
      face.type = 1;
    }
  }
  for (let j = 0; j < B.n.length; j++) {
    const fn = B.n[j]!;
    mulm(hhDir, toA.R, fn);
    hhDir.x = -hhDir.x;
    hhDir.y = -hhDir.y;
    hhDir.z = -hhDir.z;
    const v = supportIdx(A, hhDir);
    xfApply(hhP, toB, A.v[v]!);
    const sep = hhP.x * fn.x + hhP.y * fn.y + hhP.z * fn.z - (B.d[j]! + kHullPair);
    if (!(sep <= 0)) {
      cache.satType = 2;
      cache.satSep = sep;
      cache.satA = v;
      cache.satB = j;
      return;
    }
    if (!(sep <= face.sep * k098 + k00025)) {
      face.sep = sep;
      face.a = v;
      face.b = j;
      face.type = 2;
    }
  }
  const edge = hhEdge;
  if (!edgeQuery(A, B, toA, edge, cache)) return;
  // the face contact (0x1005E02F0), then the edge pair when clearly deeper
  if (face.type === 1) {
    mulm(hhDir, toB.R, A.n[face.a]!);
    hhDir.x = -hhDir.x;
    hhDir.y = -hhDir.y;
    hhDir.z = -hhDir.z;
    faceHull(A, face.a, B, incidentFace(B, face.b, hhDir), toA, m);
  } else if (face.type === 2) {
    faceOfB(A, B, toA, toB, face.b, face.a, m);
  }
  let thr = k00025;
  if (m.n > 0) {
    let mn = 0;
    for (let i = 0; i < m.n; i++) {
      const s = m.pt[i]!.sep;
      mn = mn < s ? mn : s; // std::min(sep, mn)
    }
    thr = mn * k09 + k00025;
  }
  let useEdge = false;
  if (edge.type === 3) {
    const clear = !(edge.sep <= face.sep * k09 + k00025);
    useEdge = (m.n < 2 && clear) || !(edge.sep <= thr);
  }
  if (!useEdge) {
    cache.satSep = face.sep;
    cache.satType = face.type;
    cache.satA = face.a & 255;
    cache.satB = face.b & 255;
    return;
  }
  m.n = 0;
  edgeHull(A, B, toA, edge, false, m);
  cache.satSep = edge.sep;
  cache.satType = 3;
  cache.satA = edge.a & 255;
  cache.satB = edge.b & 255;
}
