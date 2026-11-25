// One physics world: an item's own, or a scene's shared one. Port of
// Physics.cpp's Instance::World, every block read from the retail function it
// names (Midnight 12.1.0.69933 macOS x86_64 VAs); see math.ts for the rules of
// this folder and why nothing here allocates.
//
// One speed-up over the C++, with no change to a single bit: a body's world
// inverse inertia is cached until its rotation next changes (iwOf), because the
// C++ recomputes the same numbers for every joint in every velocity iteration.
import {
  D,
  IntVec,
  M3,
  Q,
  V3,
  addM3,
  atanApprox,
  AtanReg,
  copyM3,
  copyQ,
  copyV,
  cross,
  fround,
  inverse,
  inverseFast,
  kBodyDynamic,
  kBodyKinematic,
  kBodyStatic,
  kFltMax,
  kFltMin,
  kHullRadius,
  kJointPrismatic,
  kJointRevolute,
  kJointShoulder,
  kJointWeld,
  kPi,
  kShapeCapsule,
  kShapeHull,
  kShapeSphere,
  kTiny,
  mulConjQ,
  mulm,
  mulm3,
  mulq,
  mulQConj,
  rot,
  rotInv,
  skew,
  zeroM3,
  zeroV,
} from './math';
import {
  ContactCache,
  Hull,
  Manifold,
  NR,
  capsuleCapsule,
  hullCapsule,
  hullHull,
} from './narrow';
import { Tree } from './tree';

const k2Pi = 2 * kPi;
const k4Pi = 4 * kPi;
const k02 = fround(0.2);
const k07 = fround(0.7);
const k0005 = fround(0.005);
const kCapAng = fround(0.785398185);
const kSwingLock = fround(2.96705961);
const kTwistLock = fround(0.069813177);
const kSlop = fround(0.0349065885);
const kMaxC = fround(0.52359879);
const kWeldHz = fround(12.566371);
const kPrisHz = fround(6.28318548);
const kPrisLock = fround(0.0099999998);
const kAngCap2 = fround(0.616850317);
const kSleepW = fround(0.00761543633);
const kSleepV = fround(0.00250000018);

// the private world --------------------------------------------------------------
export class Body {
  type = kBodyDynamic;
  x = new V3(); // origin (the body frame), world
  q = new Q();
  lc = new V3(); // local centre of mass
  c = new V3(); // centre of mass, world
  v = new V3();
  w = new V3();
  v0 = new V3(); // the step's start velocities (the body record, +0x30 / +0x40)
  w0 = new V3();
  m = D; // mass, inverse mass
  im = D;
  I = new M3(); // local inertia about the COM (x inertia scale) and its inverse
  iI = new M3();
  gs = D; // gravity scale, damping, inertia scale
  ld = D;
  ad = D;
  is = D;
  sleep = D;
  gyro = true; // +0x1B7 implicit gyroscopic step (body def + 0x3E)
  noAngCap = false; // +0x1B5 no pi/4 rotation cap (body def + 0x3C)
  allowSleep = false; // +0x1AD (body def + 0x38)
  enabled = true; // +0x1AF: off while its item is culled (0x1005E8970)
  c0 = new V3(); // +0x80 / +0x90: the sweep's start - the centre and
  q0 = new Q(); // rotation a solve began from (0x1005F2E40)
  shapes: number[] = [];
  iw = new M3(); // R iI R^T, valid while iwOk
  iwOk = false;
  constructor() {
    this.m = 0;
    this.im = 0;
    this.gs = 1;
    this.ld = 0;
    this.ad = 0;
    this.is = 1;
    this.sleep = 0;
  }
}

export class Shape {
  type = kShapeCapsule; // Domino 0 sphere, 1 capsule, 2 hull
  body = 0;
  a = new V3(); // sphere centre / capsule ends, body space, scaled
  b = new V3();
  r = D;
  friction = D;
  restitution = D;
  density = D;
  // the collision filter (shape + 0x90, 0x1005F0900): category, mask, group; set
  // per item by 0x1011B5F40 (16 for PHYT 3/4, 32 / 64 for PHYT 0/1)
  cat = 16;
  mask = 0x17;
  group = 0;
  hull = new Hull();
  // + 0 / + 16: the shape's box as last computed - at the body's place on a
  // create, teleport or rescale (0x1005F1900), swept over the step after a solve
  // (0x1005E8FE0) - and what the proxy refit reads (0x1005E91C0)
  boxLo = new V3();
  boxHi = new V3();
  constructor() {
    this.r = 0;
    this.friction = k06;
    this.restitution = 0;
    this.density = 1;
  }
}
const k06 = fround(0.6);

// broadphase proxy: the fat box the client's tree keeps and its key (0x1005CC930):
// tree node id << 2 | tree (0 static, 1 kinematic, 2 dynamic, 0x1005E7F50); new
// pairs are made in key order
export class ShapeProxy {
  lo = new V3();
  hi = new V3();
  moved = true;
  key = 0;
  node = -1;
}

export class Joint {
  type = kJointShoulder;
  a = 0;
  b = 0;
  pa = new V3(); // frame positions (x scale at creation)
  pb = new V3();
  qa = new Q(); // frame rotations
  qb = new Q();
  // shoulder (0x100601F80)
  twLo = D;
  twHi = D;
  cone = D;
  maxT = D;
  hz = D;
  zeta = D;
  mode = 0;
  twState = 0;
  coneState = 1;
  twAxis = new V3(); // persists while the swing is past 170 deg
  twMass = D;
  // revolute (0x1005FF280): 0x2C8 centre, 0x2CC half range, 0x2BC limit state (0 =
  // no limit), 0x2B8 axial mass
  revCenter = D;
  revHalf = D;
  limState = 0;
  limMass = D;
  hingeK = D;
  // weld (0x1006063B0): 0x1F0 angular Hz, 0x1F4 angular zeta, 0x1F8 linear Hz,
  // 0x1FC linear zeta
  angHz = D;
  angZeta = D;
  linHz = D;
  linZeta = D;
  // prismatic (0x1005FC640): 0x1BC / 0x1C0 limits (lengths, never scaled), 0x1B8
  // limit state, 0x180 spring target, 0x164 motor speed, 0x1B4 axial mass; the
  // motor reuses m1* / Pmot1, the limit Plim, the angular lock Pang (0x150) and the
  // two perpendicular rows Plin.x / .y (0x100)
  prLower = D;
  prUpper = D;
  prTarget = D;
  prSpeed = D;
  prAxMass = D;
  prPerp1 = new V3(); // 0x70, 0x80, 0x90: frame A's X, Y, Z
  prPerp2 = new V3();
  prAxis = new V3();
  prS1A = new V3(); // 0xB0..0xE0: the perpendicular rows' angular parts
  prS1B = new V3();
  prS2A = new V3();
  prS2B = new V3();
  prA1 = new V3(); // 0x190, 0x1A0: the axial row's
  prA2 = new V3();
  prK0 = D; // 0xF0: the perpendicular 2x2 inverse (a, b, c)
  prK1 = D;
  prK2 = D;
  prKang = new M3(); // 0x110: (iA + iB)^-1
  // accumulated impulses
  Plin = new V3();
  Pmot = new V3();
  Pang = new V3();
  Ptw = D;
  Pcone = D;
  Pmot1 = D;
  Plim = D;
  // per-step solver data
  rA = new V3();
  rB = new V3();
  axisC = new V3();
  iaT = new V3();
  ibT = new V3();
  iaC = new V3();
  ibC = new V3();
  Klin = new M3();
  Kmot = new M3();
  Kang = new M3();
  motBias = new V3();
  motGamma = new V3();
  motMax = D;
  coneMass = D;
  m1Mass = D;
  m1Bias = D;
  m1Gamma = D;
  m1Max = D;
  hingeAxis = new V3(); // 0xB0, 0xC0, 0xD0
  iaH = new V3();
  ibH = new V3();
  lockJ1 = new V3(); // 0x1E0..0x200 (stored transposed)
  lockJ2 = new V3();
  lockK0 = D; // 0x220 / 0x230: the 2x2 inverse
  lockK1 = D;
  lockK2 = D;
  lockK3 = D;
  angBias = new V3();
  angGamma = new V3();
  linBias = new V3();
  linGamma = new V3();
  angCap = D; // weld 0xC0 / 0xD0
  angCap2 = D;
  constructor() {
    this.twLo = 0;
    this.twHi = 0;
    this.cone = kPi;
    this.maxT = 0;
    this.hz = 1;
    this.zeta = k07;
    this.twMass = 0;
    this.revCenter = 0;
    this.revHalf = 0;
    this.limMass = 0;
    this.hingeK = 0;
    this.angHz = 0;
    this.angZeta = 0;
    this.linHz = 0;
    this.linZeta = 0;
    this.prLower = 0;
    this.prUpper = 0;
    this.prTarget = 0;
    this.prSpeed = 0;
    this.prAxMass = 0;
    this.prK0 = 0;
    this.prK1 = 0;
    this.prK2 = 0;
    this.Ptw = 0;
    this.Pcone = 0;
    this.Pmot1 = 0;
    this.Plim = 0;
    this.motMax = 0;
    this.coneMass = 0;
    this.m1Mass = 0;
    this.m1Bias = 0;
    this.m1Gamma = 0;
    this.m1Max = 0;
    this.lockK0 = 0;
    this.lockK1 = 0;
    this.lockK2 = 0;
    this.lockK3 = 0;
    this.angCap = kFltMax;
    this.angCap2 = kFltMax;
  }
}

// the per-step solver data of one point (0x60 + 0x30 bytes in the client)
class ContactPoint {
  rAn = new V3();
  iArAn = new V3();
  rBn = new V3();
  iBrBn = new V3();
  mn = D;
  gamma = D;
  bias = D;
  Pn = D;
  la = new V3(); // body-local anchors (position solve)
  lb = new V3();
  sep = D;
  posMass = D;
  constructor() {
    this.mn = 0;
    this.gamma = 0;
    this.bias = 0;
    this.Pn = 0;
    this.sep = 0;
    this.posMass = 0;
  }
}

const ZERO3 = new M3();

export class Contact {
  live = true; // a slot of the world's contact array (free list LIFO, 0x10060ABC0)
  seq = 0; // creation order: 0x1005EAFE0 prepends it to both shapes' edge lists
  sa = 0;
  sb = 0;
  ba = 0;
  bb = 0;
  friction = D; // mixed at creation
  restitution = D;
  rolling = D;
  m = new Manifold();
  mNext = new Manifold(); // the other half of Collide's old / new pair
  cache = new ContactCache();
  // solver (0x1F0 + 0xB0 bytes in the client)
  soft = false;
  rigidPoints = 0;
  cp: ContactPoint[] = [
    new ContactPoint(),
    new ContactPoint(),
    new ContactPoint(),
    new ContactPoint(),
  ];
  n = new V3();
  t1 = new V3();
  t2 = new V3();
  center = new V3();
  rAt1 = new V3();
  rBt1 = new V3();
  rAt2 = new V3();
  rBt2 = new V3();
  iAt1 = new V3();
  iBt1 = new V3();
  iAt2 = new V3();
  iBt2 = new V3();
  k11 = D;
  k12 = D;
  k22 = D;
  twMass = D;
  mu = D;
  muTw = D;
  roll = D;
  rollK = new M3();
  lamX = D; // tangent 1, tangent 2, twist
  lamY = D;
  lamZ = D;
  lamRoll = new V3();
  imA = D;
  imB = D;
  mA = D;
  mB = D;
  iAw = ZERO3; // world inverse inertia at prepare (the body's cache)
  iBw = ZERO3;
}

class StepData {
  h = D;
  inv = D;
  dtRatio = D;
  warm = true;
}
const ST = new StepData();

export class World {
  bodies: Body[] = [];
  shapes: Shape[] = [];
  proxies: ShapeProxy[] = [];
  joints: Joint[] = [];
  contacts: Contact[] = [];
  joined = new IntVec(); // (min << 16 | max) of jointed bodies
  contactFree = new IntVec(); // freed contact slots, reused last-freed first
  contactSeq = 0;
  // the scene world's awake list (world + 0x830): bodies seed islands in this
  // order; made in creation order (0x1005E78D0), rebuilt after every step from the
  // islands, newest island first (0x1005F3E50)
  awake = new IntVec();
  awakeNext = new IntVec();
  // the solve's constraint order for the scene world's islands; off: every joint /
  // contact in slot order (an item's own world, 0x10060BA90)
  ordered = false;
  jorder = new IntVec();
  corder = new IntVec();
  trees = [new Tree(), new Tree(), new Tree()]; // static, kinematic, dynamic (world + 0x560 + 48)
  pairsDirty = false; // world + 0x540: a teleport moved proxies (0x1005E8BF0)
  anyMoved = false; // some proxy has `moved` set: the pair search has work
  gx = D; // 0x103523460
  gy = D;
  gz = D;
  invDt0 = D;
  dt = D; // the step's input, in a field so that it crosses the call unboxed
  islandAwake = true;
  // Islands' lists, kept between steps
  edges: IntVec[] = [];
  bj: IntVec[] = [];
  bjDirty = true;
  bstamp = new Int32Array(8);
  cstamp = new Int32Array(8);
  jstamp = new Int32Array(8);
  listed = new IntVec();
  islandStart = new IntVec();
  stack = new IntVec();
  constructor() {
    this.gx = 0;
    this.gy = 0;
    this.gz = -10;
    this.invDt0 = 0;
    this.dt = 0;
  }
}

// --- body ---------------------------------------------------------------------
// R iI R^T, the C++'s Mulm(Mulm(r, iI), Tr(r)) term for term
function refreshIw(b: Body): void {
  const q = b.q;
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const w = q.w;
  const r0 = 1 - 2 * (y * y + z * z);
  const r1 = 2 * (x * y - w * z);
  const r2 = 2 * (x * z + w * y);
  const r3 = 2 * (x * y + w * z);
  const r4 = 1 - 2 * (x * x + z * z);
  const r5 = 2 * (y * z - w * x);
  const r6 = 2 * (x * z - w * y);
  const r7 = 2 * (y * z + w * x);
  const r8 = 1 - 2 * (x * x + y * y);
  const J = b.iI;
  const i0 = J.m0;
  const i1 = J.m1;
  const i2 = J.m2;
  const i3 = J.m3;
  const i4 = J.m4;
  const i5 = J.m5;
  const i6 = J.m6;
  const i7 = J.m7;
  const i8 = J.m8;
  const t0 = r0 * i0 + r1 * i3 + r2 * i6;
  const t1 = r0 * i1 + r1 * i4 + r2 * i7;
  const t2 = r0 * i2 + r1 * i5 + r2 * i8;
  const t3 = r3 * i0 + r4 * i3 + r5 * i6;
  const t4 = r3 * i1 + r4 * i4 + r5 * i7;
  const t5 = r3 * i2 + r4 * i5 + r5 * i8;
  const t6 = r6 * i0 + r7 * i3 + r8 * i6;
  const t7 = r6 * i1 + r7 * i4 + r8 * i7;
  const t8 = r6 * i2 + r7 * i5 + r8 * i8;
  const o = b.iw;
  o.m0 = t0 * r0 + t1 * r1 + t2 * r2;
  o.m1 = t0 * r3 + t1 * r4 + t2 * r5;
  o.m2 = t0 * r6 + t1 * r7 + t2 * r8;
  o.m3 = t3 * r0 + t4 * r1 + t5 * r2;
  o.m4 = t3 * r3 + t4 * r4 + t5 * r5;
  o.m5 = t3 * r6 + t4 * r7 + t5 * r8;
  o.m6 = t6 * r0 + t7 * r1 + t8 * r2;
  o.m7 = t6 * r3 + t7 * r4 + t8 * r5;
  o.m8 = t6 * r6 + t7 * r7 + t8 * r8;
  b.iwOk = true;
}

/** The body's world inverse inertia (R iI R^T); zero for a body that is not dynamic. */
function iwOf(b: Body): M3 {
  if (b.type !== kBodyDynamic) return ZERO3;
  if (!b.iwOk) refreshIw(b);
  return b.iw;
}

const soT = new V3();
function syncOrigin(b: Body): void {
  rot(soT, b.q, b.lc);
  b.x.x = b.c.x - soT.x;
  b.x.y = b.c.y - soT.y;
  b.x.z = b.c.z - soT.z;
}

const stT = new V3();
// 0x1005E9CE0 -> 0x1005E8E30: the rotation renormalised exactly (no-op when |q|^2
// is under the guard), origin set, centre recomputed
export function setTransform(b: Body, origin: V3, r: Q): boolean {
  const n2 = r.x * r.x + r.y * r.y + (r.z * r.z + r.w * r.w);
  if (!(n2 > kTiny)) return false;
  const ri = 1 / Math.sqrt(n2);
  const k = ri * -0.5 * (n2 * ri * ri + -3);
  const qx = r.x * k;
  const qy = r.y * k;
  const qz = r.z * k;
  const qw = r.w * k;
  copyV(b.x, origin);
  b.q.x = qx;
  b.q.y = qy;
  b.q.z = qz;
  b.q.w = qw;
  b.iwOk = false;
  rot(stT, b.q, b.lc);
  b.c.x = b.x.x + stT.x;
  b.c.y = b.x.y + stT.y;
  b.c.z = b.x.z + stT.z;
  return true;
}

// --- shapes and mass (0x1005E8270 and the per-shape routines it calls): only at
// creation and on a rescale, so this block is written plainly --------------------
interface P3 {
  x: number;
  y: number;
  z: number;
}
const kVol = fround(4.18879032);
function pAdd(a: P3, b: P3): P3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function pSub(a: P3, b: P3): P3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function pMul(a: P3, s: number): P3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
function pMulv(a: P3, b: P3): P3 {
  return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z };
}
function pCross(a: P3, b: P3): P3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function pPerm(a: P3): P3 {
  return { x: a.y, y: a.z, z: a.x };
}
function rsqrtN(x: number): number {
  const r = 1 / Math.sqrt(x);
  return r * -0.5 * (x * r * r + -3);
}

interface MassData {
  m: number;
  c: P3;
  I: number[]; // row major
}

// I += m (|e|^2 E - e e^T), e = c - p
function shiftTo(d: MassData, p: P3): void {
  const e = pSub(d.c, p);
  const xx = e.x * e.x;
  const yy = e.y * e.y;
  const zz = e.z * e.z;
  const I = d.I;
  I[0]! += (yy + zz) * d.m;
  I[4]! += (zz + xx) * d.m;
  I[8]! += (xx + yy) * d.m;
  I[1]! -= e.x * e.y * d.m;
  I[3]! -= e.x * e.y * d.m;
  I[2]! -= e.x * e.z * d.m;
  I[6]! -= e.x * e.z * d.m;
  I[5]! -= e.y * e.z * d.m;
  I[7]! -= e.y * e.z * d.m;
}

// volumes (pass 1): 0x1005E16D0 sphere, 0x1005E1D40 capsule, the hull's kept volume
function shapeVolume(s: Shape): number {
  if (s.type === kShapeSphere) return s.r * s.r * kVol * s.r;
  if (s.type === kShapeCapsule) {
    const e = pSub(s.b, s.a);
    const h = Math.sqrt(e.z * e.z + (e.x * e.x + e.y * e.y));
    return (h * kPi + s.r * kVol) * (s.r * s.r);
  }
  return s.hull.volume;
}
// centres (pass 1): sphere centre, capsule midpoint, the hull's kept centroid
function shapeCentre(s: Shape): P3 {
  if (s.type === kShapeSphere) return s.a;
  if (s.type === kShapeCapsule) return pMul(pAdd(s.b, s.a), 0.5);
  return s.hull.centroid;
}

// 0x1005E15C0
function sphereInertia(s: Shape, rho: number, p: P3): MassData {
  const m = s.r * s.r * (rho * kVol) * s.r;
  const i = s.r * s.r * fround(0.4) * m;
  const d: MassData = { m, c: s.a, I: [i, 0, 0, 0, i, 0, 0, 0, i] };
  shiftTo(d, p);
  return d;
}

// 0x1005E1890: cylinder + two hemispheres, axis by rsqrt + Newton
function capsuleInertia(s: Shape, rho: number, p: P3): MassData {
  const ax = pSub(s.b, s.a);
  const h2 = ax.z * ax.z + (ax.x * ax.x + ax.y * ax.y);
  const rs = rsqrtN(h2);
  const h = Math.abs(h2) < kFltMin ? 0 : h2 * rs;
  const r = s.r;
  const r2 = r * r;
  const rr = rho * r2;
  const ms = 2 * (r * (fround(2.09439516) * rr)); // two hemispheres
  const mc = h * (kPi * rr); // cylinder
  const off = 0.375 * r + h * 0.5;
  const Ipe = (off * off + r2 * fround(0.259375)) * ms + (r2 * 0.25 + h2 * fround(0.0833333358)) * mc;
  const Iax = (mc * 0.5 + ms * fround(0.4)) * r2;
  let u: P3 = { x: 0, y: 0, z: 1 };
  if (h > 0) u = pMul(ax, rs);
  const k = Iax - Ipe;
  const I = [Ipe, 0, 0, 0, Ipe, 0, 0, 0, Ipe];
  I[0]! += k * u.x * u.x;
  I[1]! += k * u.x * u.y;
  I[2]! += k * u.x * u.z;
  I[3]! += k * u.y * u.x;
  I[4]! += k * u.y * u.y;
  I[5]! += k * u.y * u.z;
  I[6]! += k * u.z * u.x;
  I[7]! += k * u.z * u.y;
  I[8]! += k * u.z * u.z;
  const d: MassData = { m: ms + mc, c: pMul(pAdd(s.b, s.a), 0.5), I };
  shiftTo(d, p);
  return d;
}

// 0x1005DCF30: the polyhedral mass integrals (Eberly) over the hull's faces, fanned
// from each face's first vertex, about vertex 0; centre by rcp + Newton
function hullInertia(H: Hull, rho: number, p: P3): MassData {
  const ref: P3 = H.v.length === 0 ? { x: 0, y: 0, z: 0 } : H.v[0]!;
  let i0 = 0;
  let i1: P3 = { x: 0, y: 0, z: 0 };
  let i2: P3 = { x: 0, y: 0, z: 0 };
  let i3: P3 = { x: 0, y: 0, z: 0 };
  const E = H.edge;
  for (let f = 0; f < H.face.length; f++) {
    const e0 = H.face[f]!;
    const w0 = pSub(H.v[E[e0 * 4 + 1]!]!, ref);
    let e = E[e0 * 4 + 3]!;
    let w1 = pSub(H.v[E[e * 4 + 1]!]!, ref);
    e = E[e * 4 + 3]!;
    const t1 = pMulv(w0, w0);
    for (let guard = 0; guard < 256; guard++) {
      const w2 = pSub(H.v[E[e * 4 + 1]!]!, ref);
      const n = pCross(pSub(w1, w0), pSub(w2, w0));
      const t0 = pAdd(w1, w0);
      const f1 = pAdd(w2, t0);
      const t2 = pAdd(pMulv(t0, w1), t1);
      const f2 = pAdd(pMulv(f1, w2), t2);
      const f3 = pAdd(pMulv(f2, w2), pAdd(pMulv(t2, w1), pMulv(t1, w0)));
      const g0 = pAdd(pMulv(pAdd(f1, w0), w0), f2);
      const g1 = pAdd(pMulv(pAdd(f1, w1), w1), f2);
      const g2 = pAdd(pMulv(pAdd(f1, w2), w2), f2);
      const gs = pAdd(
        pAdd(pMulv(pPerm(w1), g1), pMulv(pPerm(w0), g0)),
        pMulv(pPerm(w2), g2),
      );
      i0 += f1.x * n.x;
      i1 = pAdd(i1, pMulv(f2, n));
      i2 = pAdd(i2, pMulv(f3, n));
      i3 = pAdd(i3, pMulv(gs, n));
      w1 = w2;
      e = E[e * 4 + 3]!;
      if (e === e0) break;
    }
  }
  const vol = i0 * fround(0.166666672);
  i1 = pMul(i1, fround(0.0416666679));
  i2 = pMul(i2, fround(0.0166666675));
  i3 = pMul(i3, fround(0.00833333377));
  let c: P3 = { x: 0, y: 0, z: 0 };
  if (vol > 0) {
    const r = 1 / vol;
    const q = pMul(i1, r);
    c = pAdd(pMul(pSub(i1, pMul(q, vol)), r), q);
  }
  // about the reference vertex, then to the centre, then to p
  const I = [
    (i2.y + i2.z) * rho,
    -i3.x * rho,
    -i3.z * rho,
    -i3.x * rho,
    (i2.z + i2.x) * rho,
    -i3.y * rho,
    -i3.z * rho,
    -i3.y * rho,
    (i2.x + i2.y) * rho,
  ];
  const m = vol * rho;
  const back: MassData = { m, c, I: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  shiftTo(back, { x: 0, y: 0, z: 0 });
  for (let k = 0; k < 9; k++) I[k]! -= back.I[k]!;
  const d: MassData = { m, c: pAdd(ref, c), I };
  shiftTo(d, p);
  return d;
}

function shapeInertia(s: Shape, rho: number, p: P3): MassData {
  if (s.type === kShapeSphere) return sphereInertia(s, rho, p);
  if (s.type === kShapeCapsule) return capsuleInertia(s, rho, p);
  return hullInertia(s.hull, rho, p);
}

// 0x1005E8270
export function resetMass(w: World, b: Body): void {
  // pass 1: mass = sum density x volume (finite densities above 0; a body that is
  // not dynamic counts density 1), centre = sum m c / M
  let M = 0;
  let mc: P3 = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < b.shapes.length; k++) {
    const s = w.shapes[b.shapes[k]!]!;
    const rho = b.type !== kBodyDynamic ? 1 : s.density;
    if (!Number.isFinite(rho) || !(rho > 0)) continue;
    const m = shapeVolume(s) * rho;
    mc = pAdd(mc, pMul(shapeCentre(s), m));
    M = M + m;
  }
  let im = 0;
  let lc: P3 = { x: 0, y: 0, z: 0 };
  if (Number.isFinite(M) && M > kTiny) {
    im = 1 / M;
    lc = pMul(mc, im);
  } else {
    M = 0;
  }
  // pass 2: each shape's inertia about the centre
  const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < b.shapes.length; k++) {
    const s = w.shapes[b.shapes[k]!]!;
    const rho = b.type !== kBodyDynamic ? 1 : s.density;
    if (!Number.isFinite(rho) || !(rho > 0)) continue;
    const si = shapeInertia(s, rho, lc).I;
    for (let n = 0; n < 9; n++) I[n] = I[n]! + si[n]!;
  }
  // x inertia scale (BDY4 0x1C), inverted when det is finite and above the guard,
  // else both zero
  const r0: P3 = { x: I[0]!, y: I[1]!, z: I[2]! };
  const r1: P3 = { x: I[3]!, y: I[4]!, z: I[5]! };
  const r2: P3 = { x: I[6]!, y: I[7]!, z: I[8]! };
  const cr = pCross(r1, r2);
  const det = r0.x * cr.x + r0.y * cr.y + r0.z * cr.z;
  if (Number.isFinite(det) && det > kTiny) {
    b.I.m0 = I[0]! * b.is;
    b.I.m1 = I[1]! * b.is;
    b.I.m2 = I[2]! * b.is;
    b.I.m3 = I[3]! * b.is;
    b.I.m4 = I[4]! * b.is;
    b.I.m5 = I[5]! * b.is;
    b.I.m6 = I[6]! * b.is;
    b.I.m7 = I[7]! * b.is;
    b.I.m8 = I[8]! * b.is;
    inverse(b.iI, b.I);
  } else {
    zeroM3(b.I);
    zeroM3(b.iI);
  }
  b.lc.x = lc.x;
  b.lc.y = lc.y;
  b.lc.z = lc.z;
  if (b.type !== kBodyDynamic) {
    b.m = 0;
    b.im = 0;
    zeroM3(b.I);
    zeroM3(b.iI);
  } else {
    b.m = M;
    b.im = im;
  }
  b.iwOk = false;
  rot(stT, b.q, b.lc);
  b.c.x = b.x.x + stT.x;
  b.c.y = b.x.y + stT.y;
  b.c.z = b.x.z + stT.z;
}

// --- shared joint helpers ------------------------------------------------------
const alT = new V3();
const alI = new V3();
// sign is -1 or +1 (a small int: it crosses the call unboxed)
function applyLin(b: Body, P: V3, r: V3, iIw: M3, sign: number): void {
  if (b.type !== kBodyDynamic) return;
  const k = b.im * sign;
  b.v.x = b.v.x + P.x * k;
  b.v.y = b.v.y + P.y * k;
  b.v.z = b.v.z + P.z * k;
  cross(alT, r, P);
  mulm(alI, iIw, alT);
  b.w.x = b.w.x + alI.x * sign;
  b.w.y = b.w.y + alI.y * sign;
  b.w.z = b.w.z + alI.z * sign;
}

// q' = q + 0.5 (w (x) q), renormalised (rsqrt + Newton) - the position solvers'
// rotation step
function integrate(b: Body, w: V3): void {
  const q = b.q;
  const wx = w.x;
  const wy = w.y;
  const wz = w.z;
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  const dx = 0 * qx + wx * qw + wy * qz - wz * qy;
  const dy = 0 * qy - wx * qz + wy * qw + wz * qx;
  const dz = 0 * qz + wx * qy - wy * qx + wz * qw;
  const dw = 0 * qw - wx * qx - wy * qy - wz * qz;
  const nx = qx + 0.5 * dx;
  const ny = qy + 0.5 * dy;
  const nz = qz + 0.5 * dz;
  const nw = qw + 0.5 * dw;
  const n2 = nz * nz + nw * nw + (nx * nx + ny * ny);
  b.iwOk = false;
  if (!(n2 > kTiny)) {
    q.x = nx;
    q.y = ny;
    q.z = nz;
    q.w = nw;
    return;
  }
  const r = 1 / Math.sqrt(n2);
  const k = r * -0.5 * (n2 * r * r + -3);
  q.x = nx * k;
  q.y = ny * k;
  q.z = nz * k;
  q.w = nw * k;
}

const mpT = new V3();
const mpI = new V3();
// position-level: move c and q
function movePos(b: Body, P: V3, r: V3, iIw: M3, sign: number): void {
  if (b.type !== kBodyDynamic) return;
  const k = b.im * sign;
  b.c.x = b.c.x + P.x * k;
  b.c.y = b.c.y + P.y * k;
  b.c.z = b.c.z + P.z * k;
  cross(mpT, r, P);
  mulm(mpI, iIw, mpT);
  mpI.x = mpI.x * sign;
  mpI.y = mpI.y * sign;
  mpI.z = mpI.z * sign;
  integrate(b, mpI);
}
function moveAng(b: Body, dtheta: V3): void {
  if (b.type !== kBodyDynamic) return;
  integrate(b, dtheta);
}

// soft constraint (Box2D 2.x form the client uses): per axis effective mass m;
// w = 2 pi Hz, c = 2 zeta w m, k = w^2 m, gamma = 1 / ((k h + c) h) by rcp + Newton
// (0 under the guard), bias = C x h k gamma
class SoftReg {
  hz = D;
  zeta = D;
  h = D;
  m = D;
  gamma = D;
  biasK = D;
}
const SF = new SoftReg();
function soft(R: SoftReg): void {
  const omega = k2Pi * R.hz;
  const c = (R.zeta + R.zeta) * (omega * R.m);
  const k = omega * omega * R.m;
  const d = (k * R.h + c) * R.h;
  let g = 0;
  if (Math.abs(d) > kTiny) {
    const r = 1 / d;
    g = (1 - d * r) * r + r;
  }
  R.gamma = g;
  R.biasK = R.h * g * k;
}

class Swing {
  angle = D;
  axis = new V3();
}
const SW = new Swing();
const AT = new AtanReg();
const ZAXIS = new V3();
ZAXIS.z = 1;
const swA = new V3();
const swB = new V3();

// frames' Z axes a, b: swing = atan2(|a x b|, a.b), axis = (a x b) / |a x b|.
// Prepare and the cone position step take |a x b| and the axis from rsqrt + Newton
// (|c|^2 summed (x^2 + z^2) + y^2; under the guard: length 0, the axis left raw);
// the twist position step takes the length by an exact sqrt.
function swingOf(S: Swing, wfA: Q, wfB: Q, exact: boolean): void {
  rot(swA, wfA, ZAXIS);
  rot(swB, wfB, ZAXIS);
  const ax = swA.x;
  const ay = swA.y;
  const az = swA.z;
  const bx = swB.x;
  const by = swB.y;
  const bz = swB.z;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const d = ax * bx + ay * by + az * bz;
  S.axis.x = cx;
  S.axis.y = cy;
  S.axis.z = cz;
  if (exact) {
    const c2 = cz * cz + (cx * cx + cy * cy);
    AT.y = Math.sqrt(c2);
    AT.x = d;
    atanApprox(AT);
    S.angle = AT.r;
    return;
  }
  const c2 = cy * cy + (cz * cz + cx * cx);
  let l = 0;
  if (c2 > kTiny) {
    const r0 = 1 / Math.sqrt(c2);
    const r = r0 * -0.5 * (c2 * r0 * r0 + -3);
    l = Math.abs(c2) < kFltMin ? 0 : c2 * r;
    S.axis.x = cx * r;
    S.axis.y = cy * r;
    S.axis.z = cz * r;
  }
  AT.y = l;
  AT.x = d;
  atanApprox(AT);
  S.angle = AT.r;
}

class Twist {
  angle = D;
  rel = new Q();
}
const TW = new Twist();
function twistOf(T: Twist, wfA: Q, wfB: Q): void {
  mulConjQ(T.rel, wfA, wfB);
  AT.y = T.rel.z;
  AT.x = T.rel.w;
  atanApprox(AT);
  let a = 2 * AT.r;
  // Wrap: into (-pi, pi]
  if (a < -kPi) a += k2Pi;
  else if (a > kPi) a -= k2Pi;
  T.angle = a;
}

const reQ = new Q();
// the error vector of frame B against frame A, world: 2 vec(qB qA^-1), shortest arc
function rotError(o: V3, wfA: Q, wfB: Q): void {
  mulQConj(reQ, wfB, wfA);
  if (reQ.w < 0) {
    reQ.x = -reQ.x;
    reQ.y = -reQ.y;
    reQ.z = -reQ.z;
    reQ.w = -reQ.w;
  }
  o.x = reQ.x * 2;
  o.y = reQ.y * 2;
  o.z = reQ.z * 2;
}

// Skew(r) I Skew(r)^T, K = K + it (or K = it when `first`). The C++ multiplies the
// skews in full; their zero entries only ever add a signed zero, so they are left out.
function addSandwich(K: M3, r: V3, I: M3, first: boolean): void {
  const x = r.x;
  const y = r.y;
  const z = r.z;
  const i0 = I.m0;
  const i1 = I.m1;
  const i2 = I.m2;
  const i3 = I.m3;
  const i4 = I.m4;
  const i5 = I.m5;
  const i6 = I.m6;
  const i7 = I.m7;
  const i8 = I.m8;
  const nx = -x;
  const ny = -y;
  const nz = -z;
  const t0 = nz * i3 + y * i6;
  const t1 = nz * i4 + y * i7;
  const t2 = nz * i5 + y * i8;
  const t3 = z * i0 + nx * i6;
  const t4 = z * i1 + nx * i7;
  const t5 = z * i2 + nx * i8;
  const t6 = ny * i0 + x * i3;
  const t7 = ny * i1 + x * i4;
  const t8 = ny * i2 + x * i5;
  const p0 = t1 * nz + t2 * y;
  const p1 = t0 * z + t2 * nx;
  const p2 = t0 * ny + t1 * x;
  const p3 = t4 * nz + t5 * y;
  const p4 = t3 * z + t5 * nx;
  const p5 = t3 * ny + t4 * x;
  const p6 = t7 * nz + t8 * y;
  const p7 = t6 * z + t8 * nx;
  const p8 = t6 * ny + t7 * x;
  if (first) {
    K.m0 = p0;
    K.m1 = p1;
    K.m2 = p2;
    K.m3 = p3;
    K.m4 = p4;
    K.m5 = p5;
    K.m6 = p6;
    K.m7 = p7;
    K.m8 = p8;
  } else {
    K.m0 = K.m0 + p0;
    K.m1 = K.m1 + p1;
    K.m2 = K.m2 + p2;
    K.m3 = K.m3 + p3;
    K.m4 = K.m4 + p4;
    K.m5 = K.m5 + p5;
    K.m6 = K.m6 + p6;
    K.m7 = K.m7 + p7;
    K.m8 = K.m8 + p8;
  }
}
function pointK(K: M3, A: Body, B: Body, rA: V3, rB: V3, iA: M3, iB: M3): void {
  const aZero = iA === ZERO3;
  const bZero = iB === ZERO3;
  if (aZero && bZero) zeroM3(K);
  if (!aZero) addSandwich(K, rA, iA, true);
  if (!bZero) addSandwich(K, rB, iB, aZero);
  const ms = A.im + B.im;
  K.m0 += ms;
  K.m4 += ms;
  K.m8 += ms;
}

const wfA = new Q();
const wfB = new Q();
const relQ = new Q();
const tA = new V3();
const tB = new V3();
const tC = new V3();
const tD = new V3();
const tE = new V3();
const tF = new V3();
const tG = new V3();
const tH = new V3();
const tI = new V3();
const mA = new M3();
const mB = new M3();
const mC = new M3();

// --- shoulder (Domino type 7): prepare 0x1006021C0, velocity 0x100603590, position
// 0x1006039B0 ---------------------------------------------------------------------
function prepareShoulder(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  mulq(wfA, A.q, j.qa);
  mulq(wfB, B.q, j.qb);
  // motor
  addM3(mA, iA, iB);
  if (j.mode === 0) {
    zeroM3(j.Kmot);
    zeroV(j.Pmot);
    j.motMax = 0;
    zeroV(j.motBias);
    zeroV(j.motGamma);
  } else if (j.mode === 1) {
    inverse(mB, mA);
    rotError(tA, wfA, wfB);
    SF.hz = j.hz;
    SF.zeta = j.zeta;
    SF.h = st.h;
    SF.m = mB.m0;
    soft(SF);
    const g0 = SF.gamma;
    const b0 = SF.biasK;
    SF.m = mB.m4;
    soft(SF);
    const g1 = SF.gamma;
    const b1 = SF.biasK;
    SF.m = mB.m8;
    soft(SF);
    const g2 = SF.gamma;
    const b2 = SF.biasK;
    j.motGamma.x = g0;
    j.motGamma.y = g1;
    j.motGamma.z = g2;
    j.motBias.x = tA.x * b0;
    j.motBias.y = tA.y * b1;
    j.motBias.z = tA.z * b2;
    copyM3(mC, mA);
    mC.m0 += g0;
    mC.m4 += g1;
    mC.m8 += g2;
    inverse(j.Kmot, mC);
    j.motMax = kFltMax; // position motors ignore the authored torque
  } else {
    inverse(j.Kmot, mA);
    zeroV(j.motBias); // the target velocity (0x290) is zero for .phys
    zeroV(j.motGamma);
    j.motMax = j.maxT;
  }
  // swing / twist
  swingOf(SW, wfA, wfB, false);
  const swing = SW.angle;
  twistOf(TW, wfA, wfB);
  const tw = TW.angle;
  const rel = TW.rel;
  let twActive = false;
  if (j.twState !== 0) {
    if (Math.abs(j.twHi - j.twLo) < kTwistLock) {
      j.twState = 4;
      twActive = true;
    } else if (tw <= j.twLo) {
      if (j.twState !== 2) {
        j.twState = 2;
        j.Ptw = 0;
      }
      twActive = true;
    } else if (tw >= j.twHi) {
      if (j.twState !== 3) {
        j.twState = 3;
        j.Ptw = 0;
      }
      twActive = true;
    } else {
      j.twState = 1;
      j.Ptw = 0;
    }
  } else {
    j.Ptw = 0;
  }
  if (twActive && swing < kSwingLock) {
    const qq = rel.w * rel.w + rel.z * rel.z;
    let sc = 0;
    if (Math.abs(qq) > kTiny) {
      const r = 1 / qq;
      sc = (1 - qq * r) * r + r;
    }
    tA.x = rel.x * rel.z + rel.y * rel.w;
    tA.y = rel.y * rel.z - rel.x * rel.w;
    tA.z = qq;
    rot(tB, wfA, tA);
    j.twAxis.x = tB.x * sc;
    j.twAxis.y = tB.y * sc;
    j.twAxis.z = tB.z * sc;
    mulm(j.iaT, iA, j.twAxis);
    mulm(j.ibT, iB, j.twAxis);
    const k =
      j.twAxis.x * (j.iaT.x + j.ibT.x) +
      j.twAxis.y * (j.iaT.y + j.ibT.y) +
      j.twAxis.z * (j.iaT.z + j.ibT.z);
    j.twMass = Math.abs(k) > kTiny ? 1 / k : 0;
  }
  // cone
  if (swing >= j.cone) {
    if (j.coneState !== 3) {
      j.coneState = 3;
      j.Pcone = 0;
    }
    copyV(j.axisC, SW.axis);
    mulm(j.iaC, iA, j.axisC);
    mulm(j.ibC, iB, j.axisC);
    const k =
      j.axisC.x * (j.iaC.x + j.ibC.x) +
      j.axisC.y * (j.iaC.y + j.ibC.y) +
      j.axisC.z * (j.iaC.z + j.ibC.z);
    j.coneMass = Math.abs(k) > kTiny ? 1 / k : 0;
  } else {
    j.coneState = 1;
    j.Pcone = 0;
  }
  // point
  tA.x = j.pa.x - A.lc.x;
  tA.y = j.pa.y - A.lc.y;
  tA.z = j.pa.z - A.lc.z;
  rot(j.rA, A.q, tA);
  tA.x = j.pb.x - B.lc.x;
  tA.y = j.pb.y - B.lc.y;
  tA.z = j.pb.z - B.lc.z;
  rot(j.rB, B.q, tA);
  pointK(mA, A, B, j.rA, j.rB, iA, iB);
  inverse(j.Klin, mA);
  // warm start
  if (st.warm) {
    const ratio = st.dtRatio;
    j.Plin.x = j.Plin.x * ratio;
    j.Plin.y = j.Plin.y * ratio;
    j.Plin.z = j.Plin.z * ratio;
    j.Pmot.x = j.Pmot.x * ratio;
    j.Pmot.y = j.Pmot.y * ratio;
    j.Pmot.z = j.Pmot.z * ratio;
    j.Ptw *= ratio;
    j.Pcone *= ratio;
    cross(tA, j.rA, j.Plin);
    cross(tB, j.rB, j.Plin);
    const Ptw = j.Ptw;
    const Pcone = j.Pcone;
    if (A.type === kBodyDynamic) {
      A.v.x = A.v.x - j.Plin.x * A.im;
      A.v.y = A.v.y - j.Plin.y * A.im;
      A.v.z = A.v.z - j.Plin.z * A.im;
      tC.x = tA.x + j.Pmot.x;
      tC.y = tA.y + j.Pmot.y;
      tC.z = tA.z + j.Pmot.z;
      mulm(tC, iA, tC);
      A.w.x = A.w.x - tC.x - j.iaT.x * Ptw - j.iaC.x * Pcone;
      A.w.y = A.w.y - tC.y - j.iaT.y * Ptw - j.iaC.y * Pcone;
      A.w.z = A.w.z - tC.z - j.iaT.z * Ptw - j.iaC.z * Pcone;
    }
    if (B.type === kBodyDynamic) {
      B.v.x = B.v.x + j.Plin.x * B.im;
      B.v.y = B.v.y + j.Plin.y * B.im;
      B.v.z = B.v.z + j.Plin.z * B.im;
      tC.x = tB.x + j.Pmot.x;
      tC.y = tB.y + j.Pmot.y;
      tC.z = tB.z + j.Pmot.z;
      mulm(tC, iB, tC);
      B.w.x = B.w.x + tC.x + j.ibT.x * Ptw + j.ibC.x * Pcone;
      B.w.y = B.w.y + tC.y + j.ibT.y * Ptw + j.ibC.y * Pcone;
      B.w.z = B.w.z + tC.z + j.ibT.z * Ptw + j.ibC.z * Pcone;
    }
  } else {
    zeroV(j.Plin);
    zeroV(j.Pmot);
    j.Ptw = 0;
    j.Pcone = 0;
  }
}

function velShoulder(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  const Aw = A.w;
  const Bw = B.w;
  // motor (3D, soft, clamped by length)
  if (j.mode !== 0) {
    tA.x = Bw.x - Aw.x + j.motBias.x + j.motGamma.x * j.Pmot.x;
    tA.y = Bw.y - Aw.y + j.motBias.y + j.motGamma.y * j.Pmot.y;
    tA.z = Bw.z - Aw.z + j.motBias.z + j.motGamma.z * j.Pmot.z;
    mulm(tA, j.Kmot, tA);
    let npx = j.Pmot.x - tA.x;
    let npy = j.Pmot.y - tA.y;
    let npz = j.Pmot.z - tA.z;
    const mx = j.motMax * st.h;
    const l2 = npx * npx + npy * npy + npz * npz;
    if (!(l2 <= mx * mx)) {
      // 0x100603590: (P max) rsqrt-Newton(|P|^2)
      const r0 = 1 / Math.sqrt(l2);
      const rp = (0.5 - l2 * 0.5 * (r0 * r0)) * r0 + r0;
      npx = npx * mx * rp;
      npy = npy * mx * rp;
      npz = npz * mx * rp;
    }
    tB.x = npx - j.Pmot.x;
    tB.y = npy - j.Pmot.y;
    tB.z = npz - j.Pmot.z;
    j.Pmot.x = npx;
    j.Pmot.y = npy;
    j.Pmot.z = npz;
    if (A.type === kBodyDynamic) {
      mulm(tC, iA, tB);
      Aw.x = Aw.x - tC.x;
      Aw.y = Aw.y - tC.y;
      Aw.z = Aw.z - tC.z;
    }
    if (B.type === kBodyDynamic) {
      mulm(tC, iB, tB);
      Bw.x = Bw.x + tC.x;
      Bw.y = Bw.y + tC.y;
      Bw.z = Bw.z + tC.z;
    }
  }
  // twist limit
  if (j.twState >= 2) {
    const cd =
      (Bw.x - Aw.x) * j.twAxis.x + (Bw.y - Aw.y) * j.twAxis.y + (Bw.z - Aw.z) * j.twAxis.z;
    const l = -cd * j.twMass;
    let d: number;
    if (j.twState === 2) {
      const s = j.Ptw + l;
      const n = s < 0 ? 0 : s; // std::max(s, 0)
      d = n - j.Ptw;
      j.Ptw = n;
    } else if (j.twState === 3) {
      const s = j.Ptw + l;
      const n = 0 < s ? 0 : s; // std::min(s, 0)
      d = n - j.Ptw;
      j.Ptw = n;
    } else {
      j.Ptw += l;
      d = l;
    }
    Aw.x = Aw.x - j.iaT.x * d;
    Aw.y = Aw.y - j.iaT.y * d;
    Aw.z = Aw.z - j.iaT.z * d;
    Bw.x = Bw.x + j.ibT.x * d;
    Bw.y = Bw.y + j.ibT.y * d;
    Bw.z = Bw.z + j.ibT.z * d;
  }
  // cone limit
  if (j.coneState === 3) {
    const cd =
      (Bw.x - Aw.x) * j.axisC.x + (Bw.y - Aw.y) * j.axisC.y + (Bw.z - Aw.z) * j.axisC.z;
    const s = j.Pcone - cd * j.coneMass;
    const n = 0 < s ? 0 : s; // std::min(s, 0)
    const d = n - j.Pcone;
    j.Pcone = n;
    Aw.x = Aw.x - j.iaC.x * d;
    Aw.y = Aw.y - j.iaC.y * d;
    Aw.z = Aw.z - j.iaC.z * d;
    Bw.x = Bw.x + j.ibC.x * d;
    Bw.y = Bw.y + j.ibC.y * d;
    Bw.z = Bw.z + j.ibC.z * d;
  }
  // point
  velPoint(j, A, B, iA, iB);
}

const vpC = new V3();
const vpA = new V3();
const vpB = new V3();
const vpL = new V3();
// cd = vB + wB x rB - vA - wA x rA; l = -Klin cd; applied both ways
function velPoint(j: Joint, A: Body, B: Body, iA: M3, iB: M3): void {
  cross(vpB, B.w, j.rB);
  cross(vpA, A.w, j.rA);
  vpC.x = B.v.x + vpB.x - A.v.x - vpA.x;
  vpC.y = B.v.y + vpB.y - A.v.y - vpA.y;
  vpC.z = B.v.z + vpB.z - A.v.z - vpA.z;
  mulm(vpL, j.Klin, vpC);
  vpL.x = -vpL.x;
  vpL.y = -vpL.y;
  vpL.z = -vpL.z;
  j.Plin.x = j.Plin.x + vpL.x;
  j.Plin.y = j.Plin.y + vpL.y;
  j.Plin.z = j.Plin.z + vpL.z;
  applyLin(A, vpL, j.rA, iA, -1);
  applyLin(B, vpL, j.rB, iB, 1);
}

const ppP = new V3();
const ppC = new V3();
const ppRA = new V3();
const ppRB = new V3();
const ppK = new M3();
const ppKi = new M3();
// point: full correction, 1 / det by rcp + Newton
function posPoint(j: Joint, A: Body, B: Body): void {
  const iA = iwOf(A);
  const iB = iwOf(B);
  ppC.x = j.pa.x - A.lc.x;
  ppC.y = j.pa.y - A.lc.y;
  ppC.z = j.pa.z - A.lc.z;
  rot(ppRA, A.q, ppC);
  ppC.x = j.pb.x - B.lc.x;
  ppC.y = j.pb.y - B.lc.y;
  ppC.z = j.pb.z - B.lc.z;
  rot(ppRB, B.q, ppC);
  ppC.x = B.c.x + ppRB.x - (A.c.x + ppRA.x);
  ppC.y = B.c.y + ppRB.y - (A.c.y + ppRA.y);
  ppC.z = B.c.z + ppRB.z - (A.c.z + ppRA.z);
  pointK(ppK, A, B, ppRA, ppRB, iA, iB);
  inverseFast(ppKi, ppK);
  mulm(ppP, ppKi, ppC);
  ppP.x = -ppP.x;
  ppP.y = -ppP.y;
  ppP.z = -ppP.z;
  movePos(A, ppP, ppRA, iA, -1);
  movePos(B, ppP, ppRB, iB, 1);
}

function posShoulder(w: World, j: Joint): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  // twist: runs while the limit is on and the swing (exact sqrt) is under 170 deg;
  // inside the limits the impulse is zero but the rotations are still renormalised
  if (j.twState !== 0) {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    swingOf(SW, wfA, wfB, true);
    twistOf(TW, wfA, wfB);
    const tw = TW.angle;
    const rel = TW.rel;
    if (SW.angle < kSwingLock) {
      const qq = rel.w * rel.w + rel.z * rel.z;
      let sc = 0;
      if (Math.abs(qq) > kTiny) {
        const r = 1 / qq;
        sc = (1 - qq * r) * r + r;
      }
      tA.x = rel.x * rel.z + rel.y * rel.w;
      tA.y = rel.y * rel.z - rel.x * rel.w;
      tA.z = qq;
      rot(tB, wfA, tA);
      tB.x = tB.x * sc;
      tB.y = tB.y * sc;
      tB.z = tB.z * sc;
      mulm(tC, iA, tB);
      mulm(tD, iB, tB);
      const k =
        (tC.x + tD.x) * tB.x + (tC.y + tD.y) * tB.y + (tC.z + tD.z) * tB.z;
      const mass = Math.abs(k) > kTiny ? 1 / k : 0;
      let C = 0;
      if (j.twState === 4) {
        const m = kMaxC < tw ? +kMaxC : tw;
        C = (m < -kMaxC ? -kMaxC : m) * k02;
      } else if (tw > j.twLo) {
        if (tw >= j.twHi) {
          const s = tw - j.twHi + -kSlop;
          const m = kMaxC < s ? +kMaxC : s;
          C = (0 < m ? m : 0) * k02;
        }
      } else {
        const s = tw - j.twLo + kSlop;
        const m = s < 0 ? s : 0;
        C = (m < -kMaxC ? -kMaxC : m) * k02;
      }
      const imp = -mass * C;
      const nimp = -imp;
      tC.x = tC.x * nimp;
      tC.y = tC.y * nimp;
      tC.z = tC.z * nimp;
      moveAng(A, tC);
      tD.x = tD.x * imp;
      tD.y = tD.y * imp;
      tD.z = tD.z * imp;
      moveAng(B, tD);
    }
  }
  // cone: swing (rsqrt) at or past the cone
  {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    swingOf(SW, wfA, wfB, false);
    if (SW.angle >= j.cone) {
      const ax = SW.axis;
      mulm(tC, iA, ax);
      mulm(tD, iB, ax);
      const k = (tC.x + tD.x) * ax.x + (tC.y + tD.y) * ax.y + (tC.z + tD.z) * ax.z;
      const mass = Math.abs(k) > kTiny ? 1 / k : 0;
      const s = SW.angle - j.cone + -kSlop;
      const m = kMaxC < s ? +kMaxC : s;
      const C = (0 < m ? m : 0) * k02;
      const imp = -mass * C;
      const nimp = -imp;
      tC.x = tC.x * nimp;
      tC.y = tC.y * nimp;
      tC.z = tC.z * nimp;
      moveAng(A, tC);
      tD.x = tD.x * imp;
      tD.y = tD.y * imp;
      tD.z = tD.z * imp;
      moveAng(B, tD);
    }
  }
  posPoint(j, A, B);
  syncOrigin(A);
  syncOrigin(B);
}

// --- revolute (Domino type 6): ctor 0x1005FF280, prepare 0x1005FF410, velocity
// 0x1006003C0, position 0x100600840 ----------------------------------------------
// the hinge angle 2 atan(rel.z, rel.w) less the limits' centre, wrapped once by
// 4 pi into [-2 pi, 2 pi]; in HG.a
class HingeReg {
  a = D;
}
const HG = new HingeReg();
function hingeOf(j: Joint, rel: Q): void {
  AT.y = rel.z;
  AT.x = rel.w;
  atanApprox(AT);
  let a = 2 * AT.r - j.revCenter;
  if (a < -k2Pi) a += k4Pi;
  else if (a > k2Pi) a -= k4Pi;
  HG.a = a;
}

const lrT = new V3();
const lrU = new V3();
// the angular lock's rows: d(rel.x, rel.y)/dt = J (wB - wA),
// J_i = 0.5 Rot(wfA, rel.w e_i + rel.v x e_i)
function lockRows(wf: Q, rel: Q, J1: V3, J2: V3): void {
  // e_x: rel.v x (1, 0, 0) = (0, rel.z, -rel.y) as Cross computes it
  lrU.x = rel.y * 0 - rel.z * 0;
  lrU.y = rel.z * 1 - rel.x * 0;
  lrU.z = rel.x * 0 - rel.y * 1;
  lrT.x = rel.w + lrU.x;
  lrT.y = 0 + lrU.y;
  lrT.z = 0 + lrU.z;
  rot(J1, wf, lrT);
  J1.x = J1.x * 0.5;
  J1.y = J1.y * 0.5;
  J1.z = J1.z * 0.5;
  // e_y: rel.v x (0, 1, 0)
  lrU.x = rel.y * 0 - rel.z * 1;
  lrU.y = rel.z * 0 - rel.x * 0;
  lrU.z = rel.x * 1 - rel.y * 0;
  lrT.x = 0 + lrU.x;
  lrT.y = rel.w + lrU.y;
  lrT.z = 0 + lrU.z;
  rot(J2, wf, lrT);
  J2.x = J2.x * 0.5;
  J2.y = J2.y * 0.5;
  J2.z = J2.z * 0.5;
}

function prepareRevolute(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  mulq(wfA, A.q, j.qa);
  mulq(wfB, B.q, j.qb);
  mulConjQ(relQ, wfA, wfB);
  // hinge axis (frame A's Z) and its axial mass 0x2B8 = 1 / K
  rot(j.hingeAxis, wfA, ZAXIS);
  mulm(j.iaH, iA, j.hingeAxis);
  mulm(j.ibH, iB, j.hingeAxis);
  j.hingeK =
    (j.iaH.x + j.ibH.x) * j.hingeAxis.x +
    (j.iaH.y + j.ibH.y) * j.hingeAxis.y +
    (j.iaH.z + j.ibH.z) * j.hingeAxis.z;
  j.limMass = Math.abs(j.hingeK) > kTiny ? 1 / j.hingeK : 0;
  // angular lock: 2 rows, 2x2 inverse (exact divide)
  {
    lockRows(wfA, relQ, j.lockJ1, j.lockJ2);
    addM3(mA, iA, iB);
    mulm(tA, mA, j.lockJ1);
    mulm(tB, mA, j.lockJ2);
    const J1 = j.lockJ1;
    const J2 = j.lockJ2;
    const a = J1.x * tA.x + J1.y * tA.y + J1.z * tA.z;
    const b = J1.x * tB.x + J1.y * tB.y + J1.z * tB.z;
    const c = J2.x * tA.x + J2.y * tA.y + J2.z * tA.z;
    const d = J2.x * tB.x + J2.y * tB.y + J2.z * tB.z;
    const det = a * d - b * c;
    const k = Math.abs(det) > kTiny ? 1 / det : 0;
    j.lockK0 = d * k;
    j.lockK1 = -b * k;
    j.lockK2 = -c * k;
    j.lockK3 = a * k;
  }
  // point
  tA.x = j.pa.x - A.lc.x;
  tA.y = j.pa.y - A.lc.y;
  tA.z = j.pa.z - A.lc.z;
  rot(j.rA, A.q, tA);
  tA.x = j.pb.x - B.lc.x;
  tA.y = j.pb.y - B.lc.y;
  tA.z = j.pb.z - B.lc.z;
  rot(j.rB, B.q, tA);
  pointK(mA, A, B, j.rA, j.rB, iA, iB);
  inverse(j.Klin, mA);
  // limit state (0x2BC): locked keeps its impulse; otherwise the impulse resets
  // whenever the state changes, and always inside the range
  hingeOf(j, relQ);
  const ang = HG.a;
  if (j.limState !== 0) {
    if (j.revHalf < kSlop) {
      j.limState = 4;
    } else if (ang > -j.revHalf) {
      if (ang >= j.revHalf) {
        if (j.limState !== 3) {
          j.limState = 3;
          j.Plim = 0;
        }
      } else {
        j.limState = 1;
        j.Plim = 0;
      }
    } else if (j.limState !== 2) {
      j.limState = 2;
      j.Plim = 0;
    }
  } else {
    j.Plim = 0;
  }
  // motor (0x2A8): 1 = position (soft towards the centre, max FLT_MAX), 0 = off,
  // else velocity (target speed 0, max = maxTorque)
  if (j.mode === 1) {
    const om = k2Pi * j.hz;
    const c = (j.zeta + j.zeta) * (om * j.limMass);
    const k = om * om * j.limMass;
    const dd = (k * st.h + c) * st.h;
    let g = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      g = (1 - dd * r) * r + r;
    }
    j.m1Gamma = g;
    j.m1Bias = st.h * g * (k * ang);
    const km = g + j.hingeK;
    j.m1Mass = Math.abs(km) > kTiny ? 1 / km : 0;
    j.m1Max = kFltMax;
  } else if (j.mode === 0) {
    j.m1Mass = 0;
    j.m1Bias = 0;
    j.m1Gamma = 0;
    j.m1Max = 0;
    j.Pmot1 = 0;
  } else {
    j.m1Mass = j.limMass;
    j.m1Bias = -0;
    j.m1Gamma = 0;
    j.m1Max = j.maxT;
  }
  if (st.warm) {
    const ratio = st.dtRatio;
    j.Plin.x = j.Plin.x * ratio;
    j.Plin.y = j.Plin.y * ratio;
    j.Plin.z = j.Plin.z * ratio;
    j.Pang.x = j.Pang.x * ratio;
    j.Pang.y = j.Pang.y * ratio;
    j.Pang.z = j.Pang.z * ratio;
    j.Pmot1 *= ratio;
    j.Plim *= ratio;
    tA.x = j.lockJ1.x * j.Pang.x + j.lockJ2.x * j.Pang.y;
    tA.y = j.lockJ1.y * j.Pang.x + j.lockJ2.y * j.Pang.y;
    tA.z = j.lockJ1.z * j.Pang.x + j.lockJ2.z * j.Pang.y;
    const ax = j.Plim + j.Pmot1;
    if (A.type === kBodyDynamic) {
      A.v.x = A.v.x - j.Plin.x * A.im;
      A.v.y = A.v.y - j.Plin.y * A.im;
      A.v.z = A.v.z - j.Plin.z * A.im;
      cross(tB, j.rA, j.Plin);
      mulm(tB, iA, tB);
      mulm(tC, iA, tA);
      A.w.x = A.w.x - tB.x - tC.x - j.iaH.x * ax;
      A.w.y = A.w.y - tB.y - tC.y - j.iaH.y * ax;
      A.w.z = A.w.z - tB.z - tC.z - j.iaH.z * ax;
    }
    if (B.type === kBodyDynamic) {
      B.v.x = B.v.x + j.Plin.x * B.im;
      B.v.y = B.v.y + j.Plin.y * B.im;
      B.v.z = B.v.z + j.Plin.z * B.im;
      cross(tB, j.rB, j.Plin);
      mulm(tB, iB, tB);
      mulm(tC, iB, tA);
      B.w.x = B.w.x + tB.x + tC.x + j.ibH.x * ax;
      B.w.y = B.w.y + tB.y + tC.y + j.ibH.y * ax;
      B.w.z = B.w.z + tB.z + tC.z + j.ibH.z * ax;
    }
  } else {
    zeroV(j.Plin);
    zeroV(j.Pang);
    j.Pmot1 = 0;
    j.Plim = 0;
  }
}

function velRevolute(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  const Aw = A.w;
  const Bw = B.w;
  const H = j.hingeAxis;
  // motor (always solved; off = zero mass and zero bound)
  {
    const cd =
      (Bw.x - Aw.x) * H.x + (Bw.y - Aw.y) * H.y + (Bw.z - Aw.z) * H.z + j.m1Bias;
    const np0 = j.Pmot1 - (j.m1Gamma * j.Pmot1 + cd) * j.m1Mass;
    const mx = st.h * j.m1Max;
    const np = np0 < -mx ? -mx : np0 < mx ? np0 : mx; // std::min(mx, np0)
    const d = np - j.Pmot1;
    j.Pmot1 = np;
    Aw.x = Aw.x - j.iaH.x * d;
    Aw.y = Aw.y - j.iaH.y * d;
    Aw.z = Aw.z - j.iaH.z * d;
    Bw.x = Bw.x + j.ibH.x * d;
    Bw.y = Bw.y + j.ibH.y * d;
    Bw.z = Bw.z + j.ibH.z * d;
  }
  // limit: 2 lower (>= 0), 3 upper (<= 0), 4 locked (free)
  if (j.limState >= 2) {
    let l = -((Bw.x - Aw.x) * H.x + (Bw.y - Aw.y) * H.y + (Bw.z - Aw.z) * H.z) * j.limMass;
    if (j.limState === 2) {
      const s = j.Plim + l;
      const n = 0 < s ? s : 0; // std::max(0, s)
      l = n - j.Plim;
      j.Plim = n;
    } else if (j.limState === 3) {
      const s = j.Plim + l;
      const n = s < 0 ? s : 0; // std::min(0, s)
      l = n - j.Plim;
      j.Plim = n;
    } else if (j.limState === 4) {
      j.Plim += l;
    }
    Aw.x = Aw.x - j.iaH.x * l;
    Aw.y = Aw.y - j.iaH.y * l;
    Aw.z = Aw.z - j.iaH.z * l;
    Bw.x = Bw.x + j.ibH.x * l;
    Bw.y = Bw.y + j.ibH.y * l;
    Bw.z = Bw.z + j.ibH.z * l;
  }
  // angular lock (2 rows)
  {
    const dx = Bw.x - Aw.x;
    const dy = Bw.y - Aw.y;
    const dz = Bw.z - Aw.z;
    const J1 = j.lockJ1;
    const J2 = j.lockJ2;
    const c1 = J1.x * dx + J1.y * dy + J1.z * dz;
    const c2 = J2.x * dx + J2.y * dy + J2.z * dz;
    const l1 = -c2 * j.lockK2 - c1 * j.lockK0;
    const l2 = -c2 * j.lockK3 - c1 * j.lockK1;
    j.Pang.x += l1;
    j.Pang.y += l2;
    tA.x = J1.x * l1 + J2.x * l2;
    tA.y = J1.y * l1 + J2.y * l2;
    tA.z = J1.z * l1 + J2.z * l2;
    mulm(tB, iA, tA);
    Aw.x = Aw.x - tB.x;
    Aw.y = Aw.y - tB.y;
    Aw.z = Aw.z - tB.z;
    mulm(tB, iB, tA);
    Bw.x = Bw.x + tB.x;
    Bw.y = Bw.y + tB.y;
    Bw.z = Bw.z + tB.z;
  }
  // point
  velPoint(j, A, B, iA, iB);
}

function posRevolute(w: World, j: Joint): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  // limit (when the joint has one): prepare's state picks locked or the range test;
  // inside the range the impulse is zero but the rotations are still renormalised
  if (j.limState !== 0) {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    mulConjQ(relQ, wfA, wfB);
    hingeOf(j, relQ);
    const ang = HG.a;
    rot(tA, wfA, ZAXIS);
    mulm(tB, iA, tA);
    mulm(tC, iB, tA);
    const dd = (tB.x + tC.x) * tA.x + (tB.y + tC.y) * tA.y + (tB.z + tC.z) * tA.z;
    let mass = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      mass = (1 - dd * r) * r + r;
    }
    let C = 0;
    if (j.limState === 4) {
      const m = kMaxC < ang ? +kMaxC : ang;
      C = (m < -kMaxC ? -kMaxC : m) * k02;
    } else if (ang > -j.revHalf) {
      if (ang >= j.revHalf) {
        const s = ang - j.revHalf + -kSlop;
        const m = kMaxC < s ? +kMaxC : s;
        C = (0 < m ? m : 0) * k02;
      }
    } else {
      const s = ang + kSlop + j.revHalf;
      const m = s < 0 ? s : 0;
      C = (m < -kMaxC ? -kMaxC : m) * k02;
    }
    const imp = C * -mass;
    const nimp = -imp;
    tB.x = tB.x * nimp;
    tB.y = tB.y * nimp;
    tB.z = tB.z * nimp;
    moveAng(A, tB);
    tC.x = tC.x * imp;
    tC.y = tC.y * imp;
    tC.z = tC.z * imp;
    moveAng(B, tC);
  }
  // angular lock: C = (rel.x, rel.y), full correction; the 2x2 from the current
  // rows (1 / det by rcp + Newton), applied along prepare's rows
  {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    mulConjQ(relQ, wfA, wfB);
    lockRows(wfA, relQ, tA, tB);
    addM3(mA, iA, iB);
    mulm(tC, mA, tA);
    mulm(tD, mA, tB);
    const a = tA.x * tC.x + tA.y * tC.y + tA.z * tC.z;
    const b = tA.x * tD.x + tA.y * tD.y + tA.z * tD.z;
    const c = tB.x * tC.x + tB.y * tC.y + tB.z * tC.z;
    const d = tB.x * tD.x + tB.y * tD.y + tB.z * tD.z;
    const dd = a * d - b * c;
    let k = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      k = (1 - dd * r) * r + r;
    }
    const e1 = -relQ.x;
    const e2 = -relQ.y;
    const l1 = (d * e1 - b * e2) * k;
    const l2 = (a * e2 - c * e1) * k;
    const J1 = j.lockJ1;
    const J2 = j.lockJ2;
    tE.x = J1.x * l1 + J2.x * l2;
    tE.y = J1.y * l1 + J2.y * l2;
    tE.z = J1.z * l1 + J2.z * l2;
    mulm(tF, iA, tE);
    tF.x = tF.x * -1;
    tF.y = tF.y * -1;
    tF.z = tF.z * -1;
    moveAng(A, tF);
    mulm(tF, iB, tE);
    moveAng(B, tF);
  }
  posPoint(j, A, B);
  syncOrigin(A);
  syncOrigin(B);
}

// --- weld (Domino type 9): ctor 0x1006063B0, prepare 0x1006064E0, velocity
// 0x100607320, position 0x100607690 ----------------------------------------------
const weQ = new Q();
const weT = new V3();
// the weld's rotation error, world: 2 Rot(wfA, rel.v), rel = conj(fA) fB on the
// short arc (w >= 0)
function weldError(o: V3, a: Q, b: Q): void {
  mulConjQ(weQ, a, b);
  if (weQ.w < 0) {
    weQ.x = -weQ.x;
    weQ.y = -weQ.y;
    weQ.z = -weQ.z;
    weQ.w = -weQ.w;
  }
  weT.x = weQ.x * 2;
  weT.y = weQ.y * 2;
  weT.z = weQ.z * 2;
  rot(o, a, weT);
}

class WeldReg {
  hz = D;
  zeta = D;
  h = D;
}
const WR = new WeldReg();
// per-axis soft terms: c = (4 pi Hz) zeta m, k = (2 pi Hz)^2 m, gamma = 1 / ((k h +
// c) h) (rcp + Newton), bias = (k h) gamma C
function weldSoft(R: WeldReg, M: M3, C: V3, gamma: V3, bias: V3): void {
  const hz = R.hz;
  const zeta = R.zeta;
  const h = R.h;
  const om = k2Pi * hz;
  let m = M.m0;
  let c = C.x;
  let cc = hz * kWeldHz * zeta * m;
  let kk = om * om * m;
  let d = (kk * h + cc) * h;
  let g = 0;
  if (Math.abs(d) > kTiny) {
    const r = 1 / d;
    g = (1 - d * r) * r + r;
  }
  gamma.x = g;
  bias.x = kk * h * g * c;
  m = M.m4;
  c = C.y;
  cc = hz * kWeldHz * zeta * m;
  kk = om * om * m;
  d = (kk * h + cc) * h;
  g = 0;
  if (Math.abs(d) > kTiny) {
    const r = 1 / d;
    g = (1 - d * r) * r + r;
  }
  gamma.y = g;
  bias.y = kk * h * g * c;
  m = M.m8;
  c = C.z;
  cc = hz * kWeldHz * zeta * m;
  kk = om * om * m;
  d = (kk * h + cc) * h;
  g = 0;
  if (Math.abs(d) > kTiny) {
    const r = 1 / d;
    g = (1 - d * r) * r + r;
  }
  gamma.z = g;
  bias.z = kk * h * g * c;
}

function prepareWeld(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  // angular: 0x70 = (iA + iB)^-1; soft when Hz (0x1F0) > 0, then 0x70 = (iA + iB +
  // diag gamma)^-1 and the impulse is capped
  addM3(mA, iA, iB);
  inverse(j.Kang, mA);
  j.angCap = kFltMax;
  j.angCap2 = kFltMax;
  if (j.angHz > 0) {
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    weldError(tA, wfA, wfB);
    WR.hz = j.angHz;
    WR.zeta = j.angZeta;
    WR.h = st.h;
    weldSoft(WR, j.Kang, tA, j.angGamma, j.angBias);
    copyM3(mB, mA);
    mB.m0 += j.angGamma.x;
    mB.m4 += j.angGamma.y;
    mB.m8 += j.angGamma.z;
    inverse(j.Kang, mB);
    // cap = (pi/4) x inv_dt x trace(I) of the dynamic side (the smaller of two);
    // none when neither is dynamic or cap^2 is not above the guard
    const da = A.type === kBodyDynamic;
    const db = B.type === kBodyDynamic;
    if (da || db) {
      const ta = A.I.m0 + A.I.m4 + A.I.m8;
      const tb = B.I.m0 + B.I.m4 + B.I.m8;
      const t = da && db ? (tb < ta ? tb : ta) : da ? ta : tb;
      const cap = t * kCapAng * st.inv;
      if (kTiny < cap * cap) {
        j.angCap = cap;
        j.angCap2 = cap * cap;
      }
    }
  } else {
    zeroV(j.angGamma);
    zeroV(j.angBias);
  }
  // linear: 0xE0 = K^-1, soft when Hz (0x1F8) > 0
  tA.x = j.pa.x - A.lc.x;
  tA.y = j.pa.y - A.lc.y;
  tA.z = j.pa.z - A.lc.z;
  rot(j.rA, A.q, tA);
  tA.x = j.pb.x - B.lc.x;
  tA.y = j.pb.y - B.lc.y;
  tA.z = j.pb.z - B.lc.z;
  rot(j.rB, B.q, tA);
  pointK(mA, A, B, j.rA, j.rB, iA, iB);
  inverse(j.Klin, mA);
  if (j.linHz > 0) {
    tA.x = B.c.x + j.rB.x - (A.c.x + j.rA.x);
    tA.y = B.c.y + j.rB.y - (A.c.y + j.rA.y);
    tA.z = B.c.z + j.rB.z - (A.c.z + j.rA.z);
    WR.hz = j.linHz;
    WR.zeta = j.linZeta;
    WR.h = st.h;
    weldSoft(WR, j.Klin, tA, j.linGamma, j.linBias);
    mA.m0 += j.linGamma.x;
    mA.m4 += j.linGamma.y;
    mA.m8 += j.linGamma.z;
    inverse(j.Klin, mA);
  } else {
    zeroV(j.linGamma);
    zeroV(j.linBias);
  }
  if (st.warm) {
    const ratio = st.dtRatio;
    j.Plin.x = j.Plin.x * ratio;
    j.Plin.y = j.Plin.y * ratio;
    j.Plin.z = j.Plin.z * ratio;
    j.Pang.x = j.Pang.x * ratio;
    j.Pang.y = j.Pang.y * ratio;
    j.Pang.z = j.Pang.z * ratio;
    if (A.type === kBodyDynamic) {
      A.v.x = A.v.x - j.Plin.x * A.im;
      A.v.y = A.v.y - j.Plin.y * A.im;
      A.v.z = A.v.z - j.Plin.z * A.im;
      cross(tB, j.rA, j.Plin);
      tB.x = j.Pang.x + tB.x;
      tB.y = j.Pang.y + tB.y;
      tB.z = j.Pang.z + tB.z;
      mulm(tB, iA, tB);
      A.w.x = A.w.x - tB.x;
      A.w.y = A.w.y - tB.y;
      A.w.z = A.w.z - tB.z;
    }
    if (B.type === kBodyDynamic) {
      B.v.x = B.v.x + j.Plin.x * B.im;
      B.v.y = B.v.y + j.Plin.y * B.im;
      B.v.z = B.v.z + j.Plin.z * B.im;
      cross(tB, j.rB, j.Plin);
      tB.x = j.Pang.x + tB.x;
      tB.y = j.Pang.y + tB.y;
      tB.z = j.Pang.z + tB.z;
      mulm(tB, iB, tB);
      B.w.x = B.w.x + tB.x;
      B.w.y = B.w.y + tB.y;
      B.w.z = B.w.z + tB.z;
    }
  } else {
    zeroV(j.Plin);
    zeroV(j.Pang);
  }
}

function velWeld(w: World, j: Joint): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  const Aw = A.w;
  const Bw = B.w;
  // angular: |P| clamped to the cap, P x cap x rsqrt(|P|^2) (rsqrtps + Newton)
  {
    const P = j.Pang;
    const G = j.angGamma;
    const Bi = j.angBias;
    tA.x = G.x * P.x + (Bw.x - Aw.x + Bi.x);
    tA.y = G.y * P.y + (Bw.y - Aw.y + Bi.y);
    tA.z = G.z * P.z + (Bw.z - Aw.z + Bi.z);
    mulm(tA, j.Kang, tA);
    let npx = P.x - tA.x;
    let npy = P.y - tA.y;
    let npz = P.z - tA.z;
    const l2 = npx * npx + npy * npy + npz * npz;
    if (j.angCap2 < l2) {
      const r = 1 / Math.sqrt(l2);
      const rn = (0.5 - l2 * 0.5 * (r * r)) * r + r;
      npx = j.angCap * npx * rn;
      npy = j.angCap * npy * rn;
      npz = j.angCap * npz * rn;
    }
    tB.x = npx - P.x;
    tB.y = npy - P.y;
    tB.z = npz - P.z;
    P.x = npx;
    P.y = npy;
    P.z = npz;
    mulm(tC, iA, tB);
    Aw.x = Aw.x - tC.x;
    Aw.y = Aw.y - tC.y;
    Aw.z = Aw.z - tC.z;
    mulm(tC, iB, tB);
    Bw.x = Bw.x + tC.x;
    Bw.y = Bw.y + tC.y;
    Bw.z = Bw.z + tC.z;
  }
  // linear
  cross(vpB, Bw, j.rB);
  cross(vpA, Aw, j.rA);
  vpC.x = B.v.x + vpB.x - A.v.x - vpA.x + j.linBias.x + j.linGamma.x * j.Plin.x;
  vpC.y = B.v.y + vpB.y - A.v.y - vpA.y + j.linBias.y + j.linGamma.y * j.Plin.y;
  vpC.z = B.v.z + vpB.z - A.v.z - vpA.z + j.linBias.z + j.linGamma.z * j.Plin.z;
  mulm(vpL, j.Klin, vpC);
  vpL.x = -vpL.x;
  vpL.y = -vpL.y;
  vpL.z = -vpL.z;
  j.Plin.x = j.Plin.x + vpL.x;
  j.Plin.y = j.Plin.y + vpL.y;
  j.Plin.z = j.Plin.z + vpL.z;
  applyLin(A, vpL, j.rA, iA, -1);
  applyLin(B, vpL, j.rB, iB, 1);
}

function posWeld(w: World, j: Joint): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  // angular only when its Hz is exactly 0 (a negative Hz is rigid in the velocity
  // solve but gets no position correction); full correction
  if (j.angHz === 0) {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    weldError(tA, wfA, wfB);
    addM3(mA, iA, iB);
    inverseFast(mB, mA);
    mulm(tB, mB, tA);
    tB.x = -tB.x;
    tB.y = -tB.y;
    tB.z = -tB.z;
    mulm(tC, iA, tB);
    tC.x = tC.x * -1;
    tC.y = tC.y * -1;
    tC.z = tC.z * -1;
    moveAng(A, tC);
    mulm(tC, iB, tB);
    moveAng(B, tC);
  }
  if (j.linHz === 0) posPoint(j, A, B);
  syncOrigin(A);
  syncOrigin(B);
}

// --- prismatic (Domino type 5): ctor 0x1005FC640, prepare 0x1005FC740, velocity
// 0x1005FD270, position 0x1005FD880. Frame A's Z is the slide axis (a motor / spring
// and the limits along it), its X and Y the two perpendicular point rows; the three
// rotations are locked. -------------------------------------------------------------
// a quaternion's axis images (matrix columns), lane for lane as the client builds
// them: X = ((1 - yy) - zz, 2y x + 2z w, 2z x - 2y w) ...
function axes(q: Q, X: V3, Y: V3, Z: V3): void {
  const x2 = q.x + q.x;
  const y2 = q.y + q.y;
  const z2 = q.z + q.z;
  const xx = x2 * q.x;
  const yy = y2 * q.y;
  const zz = z2 * q.z;
  X.x = 1 - yy - zz;
  X.y = y2 * q.x + z2 * q.w;
  X.z = z2 * q.x - y2 * q.w;
  Y.x = y2 * q.x - z2 * q.w;
  Y.y = 1 - xx - zz;
  Y.z = z2 * q.y + x2 * q.w;
  Z.x = z2 * q.x + y2 * q.w;
  Z.y = z2 * q.y - x2 * q.w;
  Z.z = 1 - xx - yy;
}
// v through the axes X, Y, Z: v.z Z + (v.y Y + v.x X); o may be v
function matRot(o: V3, X: V3, Y: V3, Z: V3, v: V3): void {
  const x = v.x;
  const y = v.y;
  const z = v.z;
  o.x = Z.x * z + (Y.x * y + X.x * x);
  o.y = Z.y * z + (Y.y * y + X.y * x);
  o.z = Z.z * z + (Y.z * y + X.z * x);
}
const tuT = new Q();
// d (x) q for a pure d, summed as the position solve sums it
function turnOf(o: Q, q: Q, d: V3): void {
  o.x = -q.y * d.z + (q.z * d.y + q.w * d.x);
  o.y = q.x * d.z + (q.w * d.y + -q.z * d.x);
  o.z = q.w * d.z + (-q.x * d.y + q.y * d.x);
  o.w = -q.z * d.z + (-q.y * d.y + -q.x * d.x);
}
// q - 0.5 (d (x) q) for body A, 0.5 (d (x) q) + q for body B; exact renormalisation
function turnA(b: Body, d: V3): void {
  const q = b.q;
  turnOf(tuT, q, d);
  const x = q.x - tuT.x * 0.5;
  const y = q.y - tuT.y * 0.5;
  const z = q.z - tuT.z * 0.5;
  const w = q.w - tuT.w * 0.5;
  const n2 = x * x + y * y + (z * z + w * w);
  b.iwOk = false;
  if (!(n2 > kTiny)) {
    q.x = x;
    q.y = y;
    q.z = z;
    q.w = w;
    return;
  }
  const r = 1 / Math.sqrt(n2);
  const k = r * -0.5 * (n2 * r * r + -3);
  q.x = x * k;
  q.y = y * k;
  q.z = z * k;
  q.w = w * k;
}
function turnB(b: Body, d: V3): void {
  const q = b.q;
  turnOf(tuT, q, d);
  const x = tuT.x * 0.5 + q.x;
  const y = tuT.y * 0.5 + q.y;
  const z = tuT.z * 0.5 + q.z;
  const w = tuT.w * 0.5 + q.w;
  const n2 = x * x + y * y + (z * z + w * w);
  b.iwOk = false;
  if (!(n2 > kTiny)) {
    q.x = x;
    q.y = y;
    q.z = z;
    q.w = w;
    return;
  }
  const r = 1 / Math.sqrt(n2);
  const k = r * -0.5 * (n2 * r * r + -3);
  q.x = x * k;
  q.y = y * k;
  q.z = z * k;
  q.w = w * k;
}

const prRA = new V3();
const prRB = new V3();
const prD = new V3();
const prU = new V3();
const prIaA1 = new V3();
const prIbA2 = new V3();
const prIa1 = new V3();
const prIb1 = new V3();
const prIa2 = new V3();
const prIb2 = new V3();
const prWF = new Q();

function preparePrismatic(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  const ma = A.im;
  const mb = B.im;
  mulq(prWF, A.q, j.qa);
  axes(prWF, j.prPerp1, j.prPerp2, j.prAxis);
  tA.x = j.pa.x - A.lc.x;
  tA.y = j.pa.y - A.lc.y;
  tA.z = j.pa.z - A.lc.z;
  rot(prRA, A.q, tA);
  tA.x = j.pb.x - B.lc.x;
  tA.y = j.pb.y - B.lc.y;
  tA.z = j.pb.z - B.lc.z;
  rot(prRB, B.q, tA);
  prD.x = prRB.x - prRA.x + (B.c.x - A.c.x);
  prD.y = prRB.y - prRA.y + (B.c.y - A.c.y);
  prD.z = prRB.z - prRA.z + (B.c.z - A.c.z);
  const ax = j.prAxis;
  const trans = prD.z * ax.z + (prD.y * ax.y + prD.x * ax.x);
  prU.x = prD.x + prRA.x;
  prU.y = prD.y + prRA.y;
  prU.z = prD.z + prRA.z;
  // axial row: J = (-axis, -(d + rA) x axis, axis, rB x axis)
  cross(tA, prU, ax);
  j.prA1.x = tA.x * -1;
  j.prA1.y = tA.y * -1;
  j.prA1.z = tA.z * -1;
  cross(j.prA2, prRB, ax);
  mulm(prIaA1, iA, j.prA1);
  mulm(prIbA2, iB, j.prA2);
  const A1 = j.prA1;
  const A2 = j.prA2;
  const k =
    A1.z * prIaA1.z +
    (A1.y * prIaA1.y + A1.x * prIaA1.x) +
    (mb + ma) +
    (A2.z * prIbA2.z + (A2.y * prIbA2.y + A2.x * prIbA2.x));
  j.prAxMass = Math.abs(k) > kTiny ? 1 / k : 0;
  // motor (0x160): 1 = soft spring to the target (FLT_MAX), 0 = off, else a velocity
  // motor (speed -0x164, max 0x168)
  if (j.mode === 1) {
    const C = trans - j.prTarget;
    const om = j.hz * kPrisHz;
    const c = (j.zeta + j.zeta) * (om * j.prAxMass);
    const kk = om * om * j.prAxMass;
    const dd = (kk * st.h + c) * st.h;
    let g = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      g = (1 - dd * r) * r + r;
    }
    j.m1Gamma = g;
    j.m1Bias = st.h * g * (kk * C);
    const km = g + k;
    j.m1Mass = Math.abs(km) > kTiny ? 1 / km : 0;
    j.m1Max = kFltMax;
  } else if (j.mode !== 0) {
    j.m1Mass = j.prAxMass;
    j.m1Bias = -j.prSpeed;
    j.m1Gamma = 0;
    j.m1Max = j.maxT;
  } else {
    j.m1Mass = 0;
    j.m1Bias = 0;
    j.m1Gamma = 0;
    j.m1Max = 0;
    j.Pmot1 = 0;
  }
  // limit state (0x1B8): a range under 0.01 locks; otherwise the impulse resets
  // whenever the state changes, and always inside the range
  if (j.limState !== 0) {
    if (Math.abs(j.prUpper - j.prLower) < kPrisLock) {
      j.limState = 4;
    } else if (trans <= j.prLower) {
      if (j.limState !== 2) {
        j.limState = 2;
        j.Plim = 0;
      }
    } else if (trans < j.prUpper) {
      j.limState = 1;
      j.Plim = 0;
    } else if (j.limState !== 3) {
      j.limState = 3;
      j.Plim = 0;
    }
  } else {
    j.Plim = 0;
  }
  // angular lock: (iA + iB)^-1, exact divide
  addM3(mA, iA, iB);
  inverse(j.prKang, mA);
  // perpendicular rows: J_i = (-p_i, -(d + rA) x p_i, p_i, rB x p_i)
  cross(tA, prU, j.prPerp1);
  j.prS1A.x = tA.x * -1;
  j.prS1A.y = tA.y * -1;
  j.prS1A.z = tA.z * -1;
  cross(j.prS1B, prRB, j.prPerp1);
  cross(tA, prU, j.prPerp2);
  j.prS2A.x = tA.x * -1;
  j.prS2A.y = tA.y * -1;
  j.prS2A.z = tA.z * -1;
  cross(j.prS2B, prRB, j.prPerp2);
  mulm(prIa1, iA, j.prS1A);
  mulm(prIb1, iB, j.prS1B);
  mulm(prIa2, iA, j.prS2A);
  mulm(prIb2, iB, j.prS2B);
  const S1A = j.prS1A;
  const S1B = j.prS1B;
  const S2A = j.prS2A;
  const S2B = j.prS2B;
  const k11 =
    prIa1.z * S1A.z +
    (prIa1.y * S1A.y + prIa1.x * S1A.x) +
    (mb + ma) +
    (prIb1.z * S1B.z + (prIb1.y * S1B.y + prIb1.x * S1B.x));
  const k12 =
    S1B.z * prIb2.z +
    (S1B.y * prIb2.y + S1B.x * prIb2.x) +
    (S1A.z * prIa2.z + (S1A.y * prIa2.y + S1A.x * prIa2.x));
  const k22 =
    S2A.z * prIa2.z +
    (S2A.y * prIa2.y + S2A.x * prIa2.x) +
    (mb + ma) +
    (S2B.z * prIb2.z + (S2B.y * prIb2.y + S2B.x * prIb2.x));
  const dd2 = k22 * k11 - k12 * k12;
  let inv = 0;
  if (Math.abs(dd2) > kTiny) {
    const r = 1 / dd2;
    inv = (1 - dd2 * r) * r + r;
  }
  j.prK0 = k22 * inv;
  j.prK1 = -inv * k12;
  j.prK2 = inv * k11;
  if (st.warm) {
    const ratio = st.dtRatio;
    j.Plin.x = j.Plin.x * ratio;
    j.Plin.y = j.Plin.y * ratio;
    j.Plin.z = j.Plin.z * ratio;
    j.Pang.x = j.Pang.x * ratio;
    j.Pang.y = j.Pang.y * ratio;
    j.Pang.z = j.Pang.z * ratio;
    j.Plim = j.Plim * ratio;
    j.Pmot1 = ratio * j.Pmot1;
    const axi = j.Pmot1 + j.Plim;
    const Px = ax.x * axi;
    const Py = ax.y * axi;
    const Pz = ax.z * axi;
    const lx = j.Plin.x;
    const ly = j.Plin.y;
    const Ppx = j.prPerp2.x * ly + j.prPerp1.x * lx;
    const Ppy = j.prPerp2.y * ly + j.prPerp1.y * lx;
    const Ppz = j.prPerp2.z * ly + j.prPerp1.z * lx;
    if (A.type === kBodyDynamic) {
      A.v.x = A.v.x - Px * ma;
      A.v.y = A.v.y - Py * ma;
      A.v.z = A.v.z - Pz * ma;
      A.w.x = A.w.x + prIaA1.x * axi;
      A.w.y = A.w.y + prIaA1.y * axi;
      A.w.z = A.w.z + prIaA1.z * axi;
      mulm(tA, iA, j.Pang);
      A.w.x = A.w.x - tA.x;
      A.w.y = A.w.y - tA.y;
      A.w.z = A.w.z - tA.z;
      A.v.x = A.v.x - Ppx * ma;
      A.v.y = A.v.y - Ppy * ma;
      A.v.z = A.v.z - Ppz * ma;
      A.w.x = prIa2.x * ly + prIa1.x * lx + A.w.x;
      A.w.y = prIa2.y * ly + prIa1.y * lx + A.w.y;
      A.w.z = prIa2.z * ly + prIa1.z * lx + A.w.z;
    }
    if (B.type === kBodyDynamic) {
      B.v.x = Px * mb + B.v.x;
      B.v.y = Py * mb + B.v.y;
      B.v.z = Pz * mb + B.v.z;
      B.w.x = prIbA2.x * axi + B.w.x;
      B.w.y = prIbA2.y * axi + B.w.y;
      B.w.z = prIbA2.z * axi + B.w.z;
      mulm(tA, iB, j.Pang);
      B.w.x = tA.x + B.w.x;
      B.w.y = tA.y + B.w.y;
      B.w.z = tA.z + B.w.z;
      B.v.x = Ppx * mb + B.v.x;
      B.v.y = Ppy * mb + B.v.y;
      B.v.z = Ppz * mb + B.v.z;
      B.w.x = prIb2.x * ly + prIb1.x * lx + B.w.x;
      B.w.y = prIb2.y * ly + prIb1.y * lx + B.w.y;
      B.w.z = prIb2.z * ly + prIb1.z * lx + B.w.z;
    }
  } else {
    zeroV(j.Plin);
    zeroV(j.Pang);
    j.Plim = 0;
    j.Pmot1 = 0;
  }
}

const vaIa = new V3();
const vaIb = new V3();
const vpVA = new V3();
const vpWA = new V3();
const vpVB = new V3();
const vpWB = new V3();

function velPrismatic(w: World, j: Joint, st: StepData): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const iA = iwOf(A);
  const iB = iwOf(B);
  const ma = A.im;
  const mb = B.im;
  mulm(vaIa, iA, j.prA1);
  mulm(vaIb, iB, j.prA2);
  copyV(vpVA, A.v);
  copyV(vpWA, A.w);
  copyV(vpVB, B.v);
  copyV(vpWB, B.w);
  const ax = j.prAxis;
  const A1 = j.prA1;
  const A2 = j.prA2;
  // motor (always solved; off = zero mass and zero bound)
  {
    const a =
      A1.z * vpWA.z +
      (A1.y * vpWA.y + A1.x * vpWA.x) +
      (ax.z * (vpVB.z - vpVA.z) + (ax.y * (vpVB.y - vpVA.y) + ax.x * (vpVB.x - vpVA.x))) +
      (A2.z * vpWB.z + (A2.y * vpWB.y + A2.x * vpWB.x));
    const cd = j.m1Gamma * j.Pmot1 + j.m1Bias + a;
    const mx = st.h * j.m1Max;
    const s = cd * -j.m1Mass + j.Pmot1;
    const mn = mx < s ? mx : s;
    const np = mn < -mx ? -mx : mn;
    const l = np - j.Pmot1;
    j.Pmot1 = np;
    const Px = ax.x * l;
    const Py = ax.y * l;
    const Pz = ax.z * l;
    vpVA.x = vpVA.x - Px * ma;
    vpVA.y = vpVA.y - Py * ma;
    vpVA.z = vpVA.z - Pz * ma;
    vpVB.x = Px * mb + vpVB.x;
    vpVB.y = Py * mb + vpVB.y;
    vpVB.z = Pz * mb + vpVB.z;
    vpWA.x = vaIa.x * l + vpWA.x;
    vpWA.y = vaIa.y * l + vpWA.y;
    vpWA.z = vaIa.z * l + vpWA.z;
    vpWB.x = vaIb.x * l + vpWB.x;
    vpWB.y = vaIb.y * l + vpWB.y;
    vpWB.z = vaIb.z * l + vpWB.z;
  }
  // limit: 2 lower (>= 0), 3 upper (<= 0), 4 locked (free)
  if (j.limState >= 2) {
    const a =
      A1.z * vpWA.z +
      (A1.y * vpWA.y + A1.x * vpWA.x) +
      (ax.z * (vpVB.z - vpVA.z) + (ax.y * (vpVB.y - vpVA.y) + ax.x * (vpVB.x - vpVA.x))) +
      (A2.z * vpWB.z + (A2.y * vpWB.y + A2.x * vpWB.x));
    let l = -j.prAxMass * a;
    let P = j.Plim;
    if (j.limState === 2) {
      const s = l + P;
      const n = 0 < s ? s : 0;
      l = n - P;
      P = n;
    } else if (j.limState === 3) {
      const s = l + P;
      const n = s < 0 ? s : 0;
      l = n - P;
      P = n;
    } else if (j.limState === 4) {
      P = P + l;
    }
    j.Plim = P;
    const Px = ax.x * l;
    const Py = ax.y * l;
    const Pz = ax.z * l;
    vpVA.x = vpVA.x - Px * ma;
    vpVA.y = vpVA.y - Py * ma;
    vpVA.z = vpVA.z - Pz * ma;
    vpVB.x = Px * mb + vpVB.x;
    vpVB.y = Py * mb + vpVB.y;
    vpVB.z = Pz * mb + vpVB.z;
    vpWA.x = vaIa.x * l + vpWA.x;
    vpWA.y = vaIa.y * l + vpWA.y;
    vpWA.z = vaIa.z * l + vpWA.z;
    vpWB.x = vaIb.x * l + vpWB.x;
    vpWB.y = vaIb.y * l + vpWB.y;
    vpWB.z = vaIb.z * l + vpWB.z;
  }
  // angular lock (3 rows): L = (iA + iB)^-1 (wA - wB)
  {
    tA.x = vpWA.x - vpWB.x;
    tA.y = vpWA.y - vpWB.y;
    tA.z = vpWA.z - vpWB.z;
    mulm(tA, j.prKang, tA);
    j.Pang.x = j.Pang.x + tA.x;
    j.Pang.y = j.Pang.y + tA.y;
    j.Pang.z = j.Pang.z + tA.z;
    mulm(tB, iA, tA);
    vpWA.x = vpWA.x - tB.x;
    vpWA.y = vpWA.y - tB.y;
    vpWA.z = vpWA.z - tB.z;
    mulm(tB, iB, tA);
    vpWB.x = tB.x + vpWB.x;
    vpWB.y = tB.y + vpWB.y;
    vpWB.z = tB.z + vpWB.z;
  }
  // perpendicular (2 rows)
  {
    const dvx = vpVB.x - vpVA.x;
    const dvy = vpVB.y - vpVA.y;
    const dvz = vpVB.z - vpVA.z;
    const S1A = j.prS1A;
    const S1B = j.prS1B;
    const S2A = j.prS2A;
    const S2B = j.prS2B;
    const p1 = j.prPerp1;
    const p2 = j.prPerp2;
    const c1 =
      S1A.z * vpWA.z +
      (S1A.y * vpWA.y + S1A.x * vpWA.x) +
      (p1.z * dvz + (p1.y * dvy + p1.x * dvx)) +
      (S1B.z * vpWB.z + (S1B.y * vpWB.y + S1B.x * vpWB.x));
    const c2 =
      S2A.z * vpWA.z +
      (S2A.y * vpWA.y + S2A.x * vpWA.x) +
      (p2.z * dvz + (p2.y * dvy + p2.x * dvx)) +
      (S2B.z * vpWB.z + (S2B.y * vpWB.y + S2B.x * vpWB.x));
    const l1 = c2 * j.prK1 + c1 * j.prK0;
    const l2 = j.prK2 * c2 + j.prK1 * c1;
    j.Plin.x -= l1;
    j.Plin.y -= l2;
    const nl2 = -l2;
    const Px = p2.x * nl2 - p1.x * l1;
    const Py = p2.y * nl2 - p1.y * l1;
    const Pz = p2.z * nl2 - p1.z * l1;
    vpVA.x = vpVA.x - Px * ma;
    vpVA.y = vpVA.y - Py * ma;
    vpVA.z = vpVA.z - Pz * ma;
    mulm(tA, iA, S1A);
    mulm(tB, iA, S2A);
    vpWA.x = vpWA.x - tA.x * l1 - tB.x * l2;
    vpWA.y = vpWA.y - tA.y * l1 - tB.y * l2;
    vpWA.z = vpWA.z - tA.z * l1 - tB.z * l2;
    vpVB.x = Px * mb + vpVB.x;
    vpVB.y = Py * mb + vpVB.y;
    vpVB.z = Pz * mb + vpVB.z;
    mulm(tA, iB, S1B);
    mulm(tB, iB, S2B);
    vpWB.x = vpWB.x - tA.x * l1 - tB.x * l2;
    vpWB.y = vpWB.y - tA.y * l1 - tB.y * l2;
    vpWB.z = vpWB.z - tA.z * l1 - tB.z * l2;
  }
  if (A.type === kBodyDynamic) {
    copyV(A.v, vpVA);
    copyV(A.w, vpWA);
  }
  if (B.type === kBodyDynamic) {
    copyV(B.v, vpVB);
    copyV(B.w, vpWB);
  }
}

const psXl = new V3();
const psYl = new V3();
const psZl = new V3();
const psXA = new V3();
const psYA = new V3();
const psZA = new V3();
const psXB = new V3();
const psYB = new V3();
const psZB = new V3();
const psP1 = new V3();
const psP2 = new V3();
const psE = new Q();

function posPrismatic(w: World, j: Joint): void {
  const A = w.bodies[j.a]!;
  const B = w.bodies[j.b]!;
  const dA = A.type === kBodyDynamic;
  const dB = B.type === kBodyDynamic;
  const ma = A.im;
  const mb = B.im;
  axes(j.qa, psXl, psYl, psZl); // frame A in body A
  // limit along the axis: slop 0.005, at most 0.25 a pass, beta 0.2; the rotations
  // are renormalised even inside the range
  if (j.limState !== 0) {
    const iA = iwOf(A);
    const iB = iwOf(B);
    axes(A.q, psXA, psYA, psZA);
    axes(B.q, psXB, psYB, psZB);
    tA.x = j.pa.x - A.lc.x;
    tA.y = j.pa.y - A.lc.y;
    tA.z = j.pa.z - A.lc.z;
    matRot(prRA, psXA, psYA, psZA, tA);
    tA.x = j.pb.x - B.lc.x;
    tA.y = j.pb.y - B.lc.y;
    tA.z = j.pb.z - B.lc.z;
    matRot(prRB, psXB, psYB, psZB, tA);
    prD.x = prRB.x - prRA.x + (B.c.x - A.c.x);
    prD.y = prRB.y - prRA.y + (B.c.y - A.c.y);
    prD.z = prRB.z - prRA.z + (B.c.z - A.c.z);
    // axis = ZA Zl.z + (YA Zl.y + XA Zl.x)
    tB.x = psZA.x * psZl.z + (psYA.x * psZl.y + psXA.x * psZl.x);
    tB.y = psZA.y * psZl.z + (psYA.y * psZl.y + psXA.y * psZl.x);
    tB.z = psZA.z * psZl.z + (psYA.z * psZl.y + psXA.z * psZl.x);
    tC.x = prRA.x + prD.x;
    tC.y = prRA.y + prD.y;
    tC.z = prRA.z + prD.z;
    cross(tC, tC, tB); // cA
    cross(tD, prRB, tB); // cB
    mulm(tE, iA, tC);
    mulm(tF, iB, tD);
    const k =
      tC.z * tE.z +
      (tC.y * tE.y + tC.x * tE.x) +
      ma +
      (tD.z * tF.z + (tD.y * tF.y + tD.x * tF.x)) +
      mb;
    const mass = Math.abs(k) > kTiny ? 1 / k : 0;
    const C = prD.z * tB.z + (prD.y * tB.y + prD.x * tB.x);
    let Cc: number;
    if (j.limState === 4) {
      const m = 0.25 < C ? 0.25 : C;
      Cc = m < -0.25 ? -0.25 : m;
    } else if (j.prLower < C) {
      if (C < j.prUpper) {
        Cc = 0;
      } else {
        const s = -k0005 - j.prUpper + C;
        const m = 0.25 < s ? 0.25 : s;
        Cc = 0 < m ? m : 0;
      }
    } else {
      const s = k0005 - j.prLower + C;
      const m = s < 0 ? s : 0;
      Cc = m < -0.25 ? -0.25 : m;
    }
    const imp = mass * -k02 * Cc;
    const Px = tB.x * imp;
    const Py = tB.y * imp;
    const Pz = tB.z * imp;
    if (dA) {
      A.c.x = A.c.x - Px * ma;
      A.c.y = A.c.y - Py * ma;
      A.c.z = A.c.z - Pz * ma;
      tE.x = tE.x * imp;
      tE.y = tE.y * imp;
      tE.z = tE.z * imp;
      turnA(A, tE);
    }
    if (dB) {
      B.c.x = Px * mb + B.c.x;
      B.c.y = Py * mb + B.c.y;
      B.c.z = Pz * mb + B.c.z;
      tF.x = tF.x * imp;
      tF.y = tF.y * imp;
      tF.z = tF.z * imp;
      turnB(B, tF);
    }
  }
  // angular lock, full correction: C = Rot(wfA, 2 vec((1 - rel) (x) conj(rel))) on
  // the short arc, P = (iA + iB)^-1 C (1 / det by rcp + Newton)
  {
    const iA = iwOf(A);
    const iB = iwOf(B);
    mulq(wfA, A.q, j.qa);
    mulq(wfB, B.q, j.qb);
    mulConjQ(relQ, wfA, wfB);
    if (relQ.w < 0) {
      relQ.x = -relQ.x;
      relQ.y = -relQ.y;
      relQ.z = -relQ.z;
      relQ.w = -relQ.w;
    }
    // e = (-rel.xyz, 1 - rel.w) (x) (-rel.xyz, rel.w)
    tuQA.x = -relQ.x;
    tuQA.y = -relQ.y;
    tuQA.z = -relQ.z;
    tuQA.w = 1 - relQ.w;
    tuQB.x = -relQ.x;
    tuQB.y = -relQ.y;
    tuQB.z = -relQ.z;
    tuQB.w = relQ.w;
    mulq(psE, tuQA, tuQB);
    tA.x = psE.x * 2;
    tA.y = psE.y * 2;
    tA.z = psE.z * 2;
    rot(tA, wfA, tA);
    addM3(mA, iA, iB);
    inverseFast(mB, mA);
    mulm(tB, mB, tA);
    if (dA) {
      mulm(tC, iA, tB);
      turnA(A, tC);
    }
    if (dB) {
      mulm(tC, iB, tB);
      turnB(B, tC);
    }
  }
  // perpendicular rows, full correction (1 / det by rcp + Newton)
  {
    const iA = iwOf(A);
    const iB = iwOf(B);
    axes(A.q, psXA, psYA, psZA);
    axes(B.q, psXB, psYB, psZB);
    tA.x = j.pa.x - A.lc.x;
    tA.y = j.pa.y - A.lc.y;
    tA.z = j.pa.z - A.lc.z;
    matRot(prRA, psXA, psYA, psZA, tA);
    tA.x = j.pb.x - B.lc.x;
    tA.y = j.pb.y - B.lc.y;
    tA.z = j.pb.z - B.lc.z;
    matRot(prRB, psXB, psYB, psZB, tA);
    psP1.x = psZA.x * psXl.z + psXA.x * psXl.x + psYA.x * psXl.y;
    psP1.y = psZA.y * psXl.z + psXA.y * psXl.x + psYA.y * psXl.y;
    psP1.z = psZA.z * psXl.z + psXA.z * psXl.x + psYA.z * psXl.y;
    psP2.x = psZA.x * psYl.z + psXA.x * psYl.x + psYA.x * psYl.y;
    psP2.y = psZA.y * psYl.z + psXA.y * psYl.x + psYA.y * psYl.y;
    psP2.z = psZA.z * psYl.z + psXA.z * psYl.x + psYA.z * psYl.y;
    prD.x = prRB.x - prRA.x + (B.c.x - A.c.x);
    prD.y = prRB.y - prRA.y + (B.c.y - A.c.y);
    prD.z = prRB.z - prRA.z + (B.c.z - A.c.z);
    prU.x = prRA.x + prD.x;
    prU.y = prRA.y + prD.y;
    prU.z = prRA.z + prD.z;
    cross(tA, prU, psP1);
    tA.x = tA.x * -1;
    tA.y = tA.y * -1;
    tA.z = tA.z * -1; // s1A
    cross(tB, prU, psP2);
    tB.x = tB.x * -1;
    tB.y = tB.y * -1;
    tB.z = tB.z * -1; // s2A
    cross(tC, prRB, psP1); // s1B
    cross(tD, prRB, psP2); // s2B
    mulm(tE, iA, tA); // ia1
    mulm(tF, iA, tB); // ia2
    mulm(tG, iB, tC); // ib1
    mulm(tH, iB, tD); // ib2
    const C1 = prD.z * psP1.z + (prD.y * psP1.y + prD.x * psP1.x);
    const C2 = prD.z * psP2.z + (prD.y * psP2.y + prD.x * psP2.x);
    const k11 =
      tE.z * tA.z +
      (tE.y * tA.y + tE.x * tA.x) +
      (mb + ma) +
      (tG.z * tC.z + (tG.y * tC.y + tG.x * tC.x));
    const k22 =
      tB.z * tF.z +
      (tB.y * tF.y + tB.x * tF.x) +
      (mb + ma) +
      (tD.z * tH.z + (tD.y * tH.y + tD.x * tH.x));
    const k12 =
      tC.z * tH.z +
      (tC.y * tH.y + tC.x * tH.x) +
      (tA.z * tF.z + (tA.y * tF.y + tA.x * tF.x));
    const dd = k22 * k11 - k12 * k12;
    let inv = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      inv = (1 - dd * r) * r + r;
    }
    const off = -inv * k12;
    const l1 = C2 * off + k22 * C1 * inv;
    const l2n = -(k11 * C2 * inv + off * C1);
    const Px = psP2.x * l2n - psP1.x * l1;
    const Py = psP2.y * l2n - psP1.y * l1;
    const Pz = psP2.z * l2n - psP1.z * l1;
    if (dA) {
      A.c.x = A.c.x - Px * ma;
      A.c.y = A.c.y - Py * ma;
      A.c.z = A.c.z - Pz * ma;
      tI.x = tF.x * l2n - tE.x * l1;
      tI.y = tF.y * l2n - tE.y * l1;
      tI.z = tF.z * l2n - tE.z * l1;
      turnB(A, tI);
    }
    if (dB) {
      B.c.x = Px * mb + B.c.x;
      B.c.y = Py * mb + B.c.y;
      B.c.z = Pz * mb + B.c.z;
      tI.x = tH.x * l2n - tG.x * l1;
      tI.y = tH.y * l2n - tG.y * l1;
      tI.z = tH.z * l2n - tG.z * l1;
      turnB(B, tI);
    }
  }
  syncOrigin(A);
  syncOrigin(B);
}
const tuQA = new Q();
const tuQB = new Q();

// --- proxies --------------------------------------------------------------------
// A body's transform as the client builds it from the rotation for a box
// (0x1005E8BF0 / 0x1005E8FE0): the rotation's columns, each lane by the client's
// shuffles - (1 - 2y^2) - 2z^2, 2yx + 2zw, ... - and the origin.
class Xf {
  c0 = new V3();
  c1 = new V3();
  c2 = new V3();
  t = new V3();
}
function xfOf(f: Xf, q: Q): void {
  const x2 = q.x + q.x;
  const y2 = q.y + q.y;
  const z2 = q.z + q.z;
  const xx = x2 * q.x;
  const yy = y2 * q.y;
  const zz = z2 * q.z;
  const zx = z2 * q.x;
  const yx = y2 * q.x;
  const zy = z2 * q.y;
  const yw = y2 * q.w;
  const zw = z2 * q.w;
  const xw = x2 * q.w;
  f.c0.x = 1 - yy - zz;
  f.c0.y = yx + zw;
  f.c0.z = zx - yw;
  f.c1.x = yx - zw;
  f.c1.y = 1 - xx - zz;
  f.c1.z = zy + xw;
  f.c2.x = zx + yw;
  f.c2.y = zy - xw;
  f.c2.z = 1 - xx - yy;
}
// a capsule end: (c2 z + c1 y) + (c0 x + t) (0x1005E1710 / 0x1005E17A0)
function xfPoint(o: V3, f: Xf, p: V3): void {
  const x = p.x;
  const y = p.y;
  const z = p.z;
  o.x = f.c2.x * z + f.c1.x * y + (f.c0.x * x + f.t.x);
  o.y = f.c2.y * z + f.c1.y * y + (f.c0.y * x + f.t.y);
  o.z = f.c2.z * z + f.c1.z * y + (f.c0.z * x + f.t.z);
}
// a hull vertex for the box at one place, before the origin: c2 z + (c1 y + c0 x)
// (0x1005DD340)
function xfRot(o: V3, f: Xf, p: V3): void {
  const x = p.x;
  const y = p.y;
  const z = p.z;
  o.x = f.c2.x * z + (f.c1.x * y + f.c0.x * x);
  o.y = f.c2.y * z + (f.c1.y * y + f.c0.y * x);
  o.z = f.c2.z * z + (f.c1.z * y + f.c0.z * x);
}

const xf1 = new Xf();
const xf2 = new Xf();
const bxP = new V3();
const bxQ = new V3();
const bxA = new V3();
const bxB = new V3();

// 0x1005F1900: at the body's place
function shapeBox(w: World, s: Shape): void {
  const b = w.bodies[s.body]!;
  const f = xf1;
  xfOf(f, b.q);
  copyV(f.t, b.x);
  if (s.type === kShapeHull) {
    // 0x1005DD340: vertices two at a time, the box grown by the hull radius, then
    // the origin added
    let lx = +kFltMax;
    let ly = +kFltMax;
    let lz = +kFltMax;
    let hx = -kFltMax;
    let hy = -kFltMax;
    let hz = -kFltMax;
    const v = s.hull.v;
    if (v.length === 0) {
      s.boxLo.x = lx;
      s.boxLo.y = ly;
      s.boxLo.z = lz;
      s.boxHi.x = hx;
      s.boxHi.y = hy;
      s.boxHi.z = hz;
      return;
    }
    let k = 0;
    for (; k + 1 < v.length; k += 2) {
      xfRot(bxP, f, v[k]!);
      // l1 = MinV(lo, p), h1 = MaxV(p, hi)
      const l1x = lx < bxP.x ? lx : bxP.x;
      const l1y = ly < bxP.y ? ly : bxP.y;
      const l1z = lz < bxP.z ? lz : bxP.z;
      const h1x = bxP.x > hx ? bxP.x : hx;
      const h1y = bxP.y > hy ? bxP.y : hy;
      const h1z = bxP.z > hz ? bxP.z : hz;
      xfRot(bxQ, f, v[k + 1]!);
      // lo = MinV(l1, q), hi = MaxV(q, h1)
      lx = l1x < bxQ.x ? l1x : bxQ.x;
      ly = l1y < bxQ.y ? l1y : bxQ.y;
      lz = l1z < bxQ.z ? l1z : bxQ.z;
      hx = bxQ.x > h1x ? bxQ.x : h1x;
      hy = bxQ.y > h1y ? bxQ.y : h1y;
      hz = bxQ.z > h1z ? bxQ.z : h1z;
    }
    if (k < v.length) {
      xfRot(bxP, f, v[k]!);
      lx = lx < bxP.x ? lx : bxP.x;
      ly = ly < bxP.y ? ly : bxP.y;
      lz = lz < bxP.z ? lz : bxP.z;
      hx = hx > bxP.x ? hx : bxP.x;
      hy = hy > bxP.y ? hy : bxP.y;
      hz = hz > bxP.z ? hz : bxP.z;
    }
    s.boxLo.x = lx + -kHullRadius + f.t.x;
    s.boxLo.y = ly + -kHullRadius + f.t.y;
    s.boxLo.z = lz + -kHullRadius + f.t.z;
    s.boxHi.x = hx + kHullRadius + f.t.x;
    s.boxHi.y = hy + kHullRadius + f.t.y;
    s.boxHi.z = hz + kHullRadius + f.t.z;
    return;
  }
  // 0x1005E1710: the two ends, then the radius
  xfPoint(bxP, f, s.a);
  xfPoint(bxQ, f, s.type === kShapeCapsule ? s.b : s.a);
  const r = s.r;
  s.boxLo.x = (bxP.x < bxQ.x ? bxP.x : bxQ.x) - r;
  s.boxLo.y = (bxP.y < bxQ.y ? bxP.y : bxQ.y) - r;
  s.boxLo.z = (bxP.z < bxQ.z ? bxP.z : bxQ.z) - r;
  s.boxHi.x = r + (bxQ.x > bxP.x ? bxQ.x : bxP.x);
  s.boxHi.y = r + (bxQ.y > bxP.y ? bxQ.y : bxP.y);
  s.boxHi.z = r + (bxQ.z > bxP.z ? bxQ.z : bxP.z);
}

const sbT = new V3();
// 0x1005F1A30: over the step, sweep start to now
function sweptBox(w: World, s: Shape): void {
  const b = w.bodies[s.body]!;
  const f1 = xf1;
  const f2 = xf2;
  rot(sbT, b.q0, b.lc);
  xfOf(f1, b.q0); // 0x1005E8FE0: where the step began
  f1.t.x = b.c0.x - sbT.x;
  f1.t.y = b.c0.y - sbT.y;
  f1.t.z = b.c0.z - sbT.z;
  xfOf(f2, b.q);
  copyV(f2.t, b.x);
  if (s.type === kShapeHull) {
    // 0x1005DD450: every vertex at both places, then the hull radius
    let lx = +kFltMax;
    let ly = +kFltMax;
    let lz = +kFltMax;
    let hx = -kFltMax;
    let hy = -kFltMax;
    let hz = -kFltMax;
    const v = s.hull.v;
    for (let k = 0; k < v.length; k++) {
      xfPoint(bxP, f1, v[k]!);
      xfPoint(bxQ, f2, v[k]!);
      // lo = MinV(MinV(lo, p1), p2), hi = MaxV(MaxV(hi, p1), p2)
      const l1x = lx < bxP.x ? lx : bxP.x;
      const l1y = ly < bxP.y ? ly : bxP.y;
      const l1z = lz < bxP.z ? lz : bxP.z;
      lx = l1x < bxQ.x ? l1x : bxQ.x;
      ly = l1y < bxQ.y ? l1y : bxQ.y;
      lz = l1z < bxQ.z ? l1z : bxQ.z;
      const h1x = hx > bxP.x ? hx : bxP.x;
      const h1y = hy > bxP.y ? hy : bxP.y;
      const h1z = hz > bxP.z ? hz : bxP.z;
      hx = h1x > bxQ.x ? h1x : bxQ.x;
      hy = h1y > bxQ.y ? h1y : bxQ.y;
      hz = h1z > bxQ.z ? h1z : bxQ.z;
    }
    if (v.length === 0) {
      s.boxLo.x = lx;
      s.boxLo.y = ly;
      s.boxLo.z = lz;
      s.boxHi.x = hx;
      s.boxHi.y = hy;
      s.boxHi.z = hz;
      return;
    }
    s.boxLo.x = lx + -kHullRadius;
    s.boxLo.y = ly + -kHullRadius;
    s.boxLo.z = lz + -kHullRadius;
    s.boxHi.x = hx + kHullRadius;
    s.boxHi.y = hy + kHullRadius;
    s.boxHi.z = hz + kHullRadius;
    return;
  }
  // 0x1005E17A0: both ends at both places
  const eb = s.type === kShapeCapsule ? s.b : s.a;
  xfPoint(bxP, f1, s.a); // a1
  xfPoint(bxQ, f1, eb); // b1
  xfPoint(bxA, f2, s.a); // a2
  xfPoint(bxB, f2, eb); // b2
  const r = s.r;
  // MinV(MinV(a2, b2), MinV(a1, b1)) - r
  {
    const m1x = bxA.x < bxB.x ? bxA.x : bxB.x;
    const m1y = bxA.y < bxB.y ? bxA.y : bxB.y;
    const m1z = bxA.z < bxB.z ? bxA.z : bxB.z;
    const m2x = bxP.x < bxQ.x ? bxP.x : bxQ.x;
    const m2y = bxP.y < bxQ.y ? bxP.y : bxQ.y;
    const m2z = bxP.z < bxQ.z ? bxP.z : bxQ.z;
    s.boxLo.x = (m1x < m2x ? m1x : m2x) - r;
    s.boxLo.y = (m1y < m2y ? m1y : m2y) - r;
    s.boxLo.z = (m1z < m2z ? m1z : m2z) - r;
  }
  // r + MaxV(MaxV(b2, a2), MaxV(b1, a1))
  {
    const m1x = bxB.x > bxA.x ? bxB.x : bxA.x;
    const m1y = bxB.y > bxA.y ? bxB.y : bxA.y;
    const m1z = bxB.z > bxA.z ? bxB.z : bxA.z;
    const m2x = bxQ.x > bxP.x ? bxQ.x : bxP.x;
    const m2y = bxQ.y > bxP.y ? bxQ.y : bxP.y;
    const m2z = bxQ.z > bxP.z ? bxQ.z : bxP.z;
    s.boxHi.x = r + (m1x > m2x ? m1x : m2x);
    s.boxHi.y = r + (m1y > m2y ? m1y : m2y);
    s.boxHi.z = r + (m1z > m2z ? m1z : m2z);
  }
}

function fatBox(w: World, p: ShapeProxy): void {
  if (p.node < 0) return;
  const nd = w.trees[p.key & 3]!.n[p.node]!;
  p.lo.x = nd.lx;
  p.lo.y = nd.ly;
  p.lo.z = nd.lz;
  p.hi.x = nd.hx;
  p.hi.y = nd.hy;
  p.hi.z = nd.hz;
}

// a shape's proxy into its body type's tree (0x1005E7F50 -> 0x1005CC930), made with
// its shape (-> 0x1005F18B0): the tight box grown by the margin (shape + 128, 0.1
// for every shape of ours)
export function addProxy(w: World, shape: number): void {
  const s = w.shapes[shape]!;
  const bt = w.bodies[s.body]!.type;
  const tree = bt === kBodyDynamic ? 2 : bt === kBodyKinematic ? 1 : 0;
  shapeBox(w, s); // 0x1005F18B0 -> 0x1005F1900
  const p = w.proxies[shape]!;
  p.node = w.trees[tree]!.create(s.boxLo, s.boxHi);
  p.key = (p.node << 2) | tree;
  fatBox(w, p);
  p.moved = true;
  w.anyMoved = true;
}

// destroyed (0x1005CC9E0 -> 0x1005D3060): the leaf leaves the tree, freeing the
// parent it has NOW, then the leaf's own node
export function freeProxy(w: World, shape: number): void {
  const p = w.proxies[shape]!;
  w.trees[p.key & 3]!.destroy(p.node);
}

// 0x1005D3280: refit a proxy when its tight box left the fat one, or the fat one is
// larger than the tight one grown by 4 margins
export function refitProxy(w: World, i: number): boolean {
  const s = w.shapes[i]!;
  const p = w.proxies[i]!;
  if (!w.trees[p.key & 3]!.move(p.node, s.boxLo, s.boxHi)) return false;
  fatBox(w, p);
  p.moved = true; // 0x1005CCA40: the key joins the move buffer
  w.anyMoved = true;
  return true;
}

// 0x1005E8970 (body, off): each shape newest first loses its contacts (0x1005F1C40)
// and its proxy (0x1005F19F0); the body leaves the awake list. Its velocities stay
// (the sleep call after it sees a disabled body).
const onList = new IntVec();
function contactsOfShapeNewestFirst(w: World, s: number): void {
  onList.n = 0;
  const contacts = w.contacts;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]!;
    if (c.live && (c.sa === s || c.sb === s)) onList.push(i);
  }
  sortBySeqDesc(contacts, onList);
}
function sortBySeqDesc(contacts: Contact[], v: IntVec): void {
  const a = v.a;
  for (let i = 1; i < v.n; i++) {
    const x = a[i]!;
    const sx = contacts[x]!.seq;
    let k = i - 1;
    while (k >= 0 && contacts[a[k]!]!.seq < sx) {
      a[k + 1] = a[k]!;
      k--;
    }
    a[k + 1] = x;
  }
}

export function disableBody(w: World, b: number): void {
  const B = w.bodies[b]!;
  if (!B.enabled) return;
  B.enabled = false;
  for (let k = B.shapes.length - 1; k >= 0; k--) {
    const s = B.shapes[k]!;
    contactsOfShapeNewestFirst(w, s);
    for (let i = 0; i < onList.n; i++) freeContact(w, onList.a[i]!);
    freeProxy(w, s);
    w.proxies[s]!.node = -1;
  }
  const aw = w.awake;
  let n = 0;
  for (let i = 0; i < aw.n; i++) {
    const x = aw.a[i]!;
    if (x !== b) aw.a[n++] = x;
  }
  aw.n = n;
}

// (body, on): each shape newest first gets a proxy at the body's place now, new
// pairs are asked for (world + 0x540), the body rejoins the awake list
export function enableBody(w: World, b: number): void {
  const B = w.bodies[b]!;
  if (B.enabled) return;
  B.enabled = true;
  for (let k = B.shapes.length - 1; k >= 0; k--) addProxy(w, B.shapes[k]!);
  w.pairsDirty = true;
  if (B.type !== kBodyStatic) w.awake.push(b);
}

// every step ends here (0x10060CDE0 / 0x10060D840 -> 0x1005CCB80): the static tree
// 10 nodes, then dynamic, kinematic (and the unused fourth) 4
function optimizeTrees(w: World): void {
  w.trees[0]!.optimize(10);
  w.trees[2]!.optimize(4);
  w.trees[1]!.optimize(4);
}

// After a solve, in the order the client refits (0x1005F3E50 -> 0x1005E91C0): each
// island's bodies as listed, statics skipped, each body's shapes newest first (body
// + 0x158). The scene world's listing is the awake list Islands rebuilt; an item's
// own world is one island of its bodies in slot order (0x10060BA90).
function syncBody(w: World, b: number): void {
  const B = w.bodies[b]!;
  if (B.type === kBodyStatic || !B.enabled) return;
  const sh = B.shapes;
  for (let k = sh.length - 1; k >= 0; k--) refitProxy(w, sh[k]!);
}
function syncProxies(w: World, scene: boolean): void {
  if (scene) {
    const aw = w.awake;
    for (let i = 0; i < aw.n; i++) syncBody(w, aw.a[i]!);
  } else {
    const n = w.bodies.length;
    for (let b = 0; b < n; b++) syncBody(w, b);
  }
}

// the first frame's teleport (0x1005E9BF0 -> 0x1005E8BF0): skipped when nothing
// changes, otherwise the body's proxies are refit now and new pairs are made at the
// next step's start
const tpQ = new Q();
export function teleport(w: World, b: Body, origin: V3, r: Q): void {
  const n2 = r.x * r.x + r.y * r.y + (r.z * r.z + r.w * r.w);
  if (!(n2 > kTiny)) return;
  const ri = 1 / Math.sqrt(n2);
  const k = ri * -0.5 * (n2 * ri * ri + -3);
  tpQ.x = r.x * k;
  tpQ.y = r.y * k;
  tpQ.z = r.z * k;
  tpQ.w = r.w * k;
  const q = b.q;
  const same1 = r.x === q.x && r.y === q.y && r.z === q.z && r.w === q.w;
  const same2 = q.x === tpQ.x && q.y === tpQ.y && q.z === tpQ.z && q.w === tpQ.w;
  if (b.x.x === origin.x && b.x.y === origin.y && b.x.z === origin.z && (same1 || same2)) return;
  copyV(b.x, origin);
  copyQ(b.q, tpQ);
  b.iwOk = false;
  rot(stT, b.q, b.lc);
  b.c.x = b.x.x + stT.x;
  b.c.y = b.x.y + stT.y;
  b.c.z = b.x.z + stT.z;
  for (let i = b.shapes.length - 1; i >= 0; i--) {
    // the body's list, newest first (0x1005E8BF0)
    const s = b.shapes[i]!;
    shapeBox(w, w.shapes[s]!);
    refitProxy(w, s);
  }
  w.pairsDirty = true;
}

/** The box at the body's place and the proxy's move, for a rescale (0x1005F1CA0). */
export function rebox(w: World, s: number): void {
  shapeBox(w, w.shapes[s]!);
  refitProxy(w, s);
}

// retail's contact array (world + 0x6F8, 88-byte slots): a slot is never moved; a
// destroyed one heads the free list (0x10060D840: next = head, head = slot), a new
// contact takes the head (0x10060ABC0), else the next untouched slot, and every pass
// walks the slots in index order - the Gauss-Seidel order of the solve
function freeContact(w: World, i: number): void {
  const c = w.contacts[i]!;
  c.live = false;
  c.seq = 0;
  c.m.n = 0;
  zeroV(c.m.normal);
  zeroV(c.m.Pt);
  zeroV(c.m.Proll);
  c.m.Ptw = 0;
  c.mNext.n = 0;
  c.cache.reset();
  c.rigidPoints = 0;
  c.soft = false;
  w.contactFree.push(i);
}

// --- broadphase (one item's few shapes, the client's rules) ------------------------
function overlap(a: ShapeProxy, b: ShapeProxy): boolean {
  return !(
    b.lo.x > a.hi.x ||
    b.lo.y > a.hi.y ||
    b.lo.z > a.hi.z ||
    a.lo.x > b.hi.x ||
    a.lo.y > b.hi.y ||
    a.lo.z > b.hi.z
  );
}

const pendKa = new IntVec(32);
const pendKb = new IntVec(32);
const pendA = new IntVec(32);
const pendB = new IntVec(32);
const kRolling = fround(Math.sqrt(fround(k02 * k02))); // sqrt(0.2f * 0.2f) in float

// new pairs among moved proxies: different bodies, at least one dynamic, not jointed
// (collideConnected is 0), one contact per pair; the hull goes first
export function findNewContacts(w: World): void {
  if (!w.anyMoved) return;
  w.anyMoved = false;
  const proxies = w.proxies;
  const shapes = w.shapes;
  const bodies = w.bodies;
  const contacts = w.contacts;
  const joined = w.joined;
  const n = shapes.length;
  pendKa.n = 0;
  pendKb.n = 0;
  pendA.n = 0;
  pendB.n = 0;
  for (let i = 0; i < n; i++) {
    const pi = proxies[i]!;
    const si = shapes[i]!;
    for (let j = i + 1; j < n; j++) {
      const pj = proxies[j]!;
      if (!pi.moved && !pj.moved) continue;
      if (pi.node < 0 || pj.node < 0) continue; // a disabled body's shape
      const sj = shapes[j]!;
      if (si.body === sj.body) continue;
      // 0x10060E060 -> 0x1005F0900: the same non-zero group collides when positive;
      // else each one's category must be in the other's mask
      if (si.group !== 0 && sj.group !== 0 && si.group === sj.group) {
        if (!(si.group > 0)) continue;
      } else if ((sj.cat & si.mask) === 0 || (si.cat & sj.mask) === 0) {
        continue;
      }
      if (bodies[si.body]!.type !== kBodyDynamic && bodies[sj.body]!.type !== kBodyDynamic) continue;
      const lo = si.body < sj.body ? si.body : sj.body;
      const hi = sj.body < si.body ? si.body : sj.body;
      const code = (lo << 16) | hi;
      let isJoined = false;
      for (let k = 0; k < joined.n; k++) {
        if (joined.a[k]! === code) {
          isJoined = true;
          break;
        }
      }
      if (isJoined) continue;
      if (!overlap(pi, pj)) continue;
      let exists = false;
      for (let k = 0; k < contacts.length; k++) {
        const c = contacts[k]!;
        if (c.live && ((c.sa === i && c.sb === j) || (c.sa === j && c.sb === i))) {
          exists = true;
          break;
        }
      }
      if (exists) continue;
      // the client's pair: (smaller proxy key, larger)
      const iFirst = pi.key < pj.key;
      pendKa.push(iFirst ? pi.key : pj.key);
      pendKb.push(iFirst ? pj.key : pi.key);
      pendA.push(iFirst ? i : j);
      pendB.push(iFirst ? j : i);
    }
  }
  // made in the client's order: its query packs a pair as (larger key << 32 | smaller
  // key) (0x1005CCDD0) and sorts those u64 ascending (0x1005CCBD0 -> 0x1005CD080) -
  // the LARGER key first, then the smaller. The keys of a pair are unique.
  const m = pendKa.n;
  for (let i = 1; i < m; i++) {
    const ka = pendKa.a[i]!;
    const kb = pendKb.a[i]!;
    const a = pendA.a[i]!;
    const b = pendB.a[i]!;
    let k = i - 1;
    while (
      k >= 0 &&
      (pendKb.a[k]! !== kb ? pendKb.a[k]! > kb : pendKa.a[k]! > ka)
    ) {
      pendKa.a[k + 1] = pendKa.a[k]!;
      pendKb.a[k + 1] = pendKb.a[k]!;
      pendA.a[k + 1] = pendA.a[k]!;
      pendB.a[k + 1] = pendB.a[k]!;
      k--;
    }
    pendKa.a[k + 1] = ka;
    pendKb.a[k + 1] = kb;
    pendA.a[k + 1] = a;
    pendB.a[k + 1] = b;
  }
  for (let p = 0; p < m; p++) {
    const i = pendA.a[p]!;
    const j = pendB.a[p]!;
    const si = shapes[i]!;
    const sj = shapes[j]!;
    // 0x10060ABC0: the pair's first shape is A unless its type is lower
    const swap = si.type < sj.type;
    let c: Contact;
    if (w.contactFree.n > 0) {
      c = contacts[w.contactFree.a[--w.contactFree.n]!]!;
      c.live = true;
    } else {
      c = new Contact();
      contacts.push(c);
    }
    c.seq = ++w.contactSeq;
    c.sa = swap ? j : i;
    c.sb = swap ? i : j;
    const A = shapes[c.sa]!;
    const B = shapes[c.sb]!;
    c.ba = A.body;
    c.bb = B.body;
    c.friction = Math.sqrt(A.friction * B.friction);
    {
      const s = A.restitution + B.restitution;
      const mn = 1 < s ? 1 : s;
      c.restitution = 0 < mn ? mn : 0;
    }
    // the larger shape radius x the mixed fixture rolling resistance (def + 0x20,
    // 0.2): 0x1005EAFE0 + 0x1005F1DE0 (hull 0.01)
    const radA = A.type === kShapeHull ? +kHullRadius : A.r;
    const radB = B.type === kShapeHull ? +kHullRadius : B.r;
    c.rolling = (radA < radB ? radB : radA) * kRolling;
  }
  for (let i = 0; i < n; i++) proxies[i]!.moved = false;
}

const nA1 = new V3();
const nA2 = new V3();
const nB1 = new V3();
const nB2 = new V3();
const nT = new V3();
const nQ = new Q();
function toWorld(o: V3, b: Body, p: V3): void {
  rot(nT, b.q, p);
  o.x = b.x.x + nT.x;
  o.y = b.x.y + nT.y;
  o.z = b.x.z + nT.z;
}
function toLocal(o: V3, b: Body, p: V3): void {
  o.x = p.x - b.x.x;
  o.y = p.y - b.x.y;
  o.z = p.z - b.x.z;
  rotInv(o, b.q, o);
}

// 0x1005EEEB0: the manifold for one contact. Capsules meet in the world; a capsule
// meets a hull in the hull's frame, a hull meets a hull in A's frame; points and
// normal go back to the world.
function narrow(w: World, c: Contact, m: Manifold): void {
  const A = w.shapes[c.sa]!;
  const B = w.shapes[c.sb]!;
  const bA = w.bodies[c.ba]!;
  const bB = w.bodies[c.bb]!;
  m.n = 0;
  zeroV(m.normal);
  if (
    (A.type === kShapeCapsule || A.type === kShapeSphere) &&
    (B.type === kShapeCapsule || B.type === kShapeSphere)
  ) {
    // spheres are stored with a == b == centre (encode), so they run the exact
    // capsule path including its degenerate clamp (0x1005CD880).
    toWorld(nA1, bA, A.a);
    toWorld(nA2, bA, A.b);
    toWorld(nB1, bB, B.a);
    toWorld(nB2, bB, B.b);
    NR.ra = A.r;
    NR.rb = B.r;
    capsuleCapsule(nA1, nA2, nB1, nB2, m);
    return;
  }
  if (A.type === kShapeHull && B.type === kShapeCapsule) {
    toWorld(nA1, bB, B.a);
    toLocal(nA1, bA, nA1);
    toWorld(nA2, bB, B.b);
    toLocal(nA2, bA, nA2);
    NR.r = B.r;
    hullCapsule(A.hull, nA1, nA2, m, c.cache);
  } else if (A.type === kShapeHull && B.type === kShapeHull) {
    mulConjQ(nQ, bA.q, bB.q);
    nA1.x = bB.x.x - bA.x.x;
    nA1.y = bB.x.y - bA.x.y;
    nA1.z = bB.x.z - bA.x.z;
    rotInv(nA1, bA.q, nA1);
    hullHull(A.hull, B.hull, nQ, nA1, m, c.cache);
  } else {
    return; // box, hull-vs-sphere and unknown pairs: Midnight data holds no boxes or
    // spheres (census: 1347 capsules + 47 hulls, 0 else)
  }
  for (let i = 0; i < m.n; i++) {
    const p = m.pt[i]!.p;
    toWorld(p, bA, p);
  }
  rot(m.normal, bA.q, m.normal);
}

// destroy contacts whose fat boxes parted, update the rest (0x1005EEEB0's carrying of
// impulses: by the 8-byte feature key, first unmatched old point)
function collide(w: World): void {
  const contacts = w.contacts;
  const proxies = w.proxies;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]!;
    if (!c.live) continue;
    if (!overlap(proxies[c.sa]!, proxies[c.sb]!)) {
      freeContact(w, i);
      continue;
    }
    const old = c.m;
    const nm = c.mNext;
    narrow(w, c, nm);
    if (nm.n <= 0) {
      // not touching: the client frees the manifold (0x1005EEAC0), so a later touch
      // starts from zero friction, rolling and twist impulses
      zeroV(nm.Pt);
      zeroV(nm.Proll);
      nm.Ptw = 0;
    } else {
      copyV(nm.Pt, old.Pt);
      copyV(nm.Proll, old.Proll);
      nm.Ptw = old.Ptw;
      let used = 0;
      for (let k = 0; k < nm.n; k++) {
        const np = nm.pt[k]!;
        np.Pn = 0;
        for (let o = 0; o < old.n; o++) {
          const op = old.pt[o]!;
          if ((used & (1 << o)) !== 0 || op.key !== np.key) continue;
          used |= 1 << o;
          np.Pn = op.Pn;
          break;
        }
      }
    }
    c.m = nm;
    c.mNext = old;
  }
}

// --- contacts: solver ------------------------------------------------------------
const cRA = new V3();
const cRB = new V3();
const cT = new V3();
const cU = new V3();
const cS = new V3();
const cM = new M3();
const k10Omega = 10 * k2Pi;

// 0x1005EC2E0
function prepareContact(w: World, c: Contact, st: StepData): void {
  // the client rebuilds its position rows every step from the touching contacts
  // (island + 32, 0x1005EE250); one that stopped touching has none
  c.rigidPoints = 0;
  const count = c.m.n;
  if (count <= 0) return;
  const A = w.bodies[c.ba]!;
  const B = w.bodies[c.bb]!;
  c.iAw = iwOf(A);
  c.iBw = iwOf(B);
  const iAw = c.iAw;
  const iBw = c.iBw;
  c.imA = A.im;
  c.imB = B.im;
  c.mA = A.m;
  c.mB = B.m;
  // softness: two dynamic bodies over a 10:1 mass ratio (10 Hz, 0.7), or a kinematic
  // one against the other's shape setting (10 Hz, 0.7); else rigid
  const zeta = k07;
  let isSoft: boolean;
  if (A.type === kBodyDynamic && B.type === kBodyDynamic) {
    isSoft = !(A.m <= B.m * 10) || !(B.m <= A.m * 10);
  } else if (A.type === kBodyKinematic || B.type === kBodyKinematic) {
    isSoft = true; // the dynamic side's fixture Hz (default 10)
  } else {
    isSoft = false;
  }
  const omega = k10Omega;
  c.soft = isSoft;
  c.rigidPoints = isSoft ? 0 : count;
  copyV(c.n, c.m.normal);
  const n = c.n;
  const nx = n.x;
  const ny = n.y;
  const nz = n.z;
  const invCount = 1 / count;
  let sumx = 0;
  let sumy = 0;
  let sumz = 0;
  for (let i = 0; i < count; i++) {
    const mp = c.m.pt[i]!;
    const cp = c.cp[i]!;
    cp.gamma = 0;
    cp.bias = 0;
    cp.Pn = 0;
    cp.sep = mp.sep;
    cRA.x = mp.p.x - A.c.x;
    cRA.y = mp.p.y - A.c.y;
    cRA.z = mp.p.z - A.c.z;
    cRB.x = mp.p.x - B.c.x;
    cRB.y = mp.p.y - B.c.y;
    cRB.z = mp.p.z - B.c.z;
    rotInv(cp.la, A.q, cRA);
    rotInv(cp.lb, B.q, cRB);
    sumx = sumx + mp.p.x;
    sumy = sumy + mp.p.y;
    sumz = sumz + mp.p.z;
    cross(cp.rAn, cRA, n);
    cross(cp.rBn, cRB, n);
    mulm(cp.iArAn, iAw, cp.rAn);
    mulm(cp.iBrBn, iBw, cp.rBn);
    const dA = cp.iArAn.x * cp.rAn.x + cp.iArAn.y * cp.rAn.y + cp.iArAn.z * cp.rAn.z;
    const dB = cp.iBrBn.x * cp.rBn.x + cp.iBrBn.y * cp.rBn.y + cp.iBrBn.z * cp.rBn.z;
    const K = A.im + B.im + dA + dB;
    {
      let mn = 0;
      if (Math.abs(K) > kTiny) {
        const r = 1 / K;
        mn = (1 - K * r) * r + r;
      }
      cp.mn = mn;
    }
    if (isSoft) {
      const sep = mp.sep < -0.25 ? -0.25 : mp.sep; // std::max(sep, -0.25)
      const t = cp.mn * omega;
      const cc = (zeta + zeta) * t;
      const kh = t * st.h * omega;
      const dd = (cc + kh) * st.h;
      let g = 0;
      if (Math.abs(dd) > kTiny) {
        const r = 1 / dd;
        g = (1 - dd * r) * r + r;
      }
      cp.gamma = g;
      cp.bias = kh * sep * g;
      const kk = K + g;
      let mn = 0;
      if (Math.abs(kk) > kTiny) {
        const r = 1 / kk;
        mn = (1 - kk * r) * r + r;
      }
      cp.mn = mn;
    }
    {
      const dd = (dB + B.im) * B.m + (dA + A.im) * A.m;
      let pm = 0;
      if (Math.abs(dd) > kTiny) {
        const r = 1 / dd;
        pm = (1 - dd * r) * r + r;
      }
      cp.posMass = pm;
    }
    // restitution: the bodies' start-of-step velocities (0x1005EC2E0 reads the body
    // records + 0x30 / + 0x40, not the integrated copy)
    cross(cT, B.w0, cRB);
    cross(cU, A.w0, cRA);
    const vn =
      (B.v0.x + cT.x - (A.v0.x + cU.x)) * nx +
      (B.v0.y + cT.y - (A.v0.y + cU.y)) * ny +
      (B.v0.z + cT.z - (A.v0.z + cU.z)) * nz;
    if (vn + 2 < 0) cp.bias = cp.bias + vn * c.restitution;
    if (st.warm) {
      cp.Pn = mp.Pn * st.dtRatio;
      const Pn = cp.Pn;
      const Px = nx * Pn;
      const Py = ny * Pn;
      const Pz = nz * Pn;
      if (A.type === kBodyDynamic) {
        A.v.x = A.v.x - Px * A.im;
        A.v.y = A.v.y - Py * A.im;
        A.v.z = A.v.z - Pz * A.im;
        A.w.x = A.w.x - cp.iArAn.x * Pn;
        A.w.y = A.w.y - cp.iArAn.y * Pn;
        A.w.z = A.w.z - cp.iArAn.z * Pn;
      }
      if (B.type === kBodyDynamic) {
        B.v.x = B.v.x + Px * B.im;
        B.v.y = B.v.y + Py * B.im;
        B.v.z = B.v.z + Pz * B.im;
        B.w.x = B.w.x + cp.iBrBn.x * Pn;
        B.w.y = B.w.y + cp.iBrBn.y * Pn;
        B.w.z = B.w.z + cp.iBrBn.z * Pn;
      }
    }
  }
  // friction at the centre: 2D, twist, rolling
  c.center.x = sumx * invCount;
  c.center.y = sumy * invCount;
  c.center.z = sumz * invCount;
  cRA.x = c.center.x - A.c.x;
  cRA.y = c.center.y - A.c.y;
  cRA.z = c.center.z - A.c.z;
  cRB.x = c.center.x - B.c.x;
  cRB.y = c.center.y - B.c.y;
  cRB.z = c.center.z - B.c.z;
  let t1x: number;
  let t1y: number;
  let t1z: number;
  if (Math.abs(ny) > 0.5) {
    t1x = ny;
    t1y = -nx;
    t1z = 0;
  } else {
    t1x = nz;
    t1y = 0;
    t1z = -nx;
  }
  {
    // exact sqrt + Newton (0x1005EC2E0)
    const l2 = t1x * t1x + t1y * t1y + t1z * t1z;
    const r = 1 / Math.sqrt(l2);
    const k = r * -0.5 * (l2 * r * r + -3);
    t1x = t1x * k;
    t1y = t1y * k;
    t1z = t1z * k;
  }
  c.t1.x = t1x;
  c.t1.y = t1y;
  c.t1.z = t1z;
  cross(c.t2, n, c.t1);
  cross(c.rAt1, cRA, c.t1);
  cross(c.rBt1, cRB, c.t1);
  cross(c.rAt2, cRA, c.t2);
  cross(c.rBt2, cRB, c.t2);
  mulm(c.iAt1, iAw, c.rAt1);
  mulm(c.iBt1, iBw, c.rBt1);
  mulm(c.iAt2, iAw, c.rAt2);
  mulm(c.iBt2, iBw, c.rBt2);
  const mAB = A.im + B.im;
  const K11 =
    c.rAt1.x * c.iAt1.x +
    c.rAt1.y * c.iAt1.y +
    c.rAt1.z * c.iAt1.z +
    (c.rBt1.x * c.iBt1.x + c.rBt1.y * c.iBt1.y + c.rBt1.z * c.iBt1.z) +
    mAB;
  const K12 =
    c.rAt1.x * c.iAt2.x +
    c.rAt1.y * c.iAt2.y +
    c.rAt1.z * c.iAt2.z +
    (c.rBt1.x * c.iBt2.x + c.rBt1.y * c.iBt2.y + c.rBt1.z * c.iBt2.z);
  const K22 =
    c.rAt2.x * c.iAt2.x +
    c.rAt2.y * c.iAt2.y +
    c.rAt2.z * c.iAt2.z +
    (c.rBt2.x * c.iBt2.x + c.rBt2.y * c.iBt2.y + c.rBt2.z * c.iBt2.z) +
    mAB;
  {
    const dd = K22 * K11 - K12 * K12;
    let det = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      det = (1 - dd * r) * r + r;
    }
    c.k11 = K22 * det;
    c.k12 = -det * K12;
    c.k22 = det * K11;
  }
  {
    mulm(cT, iAw, n);
    mulm(cU, iBw, n);
    const dd = nx * cT.x + ny * cT.y + nz * cT.z + (nx * cU.x + ny * cU.y + nz * cU.z);
    let tw = 0;
    if (Math.abs(dd) > kTiny) {
      const r = 1 / dd;
      tw = (1 - dd * r) * r + r;
    }
    c.twMass = tw;
  }
  let r2 = 0;
  for (let i = 0; i < count; i++) {
    const p = c.m.pt[i]!.p;
    const ex = p.x - c.center.x;
    const ey = p.y - c.center.y;
    const ez = p.z - c.center.z;
    r2 += ex * ex + ey * ey + ez * ez;
  }
  r2 *= invCount;
  let rr = 0;
  if (!(Math.abs(r2) < kFltMin)) {
    const r = 1 / Math.sqrt(r2);
    rr = r2 * (r * -0.5 * (r2 * r * r + -3));
  }
  c.mu = c.friction;
  c.muTw = c.friction * 0.5 * rr;
  c.roll = c.rolling;
  if (c.roll <= 0) {
    zeroM3(c.rollK);
  } else {
    addM3(cM, iAw, iBw);
    inverse(c.rollK, cM);
  }
  if (st.warm) {
    const ratio = st.dtRatio;
    const Pt = c.m.Pt;
    c.lamX = (Pt.x * c.t1.x + Pt.y * c.t1.y + Pt.z * c.t1.z) * ratio;
    c.lamY = (Pt.x * c.t2.x + Pt.y * c.t2.y + Pt.z * c.t2.z) * ratio;
    c.lamZ = c.m.Ptw * ratio;
    c.lamRoll.x = c.m.Proll.x * ratio;
    c.lamRoll.y = c.m.Proll.y * ratio;
    c.lamRoll.z = c.m.Proll.z * ratio;
    const lx = c.lamX;
    const ly = c.lamY;
    const Px = c.t1.x * lx + c.t2.x * ly;
    const Py = c.t1.y * lx + c.t2.y * ly;
    const Pz = c.t1.z * lx + c.t2.z * ly;
    const Lx = nx * c.lamZ + c.lamRoll.x;
    const Ly = ny * c.lamZ + c.lamRoll.y;
    const Lz = nz * c.lamZ + c.lamRoll.z;
    if (A.type === kBodyDynamic) {
      A.v.x = A.v.x - Px * A.im;
      A.v.y = A.v.y - Py * A.im;
      A.v.z = A.v.z - Pz * A.im;
      cS.x = c.rAt1.x * lx + Lx + c.rAt2.x * ly;
      cS.y = c.rAt1.y * lx + Ly + c.rAt2.y * ly;
      cS.z = c.rAt1.z * lx + Lz + c.rAt2.z * ly;
      mulm(cS, iAw, cS);
      A.w.x = A.w.x - cS.x;
      A.w.y = A.w.y - cS.y;
      A.w.z = A.w.z - cS.z;
    }
    if (B.type === kBodyDynamic) {
      B.v.x = B.v.x + Px * B.im;
      B.v.y = B.v.y + Py * B.im;
      B.v.z = B.v.z + Pz * B.im;
      cS.x = c.rBt1.x * lx + Lx + c.rBt2.x * ly;
      cS.y = c.rBt1.y * lx + Ly + c.rBt2.y * ly;
      cS.z = c.rBt1.z * lx + Lz + c.rBt2.z * ly;
      mulm(cS, iBw, cS);
      B.w.x = B.w.x + cS.x;
      B.w.y = B.w.y + cS.y;
      B.w.z = B.w.z + cS.z;
    }
  } else {
    c.lamX = 0;
    c.lamY = 0;
    c.lamZ = 0;
    zeroV(c.lamRoll);
  }
}

// 0x1005ED970: rolling, then 2D friction at the centre, twist, then normals
function velContact(w: World, c: Contact): void {
  const count = c.m.n;
  if (count <= 0) return;
  const A = w.bodies[c.ba]!;
  const B = w.bodies[c.bb]!;
  const dA = A.type === kBodyDynamic;
  const dB = B.type === kBodyDynamic;
  const Av = A.v;
  const Aw = A.w;
  const Bv = B.v;
  const Bw = B.w;
  const iAw = c.iAw;
  const iBw = c.iBw;
  let total = 0;
  for (let i = 0; i < count; i++) total += c.cp[i]!.Pn;
  // rolling
  {
    cS.x = Aw.x - Bw.x;
    cS.y = Aw.y - Bw.y;
    cS.z = Aw.z - Bw.z;
    mulm(cS, c.rollK, cS);
    let npx = cS.x + c.lamRoll.x;
    let npy = cS.y + c.lamRoll.y;
    let npz = cS.z + c.lamRoll.z;
    const cap = c.roll * total;
    const l2 = npx * npx + npy * npy + npz * npz;
    if (cap * cap < l2 && kTiny < l2) {
      const r0 = 1 / Math.sqrt(l2);
      const rp = (0.5 - l2 * 0.5 * (r0 * r0)) * r0 + r0;
      npx = npx * cap * rp;
      npy = npy * cap * rp;
      npz = npz * cap * rp;
    }
    cS.x = npx - c.lamRoll.x;
    cS.y = npy - c.lamRoll.y;
    cS.z = npz - c.lamRoll.z;
    c.lamRoll.x = npx;
    c.lamRoll.y = npy;
    c.lamRoll.z = npz;
    if (dA) {
      mulm(cT, iAw, cS);
      Aw.x = Aw.x - cT.x;
      Aw.y = Aw.y - cT.y;
      Aw.z = Aw.z - cT.z;
    }
    if (dB) {
      mulm(cT, iBw, cS);
      Bw.x = Bw.x + cT.x;
      Bw.y = Bw.y + cT.y;
      Bw.z = Bw.z + cT.z;
    }
  }
  // 2D friction
  {
    const dvx = Bv.x - Av.x;
    const dvy = Bv.y - Av.y;
    const dvz = Bv.z - Av.z;
    const t1 = c.t1;
    const t2 = c.t2;
    const C1 =
      t1.x * dvx +
      t1.y * dvy +
      t1.z * dvz +
      (c.rBt1.x * Bw.x + c.rBt1.y * Bw.y + c.rBt1.z * Bw.z) -
      (c.rAt1.x * Aw.x + c.rAt1.y * Aw.y + c.rAt1.z * Aw.z);
    const C2 =
      t2.x * dvx +
      t2.y * dvy +
      t2.z * dvz +
      (c.rBt2.x * Bw.x + c.rBt2.y * Bw.y + c.rBt2.z * Bw.z) -
      (c.rAt2.x * Aw.x + c.rAt2.y * Aw.y + c.rAt2.z * Aw.z);
    const l1 = -(c.k12 * C2 + c.k11 * C1);
    const l2 = -(c.k22 * C2 + c.k12 * C1);
    let n1 = c.lamX + l1;
    let n2 = c.lamY + l2;
    const cap = c.mu * total;
    const m2 = n1 * n1 + n2 * n2;
    if (cap * cap < m2 && kTiny < m2) {
      const r0 = 1 / Math.sqrt(m2);
      const rp = (0.5 - m2 * 0.5 * (r0 * r0)) * r0 + r0;
      const k = cap * rp;
      n1 *= k;
      n2 *= k;
    }
    const d1 = n1 - c.lamX;
    const d2 = n2 - c.lamY;
    c.lamX = n1;
    c.lamY = n2;
    const Px = t1.x * d1 + t2.x * d2;
    const Py = t1.y * d1 + t2.y * d2;
    const Pz = t1.z * d1 + t2.z * d2;
    if (dA) {
      Av.x = Av.x - Px * c.imA;
      Av.y = Av.y - Py * c.imA;
      Av.z = Av.z - Pz * c.imA;
      Aw.x = Aw.x - (c.iAt1.x * d1 + c.iAt2.x * d2);
      Aw.y = Aw.y - (c.iAt1.y * d1 + c.iAt2.y * d2);
      Aw.z = Aw.z - (c.iAt1.z * d1 + c.iAt2.z * d2);
    }
    if (dB) {
      Bv.x = Bv.x + Px * c.imB;
      Bv.y = Bv.y + Py * c.imB;
      Bv.z = Bv.z + Pz * c.imB;
      Bw.x = Bw.x + (c.iBt1.x * d1 + c.iBt2.x * d2);
      Bw.y = Bw.y + (c.iBt1.y * d1 + c.iBt2.y * d2);
      Bw.z = Bw.z + (c.iBt1.z * d1 + c.iBt2.z * d2);
    }
  }
  // twist
  const n = c.n;
  {
    const cd = (Bw.x - Aw.x) * n.x + (Bw.y - Aw.y) * n.y + (Bw.z - Aw.z) * n.z;
    const cap = c.muTw * total;
    const s = c.lamZ - c.twMass * cd;
    const mn = cap < s ? cap : s;
    const np = -cap < mn ? mn : -cap; // std::max(-cap, std::min(s, cap))
    const d = np - c.lamZ;
    c.lamZ = np;
    if (dA) {
      mulm(cT, iAw, n);
      Aw.x = Aw.x - cT.x * d;
      Aw.y = Aw.y - cT.y * d;
      Aw.z = Aw.z - cT.z * d;
    }
    if (dB) {
      mulm(cT, iBw, n);
      Bw.x = Bw.x + cT.x * d;
      Bw.y = Bw.y + cT.y * d;
      Bw.z = Bw.z + cT.z * d;
    }
  }
  // normals
  for (let i = 0; i < count; i++) {
    const cp = c.cp[i]!;
    const dvx = (Bv.x - Av.x) * n.x;
    const dvy = (Bv.y - Av.y) * n.y;
    const dvz = (Bv.z - Av.z) * n.z;
    const sx = cp.rBn.x * Bw.x + dvx - cp.rAn.x * Aw.x;
    const sy = cp.rBn.y * Bw.y + dvy - cp.rAn.y * Aw.y;
    const sz = cp.rBn.z * Bw.z + dvz - cp.rAn.z * Aw.z;
    const lam = (cp.gamma * cp.Pn + sx + sy + (sz + cp.bias)) * cp.mn;
    const s = cp.Pn - lam;
    const np = s < 0 ? 0 : s; // std::max(s, 0)
    const d = np - cp.Pn;
    cp.Pn = np;
    const Px = n.x * d;
    const Py = n.y * d;
    const Pz = n.z * d;
    if (dA) {
      Av.x = Av.x - Px * c.imA;
      Av.y = Av.y - Py * c.imA;
      Av.z = Av.z - Pz * c.imA;
      Aw.x = Aw.x - cp.iArAn.x * d;
      Aw.y = Aw.y - cp.iArAn.y * d;
      Aw.z = Aw.z - cp.iArAn.z * d;
    }
    if (dB) {
      Bv.x = Bv.x + Px * c.imB;
      Bv.y = Bv.y + Py * c.imB;
      Bv.z = Bv.z + Pz * c.imB;
      Bw.x = Bw.x + cp.iBrBn.x * d;
      Bw.y = Bw.y + cp.iBrBn.y * d;
      Bw.z = Bw.z + cp.iBrBn.z * d;
    }
  }
}

// 0x1005EE0B0: only the touching contacts the island solved; a contact with no
// manifold keeps none (its last lambdas are stale). Retail keeps the twist impulse
// in lane 2 of its friction lambdas (solver + 0x198) but stores lane 3 (+0x19C) into
// the manifold's twist (+0xF0) - always 0, so twist is never warm-started.
function storeImpulses(c: Contact): void {
  const count = c.m.n;
  if (count <= 0) return;
  for (let i = 0; i < count; i++) c.m.pt[i]!.Pn = c.cp[i]!.Pn;
  c.m.Pt.x = c.t1.x * c.lamX + c.t2.x * c.lamY;
  c.m.Pt.y = c.t1.y * c.lamX + c.t2.y * c.lamY;
  c.m.Pt.z = c.t1.z * c.lamX + c.t2.z * c.lamY;
  c.m.Ptw = 0;
  copyV(c.m.Proll, c.lamRoll);
}

const pcRA = new V3();
const pcRB = new V3();
const pcP = new V3();
const pcL = new V3();
const pcW = new V3();

// q +- 0.5 (q (x) w), the exact renormalisation: `sign` -1 for A, +1 for B
function posTurn(b: Body, wl: V3, sign: number): void {
  const q = b.q;
  const ax = q.x;
  const ay = q.y;
  const az = q.z;
  const aw = q.w;
  const bx = wl.x;
  const by = wl.y;
  const bz = wl.z;
  // Mul(q, (w, 0))
  const dx = aw * bx + ax * 0 + ay * bz - az * by;
  const dy = aw * by - ax * bz + ay * 0 + az * bx;
  const dz = aw * bz + ax * by - ay * bx + az * 0;
  const dw = aw * 0 - ax * bx - ay * by - az * bz;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (sign < 0) {
    x = ax - 0.5 * dx;
    y = ay - 0.5 * dy;
    z = az - 0.5 * dz;
    w = aw - 0.5 * dw;
  } else {
    x = ax + 0.5 * dx;
    y = ay + 0.5 * dy;
    z = az + 0.5 * dz;
    w = aw + 0.5 * dw;
  }
  const n2 = x * x + y * y + (z * z + w * w);
  b.iwOk = false;
  if (!(n2 > kTiny)) {
    q.x = x;
    q.y = y;
    q.z = z;
    q.w = w;
    return;
  }
  const r = 1 / Math.sqrt(n2);
  const k = r * -0.5 * (n2 * r * r + -3);
  q.x = x * k;
  q.y = y * k;
  q.z = z * k;
  q.w = w * k;
}

// 0x1005EE250 (beta 0.2, slop 0.005): rigid contacts only. A mass-normalised
// pseudo-impulse: each dynamic body moves its centre by P and turns by m I^-1 (r x P).
function posContact(w: World, c: Contact): void {
  const rp = c.rigidPoints;
  if (rp <= 0) return;
  const A = w.bodies[c.ba]!;
  const B = w.bodies[c.bb]!;
  const sA = c.imA * c.mA;
  const sB = c.imB * c.mB;
  const n = c.n;
  for (let i = 0; i < rp; i++) {
    const cp = c.cp[i]!;
    rot(pcRA, A.q, cp.la);
    rot(pcRB, B.q, cp.lb);
    const dx = (B.c.x - (A.c.x + pcRA.x) + pcRB.x) * n.x;
    const dy = (B.c.y - (A.c.y + pcRA.y) + pcRB.y) * n.y;
    const dz = (B.c.z - (A.c.z + pcRA.z) + pcRB.z) * n.z;
    const s = dz + cp.sep + (dx + dy);
    const v = (s + k0005) * k02;
    const C = 0 < v ? 0 : v; // std::min(v, 0)
    if (0 <= C) continue;
    const k = C * -cp.posMass;
    pcP.x = n.x * k;
    pcP.y = n.y * k;
    pcP.z = n.z * k;
    A.c.x = A.c.x - pcP.x * sA;
    A.c.y = A.c.y - pcP.y * sA;
    A.c.z = A.c.z - pcP.z * sA;
    if (A.type === kBodyDynamic) {
      cross(pcL, pcRA, pcP);
      rotInv(pcL, A.q, pcL);
      mulm(pcW, A.iI, pcL);
      pcW.x = pcW.x * c.mA;
      pcW.y = pcW.y * c.mA;
      pcW.z = pcW.z * c.mA;
      posTurn(A, pcW, -1);
    }
    B.c.x = B.c.x + pcP.x * sB;
    B.c.y = B.c.y + pcP.y * sB;
    B.c.z = B.c.z + pcP.z * sB;
    if (B.type === kBodyDynamic) {
      cross(pcL, pcRB, pcP);
      rotInv(pcL, B.q, pcL);
      mulm(pcW, B.iI, pcL);
      pcW.x = pcW.x * c.mB;
      pcW.y = pcW.y * c.mB;
      pcW.z = pcW.z * c.mB;
      posTurn(B, pcW, 1);
    }
  }
  syncOrigin(A);
  syncOrigin(B);
}

// --- the island step (0x1005F2E40) -------------------------------------------------
const sWb = new V3();
const sIw = new V3();
const sW = new V3();
const sMs = new M3();
const sMi = new M3();
const sMm = new M3();
const sMj = new M3();

function solve(w: World, st: StepData, velIters: number, posIters: number): void {
  const h = st.h;
  const bodies = w.bodies;
  const nb = bodies.length;
  // the body records keep the step's start velocities; the solver integrates a copy
  // (0x1005F2E40), and the contacts' restitution reads the records
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    copyV(b.v0, b.v);
    copyV(b.w0, b.w);
    copyV(b.c0, b.c); // the sweep starts where the step does (0x1005F2E40)
    copyQ(b.q0, b.q);
  }
  // velocities: torque, the implicit gyroscopic step (body space), gravity x scale,
  // damping clamp(1 - h d, 0, 1); kinematic bodies keep theirs
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    if (!b.enabled) continue; // out of every island (0x10060BA90: +0x1AF)
    if (b.type === kBodyStatic) {
      zeroV(b.v);
      zeroV(b.w);
      continue;
    }
    if (b.type !== kBodyDynamic) continue;
    copyV(sW, b.w); // no applied torque on item bodies
    if (b.gyro) {
      rotInv(sWb, b.q, sW);
      mulm(sIw, b.I, sWb);
      // f = (wb x Iw) h
      const fcx = sWb.y * sIw.z - sWb.z * sIw.y;
      const fcy = sWb.z * sIw.x - sWb.x * sIw.z;
      const fcz = sWb.x * sIw.y - sWb.y * sIw.x;
      const fx = fcx * h;
      const fy = fcy * h;
      const fz = fcz * h;
      // J = I + (Skew(wb) I + Skew(Iw) x -1) h
      skew(sMs, sWb);
      mulm3(sMm, sMs, b.I);
      skew(sMi, sIw);
      const I = b.I;
      sMj.m0 = I.m0 + (sMm.m0 + sMi.m0 * -1) * h;
      sMj.m1 = I.m1 + (sMm.m1 + sMi.m1 * -1) * h;
      sMj.m2 = I.m2 + (sMm.m2 + sMi.m2 * -1) * h;
      sMj.m3 = I.m3 + (sMm.m3 + sMi.m3 * -1) * h;
      sMj.m4 = I.m4 + (sMm.m4 + sMi.m4 * -1) * h;
      sMj.m5 = I.m5 + (sMm.m5 + sMi.m5 * -1) * h;
      sMj.m6 = I.m6 + (sMm.m6 + sMi.m6 * -1) * h;
      sMj.m7 = I.m7 + (sMm.m7 + sMi.m7 * -1) * h;
      sMj.m8 = I.m8 + (sMm.m8 + sMi.m8 * -1) * h;
      // the client builds J's TRANSPOSE (from the columns of the skews, 0x1005F2E40)
      // and solves it by rows: x = J^-1 f, the Newton step
      const r0x = sMj.m0;
      const r0y = sMj.m3;
      const r0z = sMj.m6;
      const r1x = sMj.m1;
      const r1y = sMj.m4;
      const r1z = sMj.m7;
      const r2x = sMj.m2;
      const r2y = sMj.m5;
      const r2z = sMj.m8;
      const c0x = r1y * r2z - r1z * r2y;
      const c0y = r1z * r2x - r1x * r2z;
      const c0z = r1x * r2y - r1y * r2x;
      const c1x = r2y * r0z - r2z * r0y;
      const c1y = r2z * r0x - r2x * r0z;
      const c1z = r2x * r0y - r2y * r0x;
      const c2x = r0y * r1z - r0z * r1y;
      const c2y = r0z * r1x - r0x * r1z;
      const c2z = r0x * r1y - r0y * r1x;
      const dd = r0x * c0x + r0y * c0y + r0z * c0z;
      let k = 0;
      if (Math.abs(dd) > kTiny) {
        const r = 1 / dd;
        k = (1 - dd * r) * r + r;
      }
      const xx = (c0x * fx + c0y * fy + c0z * fz) * k;
      const xy = (c1x * fx + c1y * fy + c1z * fz) * k;
      const xz = (c2x * fx + c2y * fy + c2z * fz) * k;
      sWb.x = sWb.x - xx;
      sWb.y = sWb.y - xy;
      sWb.z = sWb.z - xz;
      rot(sW, b.q, sWb);
    }
    const gk = b.m * b.gs;
    const ih = b.im * h;
    const vx = b.v.x + w.gx * gk * ih;
    const vy = b.v.y + w.gy * gk * ih;
    const vz = b.v.z + w.gz * gk * ih;
    {
      const s = 1 - b.ld * h;
      const mn = 1 < s ? 1 : s;
      const dl = 0 < mn ? mn : 0;
      b.v.x = vx * dl;
      b.v.y = vy * dl;
      b.v.z = vz * dl;
    }
    {
      const s = 1 - b.ad * h;
      const mn = 1 < s ? 1 : s;
      const da = 0 < mn ? mn : 0;
      b.w.x = sW.x * da;
      b.w.y = sW.y * da;
      b.w.z = sW.z * da;
    }
  }
  const joints = w.joints;
  const contacts = w.contacts;
  const ordered = w.ordered;
  const jo = w.jorder;
  const co = w.corder;
  const nj = ordered ? jo.n : joints.length;
  const nc = ordered ? co.n : contacts.length;
  // prepare: joints, then contacts
  for (let i = 0; i < nj; i++) {
    const j = joints[ordered ? jo.a[i]! : i]!;
    if (j.type === kJointShoulder) prepareShoulder(w, j, st);
    else if (j.type === kJointRevolute) prepareRevolute(w, j, st);
    else if (j.type === kJointWeld) prepareWeld(w, j, st);
    else if (j.type === kJointPrismatic) preparePrismatic(w, j, st);
  }
  for (let i = 0; i < nc; i++) prepareContact(w, contacts[ordered ? co.a[i]! : i]!, st);
  for (let it = 0; it < velIters; it++) {
    for (let i = 0; i < nj; i++) {
      const j = joints[ordered ? jo.a[i]! : i]!;
      if (j.type === kJointShoulder) velShoulder(w, j, st);
      else if (j.type === kJointRevolute) velRevolute(w, j, st);
      else if (j.type === kJointWeld) velWeld(w, j);
      else if (j.type === kJointPrismatic) velPrismatic(w, j, st);
    }
    for (let i = 0; i < nc; i++) velContact(w, contacts[ordered ? co.a[i]! : i]!);
  }
  for (let i = 0; i < nc; i++) storeImpulses(contacts[ordered ? co.a[i]! : i]!);
  // positions: non-finite velocities zeroed; |h v| capped at 4, |h w| at pi/4 (both by
  // rsqrt + Newton); the rotation renormalised when above the guard
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    if (b.type === kBodyStatic || !b.enabled) continue;
    const v = b.v;
    const om = b.w;
    if (
      v.x - v.x !== 0 ||
      v.y - v.y !== 0 ||
      v.z - v.z !== 0 ||
      om.x - om.x !== 0 ||
      om.y - om.y !== 0 ||
      om.z - om.z !== 0
    ) {
      zeroV(v);
      zeroV(om);
    }
    const hvx = v.x * h;
    const hvy = v.y * h;
    const hvz = v.z * h;
    const l2 = hvz * hvz + (hvx * hvx + hvy * hvy);
    let s = 1;
    if (l2 > 16) {
      const r = 1 / Math.sqrt(l2);
      s = r * -0.5 * (l2 * r * r + -3) * 4;
    }
    if (!b.noAngCap) {
      const hwx = om.x * h;
      const hwy = om.y * h;
      const hwz = om.z * h;
      const a2 = hwz * hwz + (hwx * hwx + hwy * hwy);
      if (a2 > kAngCap2) {
        const r = 1 / Math.sqrt(a2);
        const cap = r * -0.5 * (a2 * r * r + -3) * kCapAng;
        s = cap < s ? cap : s;
      }
    }
    v.x = v.x * s;
    v.y = v.y * s;
    v.z = v.z * s;
    om.x = om.x * s;
    om.y = om.y * s;
    om.z = om.z * s;
    b.c.x = v.x * h + b.c.x;
    b.c.y = v.y * h + b.c.y;
    b.c.z = v.z * h + b.c.z;
    const q = b.q;
    const dx = 0 * q.x + om.x * q.w + om.y * q.z - om.z * q.y;
    const dy = 0 * q.y - om.x * q.z + om.y * q.w + om.z * q.x;
    const dz = 0 * q.z + om.x * q.y - om.y * q.x + om.z * q.w;
    const dw = 0 * q.w - om.x * q.x - om.y * q.y - om.z * q.z;
    const hh = 0.5 * h;
    let qx = dx * hh + q.x;
    let qy = dy * hh + q.y;
    let qz = dz * hh + q.z;
    let qw = dw * hh + q.w;
    const n2 = qz * qz + qw * qw + (qx * qx + qy * qy);
    if (n2 > kTiny) {
      const r = 1 / Math.sqrt(n2);
      const k = r * -0.5 * (n2 * r * r + -3);
      qx = qx * k;
      qy = qy * k;
      qz = qz * k;
      qw = qw * k;
    }
    q.x = qx;
    q.y = qy;
    q.z = qz;
    q.w = qw;
    b.iwOk = false;
    syncOrigin(b);
  }
  // positions: joints, then contacts, every iteration
  for (let it = 0; it < posIters; it++) {
    for (let i = 0; i < nj; i++) {
      const j = joints[ordered ? jo.a[i]! : i]!;
      if (j.type === kJointShoulder) posShoulder(w, j);
      else if (j.type === kJointRevolute) posRevolute(w, j);
      else if (j.type === kJointWeld) posWeld(w, j);
      else if (j.type === kJointPrismatic) posPrismatic(w, j);
    }
    for (let i = 0; i < nc; i++) posContact(w, contacts[ordered ? co.a[i]! : i]!);
  }
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    if (b.type !== kBodyStatic && b.enabled) syncOrigin(b);
  }
  // every moving body's shapes get the box swept over the step, from the sweep start
  // to here (0x1005E8FE0) - what the refit then reads
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    if (b.type === kBodyStatic || !b.enabled) continue;
    const sh = b.shapes;
    for (let k = 0; k < sh.length; k++) sweptBox(w, w.shapes[sh[k]!]!);
  }
  // sleep (0x1005F3CB1): item bodies are made with sleeping off (game body + 0x14 is
  // never set), so the island never sleeps; the rule kept as written
  let minSleep = +kFltMax;
  for (let i = 0; i < nb; i++) {
    const b = bodies[i]!;
    if (b.type === kBodyStatic || !b.enabled) continue;
    const ww = b.w.x * b.w.x + b.w.y * b.w.y + b.w.z * b.w.z;
    const vv = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z;
    if (!b.allowSleep || ww > kSleepW || vv > kSleepV) {
      b.sleep = 0;
      minSleep = 0;
    } else {
      b.sleep += h;
      minSleep = b.sleep < minSleep ? b.sleep : minSleep; // std::min(minSleep, sleep)
    }
  }
  if (minSleep >= 0.5) {
    for (let i = 0; i < nb; i++) {
      const b = bodies[i]!;
      zeroV(b.v);
      zeroV(b.w);
    }
    w.islandAwake = false;
  }
}

// 0x10060AE60: the scene world's islands. Seeds in awake-list order (world + 0x830; a
// body already in an island this step is skipped); a LIFO stack; a popped body walks
// its shapes newest first (body + 0x158, 0x1005E7F50 prepends), each shape's contacts
// newest first (shape + 0x40, 0x1005EAFE0 prepends), a touching one (+0x52) joining
// the island, then its joints newest first (body + 0x160, 0x1005F4B60 prepends),
// skipped between two kinematic bodies; a body reached is listed, and pushed unless
// static. Each island is solved on its own (0x1005F2C70); islands share no moving
// body, so solving them as one in this order is the same arithmetic. Afterwards the
// awake list is every island's non-static bodies, the newest island first (0x1005F3E50).
function reach(w: World, o: number, island: number): void {
  if (w.bstamp[o]! === island) return;
  if (w.bodies[o]!.type !== kBodyStatic) w.stack.push(o);
  w.listed.push(o);
  w.bstamp[o] = island;
}

function islands(w: World): void {
  const bodies = w.bodies;
  const shapes = w.shapes;
  const joints = w.joints;
  const contacts = w.contacts;
  const nb = bodies.length;
  while (w.edges.length < shapes.length) w.edges.push(new IntVec(4));
  for (let i = 0; i < shapes.length; i++) w.edges[i]!.n = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i]!;
    if (!c.live) continue;
    w.edges[c.sa]!.push(i);
    w.edges[c.sb]!.push(i);
  }
  for (let i = 0; i < shapes.length; i++) {
    const e = w.edges[i]!;
    if (e.n > 1) sortBySeqDesc(contacts, e);
  }
  if (w.bjDirty) {
    w.bjDirty = false;
    while (w.bj.length < nb) w.bj.push(new IntVec(4));
    for (let i = 0; i < w.bj.length; i++) w.bj[i]!.n = 0;
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i]!;
      w.bj[j.a]!.push(i);
      w.bj[j.b]!.push(i);
    }
  }
  if (w.bstamp.length < nb) w.bstamp = new Int32Array(nb * 2);
  if (w.cstamp.length < contacts.length) w.cstamp = new Int32Array(contacts.length * 2);
  if (w.jstamp.length < joints.length) w.jstamp = new Int32Array(joints.length * 2);
  w.bstamp.fill(-1);
  w.cstamp.fill(-1);
  w.jstamp.fill(-1);
  w.jorder.n = 0;
  w.corder.n = 0;
  w.listed.n = 0;
  w.islandStart.n = 0;
  let island = -1;
  const aw = w.awake;
  for (let si = 0; si < aw.n; si++) {
    const seed = aw.a[si]!;
    if (seed >= nb || w.bstamp[seed]! !== -1) continue;
    island++;
    w.islandStart.push(w.listed.n);
    w.stack.n = 0;
    w.stack.push(seed);
    w.listed.push(seed);
    w.bstamp[seed] = island;
    while (w.stack.n > 0) {
      const b = w.stack.a[--w.stack.n]!;
      const sh = bodies[b]!.shapes;
      for (let k = sh.length - 1; k >= 0; k--) {
        const sid = sh[k]!;
        const e = w.edges[sid]!;
        for (let m = 0; m < e.n; m++) {
          const ci = e.a[m]!;
          const c = contacts[ci]!;
          if (w.cstamp[ci]! === island || c.m.n <= 0) continue;
          w.corder.push(ci);
          w.cstamp[ci] = island;
          reach(w, shapes[c.sa === sid ? c.sb : c.sa]!.body, island);
        }
      }
      const bjb = w.bj[b]!;
      for (let k = bjb.n - 1; k >= 0; k--) {
        const ji = bjb.a[k]!;
        if (w.jstamp[ji]! === island) continue;
        const j = joints[ji]!;
        const o = j.a === b ? j.b : j.a;
        if (bodies[b]!.type === kBodyKinematic && bodies[o]!.type === kBodyKinematic) continue;
        w.jorder.push(ji);
        w.jstamp[ji] = island;
        reach(w, o, island);
      }
    }
  }
  // the awake list: every island's non-static bodies, the newest island first
  const next = w.awakeNext;
  next.n = 0;
  for (let k = w.islandStart.n - 1; k >= 0; k--) {
    const from = w.islandStart.a[k]!;
    const to = k + 1 < w.islandStart.n ? w.islandStart.a[k + 1]! : w.listed.n;
    for (let i = from; i < to; i++) {
      const b = w.listed.a[i]!;
      if (bodies[b]!.type !== kBodyStatic) next.push(b);
    }
  }
  w.awakeNext = w.awake;
  w.awake = next;
}

/**
 * b2World::Step (0x10060CDE0 scene / 0x10060D840 item): collide, solve, refit the
 * proxies, new pairs. The time step is w.dt: a double never crosses a call here.
 */
export function stepWorld(w: World, velIters: number, posIters: number, scene: boolean): void {
  const st = ST;
  const dt = w.dt;
  st.h = dt;
  // 1/dt by rcpss + one Newton step behind the tiny guard; the warm-start scale is the
  // previous step's 1/dt x dt - NOT clamped in an item's own world (0x10060D840), at
  // most 2 in the scene's shared world (0x10060CDE0: min(.., 0x10351BB30 = 2.0);
  // measured: a 144 -> 30 fps hitch warm-started War Within's prismatic shoulders 2.4x
  // too hard, 2026-10-21)
  let inv = 0;
  if (Math.abs(dt) > kTiny) {
    const r = 1 / dt;
    inv = (1 - dt * r) * r + r;
  }
  st.inv = inv;
  const ratio = w.invDt0 * dt;
  st.dtRatio = scene ? (2 < ratio ? 2 : ratio) : ratio;
  st.warm = true;
  // 0x10060D840: a teleport flagged new pairs (world + 0x540) -> found first
  if (w.pairsDirty) {
    w.pairsDirty = false;
    findNewContacts(w);
  }
  collide(w);
  if (dt > 0 && scene) {
    // the scene world solves island by island (0x10060AE60), in DFS order
    islands(w);
    w.ordered = true;
    solve(w, st, velIters, posIters);
    w.ordered = false;
  } else if (dt > 0) {
    solve(w, st, velIters, posIters); // an item's own world: one island, slot order
  }
  if (dt > 0) syncProxies(w, scene); // each island refits as it finishes (0x1005F3E50)
  findNewContacts(w);
  if (dt > 0) w.invDt0 = st.inv;
  optimizeTrees(w); // every step, last (0x1005CCB80)
}

// one item leaves a shared world: its bodies, shapes and joints go, every record after
// them moves down, contacts touching it are destroyed. Not per step: plain arrays.
export function removeItem(
  w: World,
  b0: number,
  nb: number,
  s0: number,
  ns: number,
  j0: number,
  nj: number,
  order: number[],
): void {
  const mb = (i: number): number => (i >= b0 + nb ? i - nb : i);
  const ms = (i: number): number => (i >= s0 + ns ? i - ns : i);
  // The client's order (0x1011B5350 -> 0x10060E3B0 -> 0x1005E7CE0 -> 0x1005F13F0): the
  // entries' bodies in entry order, each body's shapes newest first, each shape's
  // contacts newest first, then its proxy - the tree frees whichever parent each leaf
  // has when it goes.
  for (const s of order) {
    contactsOfShapeNewestFirst(w, s);
    for (let i = 0; i < onList.n; i++) freeContact(w, onList.a[i]!);
    freeProxy(w, s);
  }
  // a shape no entry names (the table refuses such a row; the client would leak its
  // body) still leaves the tree, so no leaf outlives its shape
  for (let s = s0; s < s0 + ns; s++) if (!order.includes(s)) freeProxy(w, s);
  w.bodies.splice(b0, nb);
  w.shapes.splice(s0, ns);
  w.proxies.splice(s0, ns);
  w.joints.splice(j0, nj);
  for (const b of w.bodies) for (let k = 0; k < b.shapes.length; k++) b.shapes[k] = ms(b.shapes[k]!);
  for (const s of w.shapes) s.body = mb(s.body);
  w.joined.n = 0;
  for (const j of w.joints) {
    j.a = mb(j.a);
    j.b = mb(j.b);
    w.joined.push(((j.a < j.b ? j.a : j.b) << 16) | (j.b < j.a ? j.a : j.b));
  }
  {
    const aw = w.awake;
    let n = 0;
    for (let i = 0; i < aw.n; i++) {
      const b = aw.a[i]!;
      if (b < b0 || b >= b0 + nb) aw.a[n++] = mb(b);
    }
    aw.n = n;
  }
  for (let i = 0; i < w.contacts.length; i++) {
    const c = w.contacts[i]!;
    if (!c.live) continue;
    if ((c.sa >= s0 && c.sa < s0 + ns) || (c.sb >= s0 && c.sb < s0 + ns)) {
      freeContact(w, i);
      continue;
    }
    c.sa = ms(c.sa);
    c.sb = ms(c.sb);
    c.ba = mb(c.ba);
    c.bb = mb(c.bb);
  }
  w.bjDirty = true;
}

