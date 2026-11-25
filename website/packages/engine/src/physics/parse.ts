// The .phys file (v6, and v4 by the client's upgrade) -> PhysModel: the row Eclipse's
// midnight_physics_table.encode + Physics.cpp Find hand the solver, field for field.
// Chunks (tags byte-reversed on disk): PHYS, PHYT, BDY4, SHP2, CAPS, SPHS, PLYT, JOIN,
// SHJ2, REV2, WLJ3, PRS2; v4 carries SHOJ 0x74, WLJ2 0x70, REVJ 0x70, PRSJ 0x78, which
// the upgrader 0x1011AAC90 copies unchanged, appending Hz 1.0 / ratio 0.7 (shoulder,
// revolute, prismatic) or a zero dword (weld). Parser 0x1011AA600, definition builder
// 0x1011AC190. Every value stays the file's float32, exactly.
import { fround } from './math';

export type Vec3 = [number, number, number];

export interface PhysBody {
  type: number; // Domino: 0 dynamic, 1 kinematic, 2 static (file 0 -> 1, 1 -> 0, else 2)
  bone: number;
  pos: Vec3; // model space (+ the shift)
  gravity: number;
  inertia: number;
  linDamp: number;
  angDamp: number;
  carry: number; // BDY4 0x28
  group: number; // BDY4 0x2C
}
export interface PhysShape {
  body: number;
  type: number; // Domino: 0 sphere, 1 capsule, 2 hull
  hull: number; // hull: index into PhysModel.hulls
  friction: number;
  restitution: number;
  density: number;
  a: Vec3; // sphere: a = b = centre; capsule: a, b (body space)
  b: Vec3;
  r: number;
}
/** A PLYT polytope as the file has it: vertices, face planes (n . x = d), each face's
 *  first half-edge, half-edges of 4 bytes {int8 twin offset, origin vertex, face, next
 *  half-edge}, and the file's centroid, volume and area. */
export interface PhysHull {
  centroid: Vec3;
  volume: number;
  area: number;
  v: Vec3[];
  n: Vec3[];
  d: number[];
  face: number[];
  edge: number[];
}
export interface PhysJoint {
  type: number; // 5 prismatic, 6 revolute, 7 shoulder, 9 weld
  a: number;
  b: number;
  mode: number; // motor mode (signed byte, as the client reads it)
  pa: Vec3; // frame positions (body space, model units)
  pb: Vec3;
  fa: number[]; // frame rotations: the file's 3x3, axis images as rows (9)
  fb: number[];
  /** shoulder: twistLo, twistHi, cone (degrees), maxTorque, Hz, damping.
   *  revolute: lower, upper (degrees), maxTorque, Hz, damping.
   *  weld: angular Hz, angular damping, linear Hz, linear damping.
   *  prismatic: lower, upper, max force, Hz, damping, spring target. (6) */
  f: number[];
}
export interface PhysModel {
  /** The file's PHYT (0x1010C9500): 4 = the item's own world (8 / 12 iterations); 0, 1,
   *  3 = the scene's shared world (8 / 2), where 0 and 1 drive their kinematic bodies to
   *  the model's placement, not their bones. */
  mode: number;
  bodies: PhysBody[];
  shapes: PhysShape[];
  joints: PhysJoint[];
  hulls: PhysHull[];
}

class Refuse extends Error {}

function chunksOf(data: Uint8Array): Map<string, DataView> {
  const out = new Map<string, DataView>();
  const all = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  while (o + 8 <= data.length) {
    const tag = String.fromCharCode(data[o + 3]!, data[o + 2]!, data[o + 1]!, data[o]!);
    const n = all.getUint32(o + 4, true);
    const from = o + 8;
    const to = Math.min(from + n, data.length);
    out.set(tag, new DataView(data.buffer, data.byteOffset + from, to - from));
    o = from + n;
  }
  return out;
}

function v3(d: DataView, o: number): Vec3 {
  return [d.getFloat32(o, true), d.getFloat32(o + 4, true), d.getFloat32(o + 8, true)];
}
function floats(d: DataView, o: number, n: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < n; i++) r.push(d.getFloat32(o + i * 4, true));
  return r;
}

interface RawBody {
  type: number;
  bone: number;
  pos: Vec3;
  s0: number;
  ns: number;
  g: number;
  inertia: number;
  ld: number;
  ad: number;
  carry: number;
  group: number;
}

function parseBodies(ch: Map<string, DataView>): RawBody[] {
  const out: RawBody[] = [];
  const B = ch.get('BDY4');
  if (!B) return out;
  const n = Math.floor(B.byteLength / 0x30);
  for (let i = 0; i < n; i++) {
    const o = i * 0x30;
    const typ = B.getUint16(o, true);
    out.push({
      type: typ === 0 ? 1 : typ === 1 ? 0 : 2,
      bone: B.getUint16(o + 2, true),
      pos: v3(B, o + 4),
      s0: B.getUint16(o + 0x10, true),
      ns: B.getInt32(o + 0x14, true),
      g: B.getFloat32(o + 0x18, true),
      inertia: B.getFloat32(o + 0x1c, true),
      ld: B.getFloat32(o + 0x20, true),
      ad: B.getFloat32(o + 0x24, true),
      carry: B.getFloat32(o + 0x28, true),
      group: B.getUint16(o + 0x2c, true),
    });
  }
  return out;
}

function parseHulls(ch: Map<string, DataView>): PhysHull[] {
  const out: PhysHull[] = [];
  const b = ch.get('PLYT');
  if (!b) return out;
  const n = b.getUint32(0, true);
  let o = 4 + n * 0x50;
  for (let i = 0; i < n; i++) {
    const h = 4 + i * 0x50;
    const vc = b.getUint32(h, true);
    const nf = b.getUint32(h + 0x10, true);
    const ne = b.getUint32(h + 0x28, true);
    const hull: PhysHull = {
      centroid: v3(b, h + 0x38),
      volume: b.getFloat32(h + 0x44, true),
      area: b.getFloat32(h + 0x48, true),
      v: [],
      n: [],
      d: [],
      face: [],
      edge: [],
    };
    for (let k = 0; k < vc; k++) hull.v.push(v3(b, o + k * 12));
    o += vc * 12;
    for (let k = 0; k < nf; k++) {
      hull.n.push(v3(b, o + k * 16));
      hull.d.push(b.getFloat32(o + k * 16 + 12, true));
    }
    o += nf * 16;
    for (let k = 0; k < nf; k++) hull.face.push(b.getUint8(o + k));
    o += nf;
    for (let k = 0; k < ne * 4; k++) hull.edge.push(b.getUint8(o + k));
    o += ne * 4;
    out.push(hull);
  }
  return out;
}

const k07 = fround(0.7);
const JOINT_OF: Record<number, [string, number, number, string, number]> = {
  // JOIN type: v6 tag, size, Domino type, v4 tag, size
  1: ['SHJ2', 0x7c, 7, 'SHOJ', 0x74],
  3: ['REV2', 0x78, 6, 'REVJ', 0x70],
  2: ['WLJ3', 0x74, 9, 'WLJ2', 0x70],
  4: ['PRS2', 0x80, 5, 'PRSJ', 0x78],
};

function parseJoints(ch: Map<string, DataView>): PhysJoint[] {
  const out: PhysJoint[] = [];
  const J = ch.get('JOIN');
  if (!J) return out;
  const n = Math.floor(J.byteLength / 16);
  for (let i = 0; i < n; i++) {
    const a = J.getUint32(i * 16, true);
    const b = J.getUint32(i * 16 + 4, true);
    const jt = J.getUint16(i * 16 + 12, true);
    const jid = J.getUint16(i * 16 + 14, true);
    const def = JOINT_OF[jt];
    // 0 SPHJ, 5 DSTJ (distance): the client's parser reads them, but no measured file
    // carries one, so their solvers are not ported
    if (!def) throw new Refuse(`joint type ${jt} not supported`);
    let tag = def[0];
    let size = def[1];
    const dom = def[2];
    let old = false;
    if (!ch.has(tag) && ch.has(def[3])) {
      tag = def[3];
      size = def[4];
      old = true;
    }
    const d = ch.get(tag);
    if (!d || (jid + 1) * size > d.byteLength) throw new Refuse(`joint record ${tag} ${jid} missing`);
    const o = jid * size;
    const fa = floats(d, o, 9);
    const pa = v3(d, o + 0x24);
    const fb = floats(d, o + 0x30, 9);
    const pb = v3(d, o + 0x54);
    let mode = 0;
    let f: number[];
    if (dom === 7) {
      const lo = d.getFloat32(o + 0x60, true);
      const hi = d.getFloat32(o + 0x64, true);
      const cone = d.getFloat32(o + 0x68, true);
      const tq = d.getFloat32(o + 0x6c, true);
      mode = d.getInt8(o + 0x70);
      const hz = old ? 1 : d.getFloat32(o + 0x74, true);
      const z = old ? k07 : d.getFloat32(o + 0x78, true);
      f = [lo, hi, cone, tq, hz, z];
    } else if (dom === 6) {
      const lo = d.getFloat32(o + 0x60, true);
      const hi = d.getFloat32(o + 0x64, true);
      const tq = d.getFloat32(o + 0x68, true);
      mode = d.getInt8(o + 0x6c);
      const hz = old ? 1 : d.getFloat32(o + 0x70, true);
      const z = old ? k07 : d.getFloat32(o + 0x74, true);
      f = [lo, hi, tq, hz, z, 0];
    } else if (dom === 5) {
      // builder 0x1011AC190 case 4 / creator 0x1011B2EB0: 0x60 lower, 0x64 upper
      // (lengths, never scaled), 0x68 spring target, 0x6C max force, 0x70 motor speed,
      // 0x74 mode (i8), 0x78 Hz, 0x7C ratio. Only a velocity motor (mode not 0 / 1)
      // reads the speed, and its private-world max force (0x1005F6B10) is not ported:
      // such a file is refused, not guessed.
      const lo = d.getFloat32(o + 0x60, true);
      const hi = d.getFloat32(o + 0x64, true);
      const target = d.getFloat32(o + 0x68, true);
      const force = d.getFloat32(o + 0x6c, true);
      mode = d.getInt8(o + 0x74);
      const hz = old ? 1 : d.getFloat32(o + 0x78, true);
      const z = old ? k07 : d.getFloat32(o + 0x7c, true);
      if (mode !== 0 && mode !== 1) throw new Refuse(`prismatic velocity motor (mode ${mode})`);
      f = [lo, hi, force, hz, z, target];
    } else {
      // in file order: angular Hz, angular ratio, linear Hz, linear ratio. The builder
      // sets def +80..+92 from record +0x60..+0x6C, the creator 0x1011B7270 and the
      // ctor 0x1006063B0 each shuffle it with 216: the two swaps cancel, and prepare
      // 0x1006064E0 reads +0x1F0 / +0x1F8 as Hz with +0x1F4 / +0x1FC as their ratios.
      f = [
        d.getFloat32(o + 0x60, true),
        d.getFloat32(o + 0x64, true),
        d.getFloat32(o + 0x68, true),
        d.getFloat32(o + 0x6c, true),
        0,
        0,
      ];
    }
    out.push({ type: dom, a, b, mode, pa, pb, fa, fb, f });
  }
  return out;
}

/** The bodies of a row the drive's entry list never names, as Instance::Make lists them
 *  (0x1011B5430); `dynamicListed` is the count of dynamic bodies it does name. */
function listing(m: PhysModel): { unlisted: number[]; dynamicListed: number } {
  const nb = m.bodies.length;
  const has = new Array<boolean>(nb).fill(false);
  for (const s of m.shapes) has[s.body] = true;
  const typ = m.bodies.map((b, i) => (b.type !== 1 && !has[i] ? 1 : b.type));
  const group = m.bodies.map((b) => b.group);
  let anyHead = false;
  for (let i = 0; i < nb; i++) if (typ[i] === 1 && (group[i]! & 0x8000) !== 0) anyHead = true;
  if (!anyHead) {
    let head = -1;
    for (let i = 0; i < nb; i++) {
      if (head < 0 && typ[i] === 1) {
        group[i] = 0x8000;
        head = i;
      } else {
        group[i] = head < 0 ? 0 : head;
      }
    }
  }
  const listed = new Array<boolean>(nb).fill(false);
  let dynamicListed = 0;
  for (let k = 0; k < nb; k++) {
    if (typ[k] !== 1) continue;
    listed[k] = true;
    if ((group[k]! & 0x8000) === 0) continue;
    for (let j = 0; j < nb; j++) {
      if (typ[j] === 0 && group[j] === k && !listed[j]) {
        listed[j] = true;
        dynamicListed++;
      }
    }
  }
  const unlisted: number[] = [];
  for (let i = 0; i < nb; i++) if (!listed[i]) unlisted.push(i);
  return { unlisted, dynamicListed };
}

function parseImpl(bytes: Uint8Array, shift: Vec3): PhysModel | null {
  const ch = chunksOf(bytes);
  // 0x1011B5430 sets ragdoll flag 4 for PHAO records, and the drive then carries by
  // ragdoll + 112 (0x1011B4370); not ported - none of the 877 shipped files has one - so
  // such a file hangs rigid, as in Eclipse's table
  const phao = ch.get('PHAO');
  if (phao && phao.byteLength > 0) return null;
  const phyt = ch.get('PHYT');
  const mode = phyt && phyt.byteLength >= 4 ? phyt.getUint32(0, true) : 4;
  // PHYT 2 builds one bounds box, not a ragdoll (0x1010C9500 -> 0x1011B06C0)
  if (mode !== 0 && mode !== 1 && mode !== 3 && mode !== 4) return null;
  const raw = parseBodies(ch);
  const hulls = parseHulls(ch);
  const joints = parseJoints(ch);
  const S = ch.get('SHP2');
  const C = ch.get('CAPS');
  const Sp = ch.get('SPHS');
  const shapes: PhysShape[] = [];
  raw.forEach((b, bi) => {
    for (let k = 0; k < b.ns; k++) {
      const o = (b.s0 + k) * 0x20;
      if (!S) throw new Refuse('shape without SHP2');
      const st = S.getInt16(o, true);
      const si = S.getInt16(o + 2, true);
      const friction = S.getFloat32(o + 8, true);
      const restitution = S.getFloat32(o + 12, true);
      const density = S.getFloat32(o + 16, true);
      const base = { body: bi, friction, restitution, density };
      if (st === 1) {
        if (!C) throw new Refuse('capsule without CAPS');
        const c = si * 28;
        shapes.push({
          ...base,
          type: 1,
          hull: 0,
          a: v3(C, c),
          b: v3(C, c + 12),
          r: C.getFloat32(c + 24, true),
        });
      } else if (st === 2) {
        if (!Sp) throw new Refuse('sphere without SPHS');
        const c = si * 16;
        shapes.push({
          ...base,
          type: 0,
          hull: 0,
          a: v3(Sp, c),
          b: v3(Sp, c),
          r: Sp.getFloat32(c + 12, true),
        });
      } else if (st === 3) {
        shapes.push({ ...base, type: 2, hull: si, a: [0, 0, 0], b: [0, 0, 0], r: 0 });
      } else {
        throw new Refuse(`shape type ${st} not supported`);
      }
    }
  });
  const nb = raw.length;
  if (Math.max(nb, shapes.length, joints.length, hulls.length) > 255) return null;
  // Find's checks: every index in range
  for (const j of joints) if (j.a >= nb || j.b >= nb) return null;
  for (const s of shapes) if (s.type === 2 && s.hull >= hulls.length) return null;
  for (const h of hulls) {
    if (h.v.length > 255 || h.n.length > 255 || h.edge.length / 4 > 255) return null;
    const ne = h.edge.length / 4;
    for (const fe of h.face) if (fe >= ne) return null;
    for (let k = 0; k < ne; k++) {
      const tw = k + ((h.edge[k * 4]! << 24) >> 24);
      if (
        h.edge[k * 4 + 1]! >= h.v.length ||
        h.edge[k * 4 + 2]! >= h.n.length ||
        h.edge[k * 4 + 3]! >= ne ||
        tw < 0 ||
        tw >= ne
      ) {
        return null;
      }
    }
  }
  const bodies: PhysBody[] = raw.map((b) => ({
    type: b.type,
    bone: b.bone,
    pos: [
      fround(b.pos[0] + shift[0]),
      fround(b.pos[1] + shift[1]),
      fround(b.pos[2] + shift[2]),
    ],
    gravity: b.g,
    inertia: b.inertia,
    linDamp: b.ld,
    angDamp: b.ad,
    carry: b.carry,
    group: b.group,
  }));
  const model: PhysModel = { mode, bodies, shapes, joints, hulls };
  const l = listing(model);
  // the client destroys a shared item by its entry list only (0x1011B5350): these
  // bodies would stay in the scene world for good
  if (mode !== 4 && l.unlisted.length > 0) return null;
  // nothing to simulate: no dynamic body writes a bone
  if (l.dynamicListed === 0) return null;
  return model;
}

/**
 * A .phys blob (starts SYHP on disk) -> the model the solver runs, or null: not a physics
 * file, PHYT 2, nothing to simulate, a PHAO carry override, a joint or shape the port
 * refuses, or a file that fails Eclipse's bounds checks. `shift` is the file's pivot shift
 * (added to the body positions, as Eclipse's encode does).
 */
export function parsePhys(
  bytes: Uint8Array,
  opts?: { shift?: [number, number, number] },
): PhysModel | null {
  if (bytes.length < 8 || bytes[0] !== 0x53 || bytes[1] !== 0x59 || bytes[2] !== 0x48 || bytes[3] !== 0x50) {
    return null;
  }
  try {
    return parseImpl(bytes, opts?.shift ?? [0, 0, 0]);
  } catch (e) {
    // a truncated record (DataView range) or a refused feature
    if (e instanceof RangeError || e instanceof Refuse) return null;
    throw e;
  }
}
