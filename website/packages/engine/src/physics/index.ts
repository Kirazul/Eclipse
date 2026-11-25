// Retail's runtime physics (.phys) for the items that move by it - helm plumes, shoulder
// ribbons, buckle chains, weapon tassels - pure and three.js-free, in retail axes (Z up,
// gravity (0, 0, -10)); the caller converts at its boundary.
//
// A port of Eclipse's src/eclipse/races/Physics.cpp, itself a port of the retail client's
// "Domino" engine (Midnight 12.1.0.69933 macOS x86_64; VAs in the comments). Its proof is
// engine/test/physics.test.ts. Each frame of an item (0x1011ABC30):
//   dt = min(frame dt, 1/30)
//   DRIVE (0x1011B3790 / 0x1011B4370): every kinematic body is moved to its bone; a
//     fraction s = max(fracAngular, fracLinear, carry) of the move is a teleport (carry =
//     BDY4 0x28), the rest velocity; the dynamic bodies of its carry group are carried by
//     the same delta
//   STEP: an own world (PHYT 4) at 8 velocity / 12 position iterations in step(); a shared
//     one (PHYT 0 / 1 / 3) once a frame at 8 / 2 in PhysScene.step(), after every item
//   BONES (0x1011B4BF0): every listed dynamic body writes its bone,
//     [R_rel | p_rel / scale] x T(-pivot), model space
import {
  M3,
  Q,
  V3,
  copyQ,
  copyV,
  fround,
  kBodyDynamic,
  kBodyKinematic,
  kBodyStatic,
  kJointPrismatic,
  kJointRevolute,
  kJointShoulder,
  kJointWeld,
  kPi,
  kShapeHull,
  kTiny,
  matOf,
  matQ,
  mulm,
  mulq,
  mulQConj,
  mulConjQ,
  rot,
  rotInv,
} from './math';
import { parsePhys } from './parse';
import type {
  PhysBody,
  PhysHull,
  PhysJoint,
  PhysModel,
  PhysShape,
  Vec3,
} from './parse';
import {
  Body,
  Joint,
  Shape,
  ShapeProxy,
  World,
  addProxy,
  disableBody,
  enableBody,
  findNewContacts,
  rebox,
  removeItem,
  resetMass,
  setTransform,
  stepWorld,
  teleport,
} from './world';

export { parsePhys };
export type { PhysBody, PhysHull, PhysJoint, PhysModel, PhysShape, Vec3 };

/** One frame's inputs. Column form, row major (m[r * 4 + c]). */
export interface PhysFrame {
  /** n * 16: a bone matrix maps a model-bind point to the WORLD. */
  boneWorld: Float64Array;
  /** n * 3: the bones' pivots, model space. */
  pivots: Float32Array;
  boneCount: number;
  /** 16: the placement maps model space to the world. */
  placement: Float64Array;
  /** The game's frame time, s. */
  dt: number;
  /** The squared distance to the camera (an attached item takes its parent's); past
   *  17689 (133 yd) the item is culled. */
  camDist2: number;
}

const kMaxDt = fround(1 / 30); // 1.0f / 30.0f, a float expression
const k0016 = fround(0.016);
const kAxisEps = fround(2.38418579e-7);
const k0999 = fround(0.999);
const k1001 = fround(1.001);
const kDeg = fround(0.0174532942);
const kCone0 = fround(0.174532935);
const kCone1 = fround(2.96705961);
const kAng0 = fround(0.392699093);
const kAng1 = fround(0.785398185);
const k2Pi = 2 * kPi;

class Entry {
  bone = 0xffff;
  group = 0;
  body = 0;
  carry = 1.5;
}

// the client's placement split (0x1011B3790) and a bone's world target (0x1010D0720)
class Split {
  scale = 1.5;
}
const SPL = new Split();
const dcR = new M3();

function axesToRot(M: Float64Array, o: number, rotOut: Q, placement: boolean): void {
  // the three axes (the matrix's columns); their lengths; identity under the guard
  const a0x = M[o]!;
  const a0y = M[o + 4]!;
  const a0z = M[o + 8]!;
  const a1x = M[o + 1]!;
  const a1y = M[o + 5]!;
  const a1z = M[o + 9]!;
  const a2x = M[o + 2]!;
  const a2y = M[o + 6]!;
  const a2z = M[o + 10]!;
  const l0 = a0x * a0x + a0y * a0y + a0z * a0z;
  const l1 = a1x * a1x + a1y * a1y + a1z * a1z;
  const l2 = a2x * a2x + a2y * a2y + a2z * a2z;
  const len0 = l0 > kAxisEps ? Math.sqrt(l0) : 0;
  const len1 = l1 > kAxisEps ? Math.sqrt(l1) : 0;
  const len2 = l2 > kAxisEps ? Math.sqrt(l2) : 0;
  SPL.scale = len1 < k0016 ? +k0016 : len1; // std::max(len[1], 0.016) (the placement reads it)
  rotOut.x = 0;
  rotOut.y = 0;
  rotOut.z = 0;
  rotOut.w = 1;
  const guard = placement ? k0016 : kTiny;
  if (len0 > guard && len1 > guard && len2 > guard) {
    const i0 = 1 / len0;
    const i1 = 1 / len1;
    const i2 = 1 / len2;
    const xx = a0x * i0;
    const xy = a0y * i0;
    const xz = a0z * i0;
    const yx = a1x * i1;
    const yy = a1y * i1;
    const yz = a1z * i1;
    let zx = a2x * i2;
    let zy = a2y * i2;
    let zz = a2z * i2;
    const cx = xy * yz - xz * yy;
    const cy = xz * yx - xx * yz;
    const cz = xx * yy - xy * yx;
    if (cx * zx + cy * zy + cz * zz < 0) {
      zx = -zx;
      zy = -zy;
      zz = -zz;
    }
    // rows of the client's row-vector matrix are our columns
    dcR.m0 = xx;
    dcR.m1 = xy;
    dcR.m2 = xz;
    dcR.m3 = yx;
    dcR.m4 = yy;
    dcR.m5 = yz;
    dcR.m6 = zx;
    dcR.m7 = zy;
    dcR.m8 = zz;
    matQ(rotOut, dcR);
  }
}

// position, normalised rotation (identity when an axis is under 0.016), scale = the
// second axis's length
function decompose(P: Float64Array, pos: V3, rotOut: Q): void {
  axesToRot(P, 0, rotOut, true);
  pos.x = P[3]!;
  pos.y = P[7]!;
  pos.z = P[11]!;
}

// a bone's world target: its pivot through the bone's world matrix, and the matrix's
// normalised axes
function boneTargetOf(M: Float64Array, o: number, pivots: Float32Array, bone: number, pos: V3, r: Q): void {
  const px = pivots[bone * 3]!;
  const py = pivots[bone * 3 + 1]!;
  const pz = pivots[bone * 3 + 2]!;
  pos.x = M[o]! * px + M[o + 1]! * py + M[o + 2]! * pz + M[o + 3]!;
  pos.y = M[o + 4]! * px + M[o + 5]! * py + M[o + 6]! * pz + M[o + 7]!;
  pos.z = M[o + 8]! * px + M[o + 9]! * py + M[o + 10]! * pz + M[o + 11]!;
  axesToRot(M, o, r, false);
}

// --- the drive (0x1011B4370) --------------------------------------------------------
class Limits {
  linLo = 1.5;
  linLo2 = 1.5;
  linHi2 = 1.5;
  linRange = 1.5;
  angLo = 1.5;
  angLo2 = 1.5;
  angHi2 = 1.5;
  angRange = 1.5;
  inv = 1.5;
  carry = 1.5;
  woke = false;
}
const LIM = new Limits();
const drRq = new V3();
const drToT = new V3();
const drT = new V3();
const drRn = new V3();
const drO = new V3();
const drQ0 = new Q();
const drQn = new Q();
const drC = new Q();

// 2 vec((to - from) inv (x) conj(from)): the rotation rate between two rotations
function angVel(o: V3, from: Q, to: Q, tSign: number, inv0: Limits): void {
  const inv = inv0.inv;
  drC.x = (to.x * tSign - from.x) * inv;
  drC.y = (to.y * tSign - from.y) * inv;
  drC.z = (to.z * tSign - from.z) * inv;
  drC.w = (to.w * tSign - from.w) * inv;
  mulQConj(drC, drC, from);
  o.x = drC.x + drC.x;
  o.y = drC.y + drC.y;
  o.z = drC.z + drC.z;
}

// One kinematic body towards its bone. A fraction s of the move is a teleport, the rest
// is velocity; true when it teleported. The origin before and the delta (origin shift,
// rotation) go out for the carry.
function driveBody(
  b: Body,
  tpos: V3,
  tq: Q,
  L: Limits,
  old: V3,
  dPos: V3,
  dRot: Q,
  wantDelta: boolean,
): boolean {
  const lc = b.lc;
  const carry = L.carry;
  const inv = L.inv;
  copyV(old, b.x);
  copyQ(drQ0, b.q);
  const q = drQ0;
  const ox = old.x;
  const oy = old.y;
  const oz = old.z;
  rot(drRq, q, lc);
  rot(drT, tq, lc);
  drToT.x = tpos.x - ox + drT.x;
  drToT.y = tpos.y - oy + drT.y;
  drToT.z = tpos.z - oz + drT.z;
  const dcx = drToT.x - drRq.x;
  const dcy = drToT.y - drRq.y;
  const dcz = drToT.z - drRq.z;
  const dq = q.x * tq.x + q.y * tq.y + q.z * tq.z + q.w * tq.w;
  const sign = dq >= 0 ? 1 : -1;
  angVel(drT, q, tq, sign, L);
  const wx = drT.x;
  const wy = drT.y;
  const wz = drT.z;
  const vx = dcx * inv;
  const vy = dcy * inv;
  const vz = dcz * inv;
  // frac(l2): 0 under lo, 1 over hi, else carry .. 1 along the range
  let fa: number;
  {
    const l2 = wx * wx + wy * wy + wz * wz;
    if (l2 <= L.angLo2) fa = 0;
    else if (!(l2 <= L.angHi2)) fa = 1;
    else {
      const x = Math.sqrt(l2) - L.angLo;
      const d = L.angRange;
      const r = 1 / d;
      const t = x * r;
      const v = (x - d * t) * r + t;
      const m = 1 < v ? 1 : v;
      fa = (0 < m ? m : 0) * (1 - carry) + carry;
    }
  }
  let fl: number;
  {
    const l2 = vx * vx + vy * vy + vz * vz;
    if (l2 <= L.linLo2) fl = 0;
    else if (!(l2 <= L.linHi2)) fl = 1;
    else {
      const x = Math.sqrt(l2) - L.linLo;
      const d = L.linRange;
      const r = 1 / d;
      const t = x * r;
      const v = (x - d * t) * r + t;
      const m = 1 < v ? 1 : v;
      fl = (0 < m ? m : 0) * (1 - carry) + carry;
    }
  }
  // std::max(std::max(fa, fl), carry)
  const m1 = fa < fl ? fl : fa;
  const s = m1 < carry ? carry : m1;
  if (s <= 0) {
    if (vx - vx === 0 && vy - vy === 0 && vz - vz === 0) {
      b.v.x = vx;
      b.v.y = vy;
      b.v.z = vz;
    }
    if (wx - wx === 0 && wy - wy === 0 && wz - wz === 0) {
      b.w.x = wx;
      b.w.y = wy;
      b.w.z = wz;
    }
    return false;
  }
  // nlerp the rotation, move the centre of mass by s of the way
  const qtx = tq.x * sign;
  const qty = tq.y * sign;
  const qtz = tq.z * sign;
  const qtw = tq.w * sign;
  const nx = (qtx - q.x) * s + q.x;
  const ny = (qty - q.y) * s + q.y;
  const nz = (qtz - q.z) * s + q.z;
  const nw = (qtw - q.w) * s + q.w;
  copyV(drRn, drRq);
  if (nz * nz + nw * nw + (nx * nx + ny * ny) > kTiny) {
    // exact sqrt + Newton (0x1011B4370)
    const n2 = nx * nx + ny * ny + (nz * nz + nw * nw);
    let x = nx;
    let y = ny;
    let z = nz;
    let w = nw;
    if (n2 > kTiny) {
      const r = 1 / Math.sqrt(n2);
      const k = r * -0.5 * (n2 * r * r + -3);
      x = nx * k;
      y = ny * k;
      z = nz * k;
      w = nw * k;
    }
    drQn.x = x;
    drQn.y = y;
    drQn.z = z;
    drQn.w = w;
    rot(drRn, drQn, lc);
  } else {
    copyQ(drQn, q);
  }
  const csx = dcx * s + drRq.x;
  const csy = dcy * s + drRq.y;
  const csz = dcz * s + drRq.z;
  drO.x = ox + (csx - drRn.x);
  drO.y = oy + (csy - drRn.y);
  drO.z = oz + (csz - drRn.z);
  setTransform(b, drO, drQn);
  L.woke = true;
  const dq2 = drQn.x * tq.x + drQn.y * tq.y + drQn.z * tq.z + drQn.w * tq.w;
  angVel(drT, drQn, tq, dq2 >= 0 ? 1 : -1, L);
  const wrx = drT.x;
  const wry = drT.y;
  const wrz = drT.z;
  const vrx = (drToT.x - csx) * inv;
  const vry = (drToT.y - csy) * inv;
  const vrz = (drToT.z - csz) * inv;
  if (wantDelta) {
    dPos.x = csx - drRn.x;
    dPos.y = csy - drRn.y;
    dPos.z = csz - drRn.z;
    mulQConj(dRot, drQn, q);
  }
  if (vrx - vrx === 0 && vry - vry === 0 && vrz - vrz === 0) {
    b.v.x = vrx;
    b.v.y = vry;
    b.v.z = vrz;
  }
  if (wrx - wrx === 0 && wry - wry === 0 && wrz - wrz === 0) {
    b.w.x = wrx;
    b.w.y = wry;
    b.w.z = wrz;
  }
  return true;
}

const cyT = new V3();
const cyQ = new Q();
// a carried body: rotated about the head's old origin and shifted
function carryBody(b: Body, pivot: V3, dPos: V3, dRot: Q): void {
  cyT.x = b.x.x - pivot.x;
  cyT.y = b.x.y - pivot.y;
  cyT.z = b.x.z - pivot.z;
  rot(cyT, dRot, cyT);
  cyT.x = cyT.x + dPos.x + pivot.x;
  cyT.y = cyT.y + dPos.y + pivot.y;
  cyT.z = cyT.z + dPos.z + pivot.z;
  mulq(cyQ, dRot, b.q);
  setTransform(b, cyT, cyQ);
}

// --- the scene --------------------------------------------------------------------
/**
 * A client scene's shared physics world (retail Physics::PhysicsWorld2, 0x1011AB860):
 * every PHYT 0 / 1 / 3 item of the scene lives in it and it steps ONCE a frame, after every
 * item has been driven (8 velocity / 2 position iterations). Items in it collide by their
 * filters: PHYT 3 items (category 16) with each other, across models.
 */
export class PhysScene {
  /** @internal */ world = new World();
  /** @internal */ list: PhysInstance[] = [];
  /** @internal */ counter = 0; // the unit's ragdoll counter (+0x12)

  get items(): number {
    return this.list.length;
  }

  // 0x1011ABC30 -> 0x10060E830(world, 8, 2, 1, min(dt, 1/30)), after every drive
  step(dt: number): void {
    const d = kMaxDt < dt ? +kMaxDt : dt;
    if (!(d > 0) || this.list.length === 0) return;
    this.world.dt = d;
    stepWorld(this.world, 8, 2, true);
  }
}

const inT = new V3();
const stPos = new V3();
const stRot = new Q();
const tgP = new V3();
const tgQ = new Q();
const rootOld = new V3();
const rootD = new V3();
const rootQ = new Q();
const chOld = new V3();
const chD = new V3();
const chQ = new Q();
const ouQ = new Q();
const ouR = new M3();
const ouP = new V3();
const ouT = new V3();

function toV(o: V3, a: Vec3, s: number): void {
  o.x = a[0] * s;
  o.y = a[1] * s;
  o.z = a[2] * s;
}

export class PhysInstance {
  private m: PhysModel;
  private w: World | null;
  private scene: PhysScene | null;
  private attached: boolean;
  private b0 = 0; // where this item's records start in the world
  private s0 = 0;
  private j0 = 0;
  private group = 0x5000; // its shapes' filter group (0x1011B5430: the unit's counter)
  private entries: Entry[] = [];
  private root = -1; // the 0x4000 entry
  private listed: boolean[] = []; // per body: in the entry list (drives / writes its bone)
  private first = true;
  private pos = new V3();
  private rot = new Q();
  private scale = 1.5;
  private made = false;
  private culled = false; // ragdoll + 128 bit 0x10: past the culling distance
  private pivots: V3[] = []; // per body: its bone's pivot (model space)

  /**
   * scene: the shared world a PHYT 0 / 1 / 3 model joins; without one (or for PHYT 4) the
   * item gets its own world. attached: the model hangs on a parent (an item on a
   * character), which picks category 64 for PHYT 0 / 1.
   */
  constructor(model: PhysModel, scene: PhysScene | null, attached: boolean) {
    this.m = model;
    this.attached = attached;
    this.scale = 1;
    if (scene && model.mode !== 4) {
      this.scene = scene;
      this.w = scene.world;
    } else {
      this.scene = null;
      this.w = new World();
    }
  }

  get shared(): boolean {
    return this.scene !== null;
  }

  private make(scale: number, pos: V3, r: Q): void {
    const m = this.m;
    const w = this.w!;
    const scene = this.scene;
    if (scene) {
      // 0x1011B5430: 0x5000, 0x5001 ... 0x5800, then 0x5000 again
      const c = scene.counter;
      scene.counter = ((c - 0x5800) & 0xffff) < 0xf7ff ? 0x5000 : (c + 1) & 0xffff;
      this.group = scene.counter;
      scene.list.push(this);
    }
    // the item's filter (0x1010C9500 -> 0x1011B3450 -> 0x1011B5F40), masks from
    // 0x1035235A0: PHYT 0 / 1 category 32 (mask 0xA2), 64 when the model hangs on a parent
    // (mask 0x07); PHYT 3 / 4 category 16 (mask 0x17)
    let cat = 16;
    let mask = 0x17;
    if (m.mode <= 1) {
      cat = this.attached ? 64 : 32;
      mask = this.attached ? 0x07 : 0xa2;
    }
    const b0 = w.bodies.length;
    const s0 = w.shapes.length;
    const j0 = w.joints.length;
    this.b0 = b0;
    this.s0 = s0;
    this.j0 = j0;
    for (const d of m.bodies) {
      const b = new Body();
      b.type = d.type;
      copyQ(b.q, r);
      toV(inT, d.pos, 1);
      rot(inT, r, inT);
      b.x.x = inT.x * scale + pos.x;
      b.x.y = inT.y * scale + pos.y;
      b.x.z = inT.z * scale + pos.z;
      b.gs = d.gravity;
      b.is = d.inertia;
      b.ld = d.linDamp;
      b.ad = d.angDamp;
      b.gyro = true; // body def + 0x3E
      b.noAngCap = false; // body def + 0x3C
      b.allowSleep = false; // body def + 0x38 (game body + 0x14, never set)
      w.bodies.push(b);
    }
    for (let i = 0; i < m.shapes.length; i++) {
      const d = m.shapes[i]!;
      const s = new Shape();
      s.type = d.type;
      s.body = b0 + d.body;
      s.cat = cat;
      s.mask = mask;
      s.group = this.group;
      s.friction = d.friction;
      s.restitution = d.restitution;
      s.density = d.density;
      toV(s.a, d.a, scale);
      toV(s.b, d.b, scale);
      s.r = d.r * scale;
      if (d.type === kShapeHull && d.hull < m.hulls.length) {
        const H = m.hulls[d.hull]!;
        toV(s.hull.centroid, H.centroid, scale);
        s.hull.volume = H.volume * scale * scale * scale;
        s.hull.area = H.area * scale * scale;
        for (const p of H.v) {
          const v = new V3();
          toV(v, p, scale);
          s.hull.v.push(v);
        }
        for (const p of H.n) {
          const v = new V3();
          toV(v, p, 1);
          s.hull.n.push(v);
        }
        for (const dd of H.d) s.hull.d.push(dd * scale);
        s.hull.face = Uint8Array.from(H.face);
        s.hull.edge = Uint8Array.from(H.edge);
      }
      w.shapes.push(s);
      if (d.body < m.bodies.length) w.bodies[b0 + d.body]!.shapes.push(s0 + i);
    }
    // a body that is not kinematic and has no shape is created kinematic: it follows its
    // bone (0x1011B5430 -> 0x1011AD910(def, 1) before 0x1011AD7C0)
    for (let i = 0; i < m.bodies.length; i++) {
      const b = w.bodies[b0 + i]!;
      if (b.type !== kBodyKinematic && b.shapes.length === 0) b.type = kBodyKinematic;
      resetMass(w, b);
      // a moving body joins the awake list as it is made (0x1005E78D0)
      if (b.type !== kBodyStatic) w.awake.push(b0 + i);
    }
    for (const d of m.joints) {
      const j = new Joint();
      j.type = d.type;
      j.a = b0 + d.a;
      j.b = b0 + d.b;
      toV(j.pa, d.pa, scale);
      toV(j.pb, d.pb, scale);
      qFromFrame(j.qa, d.fa);
      qFromFrame(j.qb, d.fb);
      j.mode = d.mode;
      const f = d.f;
      if (d.type === kJointShoulder) {
        // 0x100601F80
        j.twLo = f[0]! * kDeg;
        j.twHi = f[1]! * kDeg;
        j.twState = j.twLo < j.twHi ? 1 : 0;
        const c = f[2]! * kDeg;
        const mn = kCone1 < c ? kCone1 : c; // std::min(c, 2.967)
        j.cone = kCone0 < mn ? mn : kCone0; // std::max(0.1745, mn)
        j.coneState = 1;
        j.maxT = f[3]!;
        j.hz = f[4]!;
        j.zeta = f[5]!;
      } else if (d.type === kJointRevolute) {
        // 0x1005FF280
        const lo = f[0]! * kDeg;
        const hi = f[1]! * kDeg;
        const lower = lo > k2Pi ? k2Pi : lo < -k2Pi ? -k2Pi : lo;
        const upper = hi < lower ? lower : hi > k2Pi ? k2Pi : hi;
        j.revCenter = (upper + lower) * 0.5;
        j.revHalf = (upper - lower) * 0.5;
        j.limState = lo < hi ? 1 : 0;
        j.maxT = f[2]!;
        j.hz = f[3]!;
        j.zeta = f[4]!;
      } else if (d.type === kJointWeld) {
        // 0x1006063B0
        j.angHz = f[0]!;
        j.angZeta = f[1]!;
        j.linHz = f[2]!;
        j.linZeta = f[3]!;
      } else if (d.type === kJointPrismatic) {
        // creator 0x1011B2EB0, ctor 0x1005FC640: limits as the file has them (the creator
        // scales only the frame positions); limited when lower < upper
        j.prLower = f[0]!;
        j.prUpper = f[1]!;
        j.limState = f[0]! < f[1]! ? 1 : 0;
        j.maxT = f[2]!;
        j.hz = f[3]!;
        j.zeta = f[4]!;
        // the scene world sets the spring target from the file (0x1005F6D10); a private
        // world keeps the ctor's 0. Speed: 0 (parsePhys refuses a velocity motor)
        j.prTarget = scene ? f[5]! : 0;
        j.prSpeed = 0;
      }
      w.joints.push(j);
      w.joined.push(((j.a < j.b ? j.a : j.b) << 16) | (j.b < j.a ? j.a : j.b));
    }
    w.bjDirty = true;
    // The drive's entry list (0x1011B5430). A head is a kinematic body whose group has bit
    // 0x8000; with no head, the first kinematic body heads and every body after it names
    // it as its group (bodies before it: 0). The list is every kinematic body in file
    // order, each head followed by the dynamic bodies whose group is the head's index; the
    // root is the listed entry with bit 0x4000. A dynamic body no head names is simulated
    // but never listed: never carried, never written to its bone (0x1011B4BF0).
    const nb = m.bodies.length;
    const file: Entry[] = [];
    let heads = 0;
    for (let i = 0; i < nb; i++) {
      const e = new Entry();
      const d = m.bodies[i]!;
      e.bone = d.bone;
      e.group = d.group;
      e.carry = d.carry;
      e.body = b0 + i;
      file.push(e);
      if (w.bodies[b0 + i]!.type === kBodyKinematic && (e.group & 0x8000) !== 0) heads++;
    }
    if (heads === 0) {
      let found = false;
      let head = 0;
      for (let i = 0; i < nb; i++) {
        if (!found && w.bodies[b0 + i]!.type === kBodyKinematic) {
          file[i]!.group = 0x8000;
          head = i;
          found = true;
        } else {
          file[i]!.group = head;
        }
      }
    }
    this.entries = [];
    this.listed = new Array<boolean>(nb).fill(false);
    for (let k = 0; k < nb; k++) {
      if (w.bodies[b0 + k]!.type !== kBodyKinematic) continue;
      this.entries.push(file[k]!);
      this.listed[k] = true;
      if ((file[k]!.group & 0x4000) !== 0) this.root = this.entries.length - 1;
      if ((file[k]!.group & 0x8000) === 0) continue;
      for (let j = 0; j < nb; j++) {
        if (w.bodies[b0 + j]!.type === kBodyDynamic && file[j]!.group === k) {
          this.entries.push(file[j]!);
          this.listed[j] = true;
        }
      }
    }
    // each shape's proxy as its shape is made: body by body, each body's shapes in file
    // order (0x1011B5430 -> 0x1005E7F50)
    for (let i = 0; i < m.shapes.length; i++) w.proxies.push(new ShapeProxy());
    for (let i = 0; i < nb; i++) {
      const sh = w.bodies[b0 + i]!.shapes;
      for (let k = 0; k < sh.length; k++) addProxy(w, sh[k]!);
    }
    findNewContacts(w);
    this.scale = scale;
    this.pivots = [];
    for (let i = 0; i < nb; i++) this.pivots.push(new V3());
    this.made = true;
  }

  /** One frame: drive, and step the item's own world (a shared world steps in
   *  PhysScene.step, after every item of the scene was driven). */
  step(f: PhysFrame): void {
    const w = this.w;
    const m = this.m;
    if (!w || m.bodies.length === 0) return;
    const dt = kMaxDt < f.dt ? +kMaxDt : f.dt; // std::min(f.dt, 1/30)
    decompose(f.placement, stPos, stRot);
    const pscale = SPL.scale;
    if (!this.made) this.make(pscale, stPos, stRot);
    const entries = this.entries;
    const bodies = w.bodies;
    // CULLING (0x1011B3790, first): a model whose squared camera distance (model + 1568)
    // is past 0x1011AFC30's 17689 (133 yd) is not driven, its bodies are disabled in entry
    // order (0x1005EA210 off) and its bones not written (0x1011B4BF0); its own world does
    // not step (0x1011B6040: only when every entry body is enabled). Back in range, its
    // bodies are enabled again, in entry order, before the drive.
    if (f.camDist2 > 17689) {
      if (!this.culled) {
        this.culled = true;
        for (let i = 0; i < entries.length; i++) disableBody(w, entries[i]!.body);
      }
      return;
    }
    if (this.culled) {
      this.culled = false;
      for (let i = 0; i < entries.length; i++) enableBody(w, entries[i]!.body);
    }
    const nb = m.bodies.length;
    const pv = f.pivots;
    for (let i = 0; i < nb; i++) {
      const bone = m.bodies[i]!.bone;
      const p = this.pivots[i]!;
      if (bone < f.boneCount) {
        p.x = pv[bone * 3]!;
        p.y = pv[bone * 3 + 1]!;
        p.z = pv[bone * 3 + 2]!;
      } else {
        p.x = 0;
        p.y = 0;
        p.z = 0;
      }
    }
    copyV(this.pos, stPos);
    copyQ(this.rot, stRot);
    // model scale changed by more than 0.1%: rescale the bodies (0x1005EA370)
    if (pscale < this.scale * k0999 || this.scale * k1001 < pscale) this.rescale(pscale);
    const boneW = f.boneWorld;
    if (this.first) {
      // first frame: every body to its bone's pivot, the placement's rotation
      this.first = false;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        if (e.bone < f.boneCount) {
          boneTargetOf(boneW, e.bone * 16, pv, e.bone, tgP, tgQ);
        } else {
          copyV(tgP, stPos);
        }
        if (e.bone === 0xffff) copyV(tgP, stPos);
        // 0x1005E9BF0: proxies refit, pairs at the step's start
        teleport(w, bodies[e.body]!, tgP, stRot);
      }
      // the drive ends here (0x1011B3790) but the world still steps this frame
      // (0x1011AFF60 -> 0x1011B6040; a shared one in PhysScene.step)
      if (!this.scene && dt > 0 && w.islandAwake) {
        w.dt = dt;
        stepWorld(w, 8, 12, false);
      }
      return;
    }
    if (!(dt > 0)) return;
    const inv = 1 / dt;
    const invc = 45 < inv ? 45 : inv; // std::min(inv, 45)
    const L = LIM;
    L.inv = inv;
    L.linLo = 0.25 * invc;
    L.linLo2 = L.linLo * L.linLo;
    const linHi = 0.5 * invc;
    L.linHi2 = linHi * linHi;
    L.linRange = linHi - L.linLo;
    L.angLo = kAng0 * invc;
    L.angLo2 = L.angLo * L.angLo;
    const angHi = kAng1 * invc;
    L.angHi2 = angHi * angHi;
    L.angRange = angHi - L.angLo;
    L.woke = false;
    const placementDriven = m.mode <= 1;
    // the root (0x4000) first, its delta kept
    const n = entries.length;
    const rootI = this.root;
    if (rootI >= 0) {
      const e = entries[rootI]!;
      this.target(e, placementDriven, f);
      L.carry = e.carry;
      // the C++'s locals, born zero and identity each frame: a root that does not teleport
      // (carry 0, a small move) writes neither, and its followers ride no delta
      rootD.x = 0;
      rootD.y = 0;
      rootD.z = 0;
      rootQ.x = 0;
      rootQ.y = 0;
      rootQ.z = 0;
      rootQ.w = 1;
      driveBody(bodies[e.body]!, tgP, tgQ, L, rootOld, rootD, rootQ, true);
    }
    for (let i = 0; i < n; i++) {
      const e = entries[i]!;
      const b = bodies[e.body]!;
      if (b.type === kBodyKinematic && i !== rootI) {
        this.target(e, placementDriven, f);
        const head = e.group === 0x8000;
        L.carry = e.carry;
        const tele = driveBody(b, tgP, tgQ, L, chOld, chD, chQ, head);
        if (!tele) {
          if (head) L.woke = true; // its dynamic followers are woken
          continue;
        }
        if (!head && rootI < 0) continue;
        // the root's delta, about this body's old origin
        const cd = rootI >= 0 ? rootD : chD;
        const cq = rootI >= 0 ? rootQ : chQ;
        while (i + 1 < n && bodies[entries[i + 1]!.body]!.type !== kBodyKinematic) {
          i++;
          carryBody(bodies[entries[i]!.body]!, chOld, cd, cq);
          L.woke = true;
        }
        continue;
      }
      if (rootI < 0) {
        L.woke = true;
        continue;
      }
      // a dynamic body or the root: the following dynamic bodies ride the root
      while (i + 1 < n && bodies[entries[i + 1]!.body]!.type !== kBodyKinematic) {
        i++;
        carryBody(bodies[entries[i]!.body]!, rootOld, rootD, rootQ);
      }
      L.woke = true;
    }
    if (this.scene) return; // the scene's world steps once, after every item's drive
    if (L.woke) w.islandAwake = true;
    // the item's own world: only when every body is awake (0x1011B6040)
    if (w.islandAwake) {
      w.dt = dt;
      stepWorld(w, 8, 12, false);
    }
  }

  // the drive's target (0x1011B4370): the bone, or for PHYT 0 / 1 (ragdoll flag 0x20,
  // 0x1011B5430) the model's own placement; in tgP, tgQ
  private target(e: Entry, placementDriven: boolean, f: PhysFrame): void {
    if (placementDriven || e.bone >= f.boneCount) {
      copyV(tgP, stPos);
      copyQ(tgQ, stRot);
      return;
    }
    boneTargetOf(f.boneWorld, e.bone * 16, f.pivots, e.bone, tgP, tgQ);
  }

  // 0x1005EA370. Not per step: only on a real change of the model's scale.
  private rescale(pscale: number): void {
    const w = this.w!;
    const m = this.m;
    const ns = m.shapes.length;
    const nj = m.joints.length;
    const nb = m.bodies.length;
    const q = pscale / this.scale;
    const k = q < k0016 ? k0016 : q; // std::max(pscale / scale, 0.016)
    for (let i = this.s0; i < this.s0 + ns; i++) {
      const s = w.shapes[i]!;
      s.a.x = s.a.x * k;
      s.a.y = s.a.y * k;
      s.a.z = s.a.z * k;
      s.b.x = s.b.x * k;
      s.b.y = s.b.y * k;
      s.b.z = s.b.z * k;
      s.r *= k;
      const h = s.hull;
      h.centroid.x = h.centroid.x * k;
      h.centroid.y = h.centroid.y * k;
      h.centroid.z = h.centroid.z * k;
      h.volume *= k * k * k;
      for (const p of h.v) {
        p.x = p.x * k;
        p.y = p.y * k;
        p.z = p.z * k;
      }
      for (let n = 0; n < h.d.length; n++) h.d[n] = h.d[n]! * k;
    }
    for (let i = this.j0; i < this.j0 + nj; i++) {
      const j = w.joints[i]!;
      j.pa.x = j.pa.x * k;
      j.pa.y = j.pa.y * k;
      j.pa.z = j.pa.z * k;
      j.pb.x = j.pb.x * k;
      j.pb.y = j.pb.y * k;
      j.pb.z = j.pb.z * k;
    }
    for (let i = this.b0; i < this.b0 + nb; i++) resetMass(w, w.bodies[i]!);
    // each entry body's shapes, newest first: the box at its place, then the proxy's move
    // (0x1005EA370 -> 0x1005E95D0 -> 0x1005F1CA0)
    for (const e of this.entries) {
      const sh = w.bodies[e.body]!.shapes;
      for (let n = sh.length - 1; n >= 0; n--) rebox(w, sh[n]!);
    }
    this.scale = pscale;
  }

  /**
   * 0x1011B4BF0: the MODEL-SPACE matrix (column form, m[r * 4 + c], written at `at`) to
   * draw dynamic body `body`'s bone with: [R_rel | p_rel / scale] x T(-pivot). False for a
   * body that does not write its bone.
   */
  output(body: number, out: Float64Array, at = 0): boolean {
    const w = this.w;
    if (!this.made || !w || this.culled || body >= this.m.bodies.length || !this.listed[body]) {
      return false;
    }
    const b = w.bodies[this.b0 + body]!;
    if (b.type !== kBodyDynamic) return false;
    mulConjQ(ouQ, this.rot, b.q);
    ouP.x = b.x.x - this.pos.x;
    ouP.y = b.x.y - this.pos.y;
    ouP.z = b.x.z - this.pos.z;
    rotInv(ouP, this.rot, ouP);
    const is = 1 / this.scale;
    ouP.x = ouP.x * is;
    ouP.y = ouP.y * is;
    ouP.z = ouP.z * is;
    matOf(ouR, ouQ);
    mulm(ouT, ouR, this.pivots[body]!);
    out[at] = ouR.m0;
    out[at + 1] = ouR.m1;
    out[at + 2] = ouR.m2;
    out[at + 3] = ouP.x - ouT.x;
    out[at + 4] = ouR.m3;
    out[at + 5] = ouR.m4;
    out[at + 6] = ouR.m5;
    out[at + 7] = ouP.y - ouT.y;
    out[at + 8] = ouR.m6;
    out[at + 9] = ouR.m7;
    out[at + 10] = ouR.m8;
    out[at + 11] = ouP.z - ouT.z;
    out[at + 12] = 0;
    out[at + 13] = 0;
    out[at + 14] = 0;
    out[at + 15] = 1;
    return true;
  }

  /** The item leaves its scene's world in the client's order; an own world is dropped. */
  dispose(): void {
    const scene = this.scene;
    const w = this.w;
    this.w = null;
    if (!scene || !w) return;
    const items = scene.list;
    const at = items.indexOf(this);
    if (at < 0) return;
    items.splice(at, 1);
    if (!this.made) return;
    const m = this.m;
    const nb = m.bodies.length;
    const ns = m.shapes.length;
    const nj = m.joints.length;
    // the entries' bodies in entry order, shapes newest first; every body of a shared row
    // is listed (parsePhys refuses a shared row with a body the drive never lists)
    const order: number[] = [];
    for (const e of this.entries) {
      const sh = w.bodies[e.body]!.shapes;
      for (let k = sh.length - 1; k >= 0; k--) order.push(sh[k]!);
    }
    removeItem(w, this.b0, nb, this.s0, ns, this.j0, nj, order);
    for (const o of items) {
      // every item after this one moves down
      if (o.b0 > this.b0) o.b0 -= nb;
      if (o.s0 > this.s0) o.s0 -= ns;
      if (o.j0 > this.j0) o.j0 -= nj;
      for (const e of o.entries) if (e.body >= this.b0 + nb) e.body -= nb;
    }
  }
}

const qfM = new M3();
function qFromFrame(o: Q, f: number[]): void {
  qfM.m0 = f[0]!;
  qfM.m1 = f[1]!;
  qfM.m2 = f[2]!;
  qfM.m3 = f[3]!;
  qfM.m4 = f[4]!;
  qfM.m5 = f[5]!;
  qfM.m6 = f[6]!;
  qfM.m7 = f[7]!;
  qfM.m8 = f[8]!;
  matQ(o, qfM);
}
