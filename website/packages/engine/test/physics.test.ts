// The physics core against Eclipse's own solver (src/eclipse/races/Physics.cpp, compiled
// unchanged; engine/test/golden/physics says how). Three layers of proof:
//
// 1. PARSE: parsePhys against Eclipse's midnight_physics_table encode + row, when the raw
//    file is cached (work/raw/12.1.0.69933, or PHYS_RAW_DIR); otherwise skipped, and says so.
// 2. LOGIC: the same source built with float = double and exact estimates is what this
//    port computes, so every output matrix of every frame must match BIT FOR BIT. Numeric
//    noise cannot cause a difference here and cannot hide one: a differing hash is a bug.
// 3. NUMBERS: against the float reference (what ships in the DLL). The system is chaotic,
//    so it is judged as Eclipse judges itself: no logic-gap jump (the difference growing by
//    30x or more in one frame from below 10 um) and a final error of the order of the C++
//    against ITSELF nudged by 1 ULP. BOUNDS below are stated per file.
//
// Regenerate: python engine/test/golden/physics/gen.py --eclipse <Eclipse repo>
// Run:        npx vitest run engine/test/physics.test.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import inspector from 'node:inspector';
import { PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  PhysInstance,
  PhysScene,
  parsePhys,
  type PhysFrame,
  type PhysModel,
} from '../src/physics/index';
import { Q, V3, rot } from '../src/physics/math';
import {
  ContactCache,
  Hull,
  Manifold,
  NR,
  capsuleCapsule,
  hullCapsule,
  hullHull,
} from '../src/physics/narrow';
import { Tree } from '../src/physics/tree';
import {
  HASH_SEED,
  bonesAt,
  camAt,
  emptyFrame,
  mixDouble,
  mixInt,
  motionTimes,
  placementAt,
  type MotionSpec,
} from './golden/physics/motion';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const RAW = process.env.PHYS_RAW_DIR ?? join(REPO, 'work', 'raw', '12.1.0.69933');
const DUMPS = join(REPO, 'work', 'physics-golden');

interface FixtureItem {
  fdid: number;
  join: number;
  leave: number;
  attached: boolean;
  pivots: number[];
  model: PhysModel;
}
interface Fixture {
  name: string;
  spec: MotionSpec;
  items: FixtureItem[];
  frames: number;
  motionHash: number;
  hash: { every: number; chain: number[] };
  bodies: [number, number][];
  nudgeFrame?: number;
  table?: { ts: Record<string, [number, number]>; yard: Record<string, [number, number]> };
  jumps?: { ts: number[][]; yard: number[][] };
  series?: { pos: number[]; rot: number[] };
  golden?: { frames: number[]; samples: (number[] | null)[][] };
}

/** Every number of a stored model is a float32 written in its shortest decimal. */
function f32Deep<T>(v: T): T {
  if (typeof v === 'number') return Math.fround(v) as unknown as T;
  if (Array.isArray(v)) return v.map(f32Deep) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = f32Deep(x);
    return o as T;
  }
  return v;
}

function load(name: string): Fixture {
  const f = JSON.parse(readFileSync(join(FIX, name), 'utf8')) as Fixture;
  for (const it of f.items) {
    it.model = f32Deep(it.model);
    it.pivots = f32Deep(it.pivots);
  }
  return f;
}

const fixtureNames = readdirSync(FIX)
  .filter((n) => n.startsWith('physics-golden-') && n.endsWith('.json'))
  .sort();
const fixtures = fixtureNames.map(load);

type OnFrame = (frame: number, out: Float64Array, valid: Uint8Array) => void;

/** The harness's main loop (harness.cpp): leave, join, drive in item order, step the scene. */
function run(f: Fixture, onFrame?: OnFrame): { chain: number[]; motionHash: number } {
  const times = motionTimes(f.spec);
  const P = new Float64Array(16);
  const items = f.items.map((it) => {
    const pivots = Float32Array.from(it.pivots);
    const bones = pivots.length / 3;
    const frame = emptyFrame(bones, pivots);
    frame.placement = P;
    return { it, bones, pivots, frame, inst: null as PhysInstance | null };
  });
  const total = f.items.reduce((n, it) => n + it.model.bodies.length, 0);
  const out = new Float64Array(total * 16);
  const valid = new Uint8Array(total);
  const scene = new PhysScene();
  let h = HASH_SEED;
  let mh = HASH_SEED;
  const chain: number[] = [];
  const nf = times.length;
  for (let fr = 0; fr < nf; fr++) {
    const { dt, t } = times[fr]!;
    placementAt(f.spec, t, P);
    const cam = camAt(f.spec, t);
    mh = mixDouble(mh, dt);
    mh = mixDouble(mh, cam);
    for (let k = 0; k < 16; k++) mh = mixDouble(mh, P[k]!);
    for (const s of items) {
      bonesAt(f.spec, t, P, s.pivots, s.bones, s.frame.boneWorld);
      if (f.spec.wobble !== 0) {
        for (let k = 0; k < s.bones * 16; k++) mh = mixDouble(mh, s.frame.boneWorld[k]!);
      }
      s.frame.dt = dt;
      s.frame.camDist2 = cam;
    }
    for (const s of items) {
      if (fr === s.it.leave && s.inst) {
        s.inst.dispose();
        s.inst = null;
      }
    }
    for (const s of items) {
      if (fr === s.it.join) s.inst = new PhysInstance(s.it.model, scene, s.it.attached);
    }
    for (const s of items) if (s.inst) s.inst.step(s.frame);
    scene.step(dt);
    let k = 0;
    for (const s of items) {
      const nb = s.it.model.bodies.length;
      for (let b = 0; b < nb; b++, k++) {
        const ok = s.inst !== null && s.inst.output(b, out, k * 16);
        valid[k] = ok ? 1 : 0;
        if (!ok) continue;
        h = mixInt(h, k);
        for (let m = 0; m < 12; m++) h = mixDouble(h, out[k * 16 + m]!);
      }
    }
    if ((fr + 1) % f.hash.every === 0 || fr + 1 === nf) chain.push(h >>> 0);
    onFrame?.(fr, out, valid);
  }
  for (const s of items) s.inst?.dispose();
  return { chain, motionHash: mh >>> 0 };
}

/** An M2's .phys: the inline PFDC, else the file PFID names. */
function physOfM2(raw: Uint8Array): Uint8Array | null {
  const d = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let o = 0;
  while (o + 8 <= raw.length) {
    const tag = String.fromCharCode(raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!);
    const n = d.getUint32(o + 4, true);
    if (tag === 'PFDC') return raw.subarray(o + 8, o + 8 + n);
    if (tag === 'PFID') {
      const p = join(RAW, String(d.getUint32(o + 8, true)));
      return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
    }
    o += 8 + n;
  }
  return null;
}

function rawModelBlob(fdid: number): Uint8Array | null {
  const p = join(RAW, String(fdid));
  return existsSync(p) ? physOfM2(new Uint8Array(readFileSync(p))) : null;
}

function logicGaps(dpos: number[], drot: number[]): number[][] {
  // physics_world_oracle.py's jumps(): from below 10 um, 30x or more in one frame
  const out: number[][] = [];
  for (let i = 1; i < dpos.length; i++) {
    const prev = Math.max(dpos[i - 1]!, drot[i - 1]! * 0.1, 1e-9);
    const cur = Math.max(dpos[i]!, drot[i]! * 0.1);
    if (cur > 1e-5 && prev < 1e-5 && cur / prev >= 30) out.push([i, prev, cur]);
  }
  return out;
}

describe('parsePhys', () => {
  const real = fixtures.filter((f) => !f.name.startsWith('synth-'));
  const seen = new Set<number>();
  for (const f of real) {
    for (const it of f.items) {
      if (seen.has(it.fdid)) continue;
      seen.add(it.fdid);
      const blob = rawModelBlob(it.fdid);
      it_or_skip(blob !== null, `matches Eclipse's row: ${it.fdid}`, () => {
        expect(parsePhys(blob!)).toEqual(it.model);
      });
    }
  }

  const sample = rawModelBlob(2053901);
  it_or_skip(sample !== null, 'adds the pivot shift to body positions', () => {
    const base = parsePhys(sample!)!;
    const moved = parsePhys(sample!, { shift: [1, 2, 3] })!;
    moved.bodies.forEach((b, i) => {
      const p = base.bodies[i]!.pos;
      expect(b.pos).toEqual([
        Math.fround(p[0] + 1),
        Math.fround(p[1] + 2),
        Math.fround(p[2] + 3),
      ]);
    });
    expect(moved.shapes).toEqual(base.shapes);
  });

  // Chunk surgery on a real file: tags are byte-reversed on disk
  function chunkAt(b: Uint8Array, tag: string): number {
    const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 0;
    while (o + 8 <= b.length) {
      const t = String.fromCharCode(b[o + 3]!, b[o + 2]!, b[o + 1]!, b[o]!);
      if (t === tag) return o;
      o += 8 + d.getUint32(o + 4, true);
    }
    return -1;
  }
  it_or_skip(sample !== null, 'refuses PHYT 2, PHAO, a bad joint, a truncated file, not-a-.phys', () => {
    const phyt2 = sample!.slice();
    const at = chunkAt(phyt2, 'PHYT');
    new DataView(phyt2.buffer).setUint32(at + 8, 2, true);
    expect(parsePhys(phyt2)).toBeNull();

    const phao = new Uint8Array(sample!.length + 12);
    const cut = chunkAt(sample!, 'PHYT'); // a chunk boundary: a blob can end in padding
    phao.set(sample!.subarray(0, cut));
    phao.set([0x4f, 0x41, 0x48, 0x50, 4, 0, 0, 0, 1, 0, 0, 0], cut); // PHAO, on disk OAHP
    phao.set(sample!.subarray(cut), cut + 12);
    expect(parsePhys(phao)).toBeNull();

    const badJoint = sample!.slice();
    const jat = chunkAt(badJoint, 'JOIN');
    new DataView(badJoint.buffer).setUint16(jat + 8 + 12, 5, true); // DSTJ
    expect(parsePhys(badJoint)).toBeNull();

    // cut inside CAPS: a capsule the file promised cannot be read
    expect(parsePhys(sample!.subarray(0, chunkAt(sample!, 'CAPS') + 18))).toBeNull();
    expect(parsePhys(new Uint8Array(32))).toBeNull();
  });
  it_or_skip(sample !== null, 'refuses a file with nothing to simulate', () => {
    const none = sample!.slice();
    const at = chunkAt(none, 'BDY4');
    const d = new DataView(none.buffer);
    const n = Math.floor(d.getUint32(at + 4, true) / 0x30);
    for (let i = 0; i < n; i++) d.setUint16(at + 8 + i * 0x30, 0, true); // every body kinematic
    expect(parsePhys(none)).toBeNull();
  });

  if (seen.size > 0 && !real.some((f) => f.items.some((it) => rawModelBlob(it.fdid)))) {
    console.info(`parse equality skipped: no raw files under ${RAW} (run gen.py to cache them)`);
  }

  function it_or_skip(have: boolean, name: string, fn: () => void): void {
    if (have) it(name, fn);
    else it.skip(`${name} (the raw file is not cached under ${RAW})`, fn);
  }
});

describe('solver: logic, bit for bit against the C++ with float = double, exact estimates', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const dumpPath = join(DUMPS, `${f.name}.double.bin`);
      const dump = existsSync(dumpPath) ? new Uint8Array(readFileSync(dumpPath)) : null;
      const D = dump ? new Float64Array(dump.buffer, dump.byteOffset + 8, (dump.length - 8) / 8) : null;
      let firstDiff: string | null = null;
      const total = f.items.reduce((n, it) => n + it.model.bodies.length, 0);
      const got = run(f, (fr, out, valid) => {
        if (!D || firstDiff) return;
        for (let k = 0; k < total; k++) {
          const o = (fr * total + k) * 13;
          if ((D[o]! !== 0) !== (valid[k] !== 0)) {
            firstDiff = `frame ${fr} body ${k}: valid ${valid[k]} vs C++ ${D[o]}`;
            return;
          }
          if (!valid[k]) continue;
          for (let m = 0; m < 12; m++) {
            const a = out[k * 16 + m]!;
            const b = D[o + 1 + m]!;
            if (a !== b) {
              firstDiff = `frame ${fr} body ${k} element ${m}: ${a} vs C++ ${b} (d ${a - b})`;
              return;
            }
          }
        }
      });
      expect(got.motionHash, 'the motion itself').toBe(f.motionHash);
      expect(firstDiff, 'first differing output').toBeNull();
      expect(got.chain).toEqual(f.hash.chain);
    });
  }
});

// The rare branches a scenario may never take, function by function, against the same
// build (harness.cpp Fuzz): the same generator, the same cases, the same bits.
describe('narrowphase and broadphase tree: fuzz, bit for bit', () => {
  it('every hull pair, capsule and tree operation', () => {
    const fz = JSON.parse(readFileSync(join(FIX, 'physics-fuzz.json'), 'utf8')) as {
      seed: number;
      cases: number;
      ops: number;
      hulls: PhysModel['hulls'];
      chain: number[];
    };
    const v3 = (a: number[]): V3 => {
      const v = new V3();
      v.x = Math.fround(a[0]!);
      v.y = Math.fround(a[1]!);
      v.z = Math.fround(a[2]!);
      return v;
    };
    const hulls = fz.hulls.map((h) => {
      const H = new Hull();
      H.centroid = v3(h.centroid);
      H.volume = Math.fround(h.volume);
      H.area = Math.fround(h.area);
      H.v = h.v.map(v3);
      H.n = h.n.map(v3);
      H.d = h.d.map(Math.fround);
      H.face = Uint8Array.from(h.face);
      H.edge = Uint8Array.from(h.edge);
      return H;
    });
    const rad = hulls.map((H) => {
      let r2 = 0;
      for (const p of H.v) {
        const x = p.x - H.centroid.x;
        const y = p.y - H.centroid.y;
        const z = p.z - H.centroid.z;
        const d2 = x * x + y * y + z * z;
        if (d2 > r2) r2 = d2;
      }
      return Math.sqrt(r2);
    });
    let rs = fz.seed >>> 0;
    const rnd = (): number => {
      rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0;
      return (rs >>> 8) / 16777216;
    };
    const rnd2 = (): number => rnd() * 2 - 1;
    const rv = (k: number): V3 => {
      const v = new V3();
      v.x = rnd2() * k;
      v.y = rnd2() * k;
      v.z = rnd2() * k;
      return v;
    };
    const normV = (v: V3): void => {
      const k = 1 / Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      v.x *= k;
      v.y *= k;
      v.z *= k;
    };
    const normQ = (q: Q): void => {
      const k = 1 / Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      q.x *= k;
      q.y *= k;
      q.z *= k;
      q.w *= k;
    };
    let h = HASH_SEED;
    const hashM = (m: Manifold, c: ContactCache): void => {
      h = mixInt(h, m.n);
      if (m.n > 0) {
        h = mixDouble(h, m.normal.x);
        h = mixDouble(h, m.normal.y);
        h = mixDouble(h, m.normal.z);
        for (let i = 0; i < m.n; i++) {
          const p = m.pt[i]!;
          h = mixDouble(h, p.p.x);
          h = mixDouble(h, p.p.y);
          h = mixDouble(h, p.p.z);
          h = mixDouble(h, p.sep);
          h = mixInt(h, p.key);
        }
      }
      h = mixDouble(h, c.metric);
      for (let i = 0; i < 4; i++) {
        h = mixInt(h, c.a[i]!);
        h = mixInt(h, c.b[i]!);
      }
      h = mixDouble(h, c.satSep);
      h = mixInt(h, c.satA);
      h = mixInt(h, c.satB);
      h = mixInt(h, c.satType);
    };
    const chain: number[] = [];
    const nh = hulls.length;
    const m = new Manifold();
    for (let c = 0; c < fz.cases; c++) {
      const ia = Math.floor(rnd() * nh);
      const ib = Math.floor(rnd() * nh);
      const A = hulls[ia]!;
      const B = hulls[ib]!;
      const Ra = rad[ia]!;
      const Rb = rad[ib]!;
      {
        const q = new Q();
        q.x = rnd2();
        q.y = rnd2();
        q.z = rnd2();
        q.w = rnd2();
        normQ(q);
        const d = rv(1);
        normV(d);
        const dist = (Ra + Rb) * (0.2 + 0.9 * rnd());
        const rb = new V3();
        rot(rb, q, B.centroid);
        const p = new V3();
        p.x = A.centroid.x + d.x * dist - rb.x;
        p.y = A.centroid.y + d.y * dist - rb.y;
        p.z = A.centroid.z + d.z * dist - rb.z;
        const cache = new ContactCache();
        for (let it = 0; it < 4; it++) {
          hullHull(A, B, q, p, m, cache);
          hashM(m, cache);
          const e = it === 0 ? 0.0005 : it === 1 ? 0.003 : 0.02;
          q.x += e * rnd2();
          q.y += e * rnd2();
          q.z += e * rnd2();
          q.w += e * rnd2();
          normQ(q);
          p.x += e * rnd2();
          p.y += e * rnd2();
          p.z += e * rnd2();
        }
      }
      {
        const dir = rv(1);
        normV(dir);
        const sc = Ra * (0.1 + 1.2 * rnd());
        const r = 0.01 + 0.08 * rnd();
        const c1 = new V3();
        c1.x = A.centroid.x + dir.x * sc;
        c1.y = A.centroid.y + dir.y * sc;
        c1.z = A.centroid.z + dir.z * sc;
        const ax = rv(1);
        normV(ax);
        const len = Ra * 2 * rnd();
        const c2 = new V3();
        c2.x = c1.x + ax.x * len;
        c2.y = c1.y + ax.y * len;
        c2.z = c1.z + ax.z * len;
        const cache = new ContactCache();
        for (let it = 0; it < 4; it++) {
          NR.r = r;
          hullCapsule(A, c1, c2, m, cache);
          hashM(m, cache);
          const e = it === 0 ? 0.0005 : it === 1 ? 0.003 : 0.02;
          c1.x += e * rnd2();
          c1.y += e * rnd2();
          c1.z += e * rnd2();
          c2.x += e * rnd2();
          c2.y += e * rnd2();
          c2.z += e * rnd2();
        }
      }
      {
        const a1 = rv(0.3);
        const a2 = new V3();
        a2.x = a1.x + rnd2() * 0.3;
        a2.y = a1.y + rnd2() * 0.3;
        a2.z = a1.z + rnd2() * 0.3;
        const b1 = rv(0.3);
        const b2 = new V3();
        b2.x = b1.x + rnd2() * 0.3;
        b2.y = b1.y + rnd2() * 0.3;
        b2.z = b1.z + rnd2() * 0.3;
        const kind = Math.floor(rnd() * 5);
        const kk = 0.5 + rnd();
        const ox = rnd2() * 0.05;
        const oy = rnd2() * 0.05;
        const oz = rnd2() * 0.05;
        const tx = rnd2() * 0.002;
        const ty = rnd2() * 0.002;
        const tz = rnd2() * 0.002;
        if (kind === 1) {
          b1.x = a1.x + ox;
          b1.y = a1.y + oy;
          b1.z = a1.z + oz;
          b2.x = b1.x + (a2.x - a1.x) * kk + tx;
          b2.y = b1.y + (a2.y - a1.y) * kk + ty;
          b2.z = b1.z + (a2.z - a1.z) * kk + tz;
        } else if (kind === 2) {
          b1.x = a2.x;
          b1.y = a2.y;
          b1.z = a2.z;
        } else if (kind === 3) {
          a2.x = a1.x;
          a2.y = a1.y;
          a2.z = a1.z;
        } else if (kind === 4) {
          b2.x = b1.x;
          b2.y = b1.y;
          b2.z = b1.z;
        }
        NR.ra = 0.01 + 0.2 * rnd();
        NR.rb = 0.01 + 0.2 * rnd();
        capsuleCapsule(a1, a2, b1, b2, m);
        hashM(m, new ContactCache());
      }
      if ((c + 1) % 512 === 0 || c + 1 === fz.cases) chain.push(h >>> 0);
    }
    const t = new Tree();
    const live: number[] = [];
    const lo = new V3();
    const hi = new V3();
    const box = (cx: number, cy: number, cz: number, w: number): void => {
      lo.x = cx - w;
      lo.y = cy - w;
      lo.z = cz - w;
      hi.x = cx + w;
      hi.y = cy + w;
      hi.z = cz + w;
    };
    for (let op = 0; op < fz.ops; op++) {
      const k = rnd();
      if (k < 0.3 || live.length === 0) {
        const cx = rnd2();
        const cy = rnd2();
        const cz = rnd2();
        const w = 0.01 + 0.2 * rnd();
        box(cx, cy, cz, w);
        const id = t.create(lo, hi);
        h = mixInt(h, id);
        live.push(id);
      } else if (k < 0.42) {
        const i = Math.floor(rnd() * live.length);
        t.destroy(live[i]!);
        live[i] = live[live.length - 1]!;
        live.pop();
      } else if (k < 0.85) {
        const i = Math.floor(rnd() * live.length);
        const n = t.n[live[i]!]!;
        const far = rnd() < 0.3 ? 1 : 0.05;
        const cx = (n.lx + n.hx) * 0.5 + rnd2() * far;
        const cy = (n.ly + n.hy) * 0.5 + rnd2() * far;
        const cz = (n.lz + n.hz) * 0.5 + rnd2() * far;
        const w = 0.01 + 0.3 * rnd();
        box(cx, cy, cz, w);
        h = mixInt(h, t.move(live[i]!, lo, hi) ? 1 : 0);
      } else {
        t.optimize(1 + Math.floor(rnd() * 10));
      }
      h = mixInt(h, t.root);
      h = mixInt(h, t.count);
      h = mixInt(h, t.freeHead);
      h = mixInt(h, t.proxies);
      h = mixInt(h, t.cursor);
      if (op % 16 === 0) {
        for (let i = 0; i < t.cap; i++) {
          const n = t.n[i]!;
          h = mixDouble(h, n.lx);
          h = mixDouble(h, n.hx);
          h = mixDouble(h, n.ly);
          h = mixDouble(h, n.hy);
          h = mixDouble(h, n.lz);
          h = mixDouble(h, n.hz);
          h = mixInt(h, n.parent);
          h = mixInt(h, n.c1);
          h = mixInt(h, n.c2);
          h = mixInt(h, n.height);
        }
      }
      if ((op + 1) % 2048 === 0 || op + 1 === fz.ops) chain.push(h >>> 0);
    }
    expect(chain).toEqual(fz.chain);
  }, 60000);
});

// The C++ float reference against this port: the bound of each file is 10 x the C++ against
// ITSELF nudged 1 ULP at 16 s (position m, angle rad, gen.py's "yard"): "the yardstick's
// order of magnitude", stated, never loosened to hide a difference. pair saturates: the two
// items collide across the shared world, and 1 ULP alone moves them 0.26 m / 2.8 rad.
const BOUNDS: Record<string, { pos: number; ang: number }> = {
  '2053901': { pos: 0.11, ang: 0.72 },
  '4497847': { pos: 7.3e-4, ang: 0.029 },
  '5653229': { pos: 9.8e-6, ang: 1.6e-4 },
  '1267671': { pos: 7.6e-5, ang: 2.9e-4 },
  '1323353': { pos: 4.6e-4, ang: 3.9e-3 },
  '1251460': { pos: 3.7e-4, ang: 3.2e-3 },
  '7547983': { pos: 5.1e-4, ang: 7.3e-3 },
  pair: { pos: 2.6, ang: Math.PI },
  '5653268': { pos: 1.9e-4, ang: 2.5e-3 },
  '5425295': { pos: 0.056, ang: 0.55 },
  '6032612': { pos: 2.9e-4, ang: 3.3e-3 },
};

describe('solver: numbers, against the float reference', () => {
  const report: string[] = [];
  for (const f of fixtures) {
    if (!f.golden || !f.table) continue;
    it(f.name, () => {
      const g = f.golden!;
      const times = motionTimes(f.spec);
      const sampled = new Map<number, number>();
      g.frames.forEach((fr, i) => sampled.set(fr, i));
      const live = f.bodies.map(([item, body]) => {
        let k = body;
        for (let i = 0; i < item; i++) k += f.items[i]!.model.bodies.length;
        const it = f.items[item]!;
        const bone = it.model.bodies[body]!.bone;
        const has = bone < it.pivots.length / 3;
        return {
          k,
          px: has ? it.pivots[bone * 3]! : 0,
          py: has ? it.pivots[bone * 3 + 1]! : 0,
          pz: has ? it.pivots[bone * 3 + 2]! : 0,
        };
      });
      const upto = { 1: [0, 0], 4: [0, 0], 16: [0, 0] } as Record<number, [number, number]>;
      run(f, (fr, out, valid) => {
        const si = sampled.get(fr);
        if (si === undefined) return;
        const t = times[fr]!.t;
        const row = g.samples[si]!;
        let wp = 0;
        let wa = 0;
        live.forEach((b, i) => {
          const s = row[i];
          if (!s || !valid[b.k]) return;
          const o = b.k * 16;
          const m = out;
          const x = m[o]! * b.px + m[o + 1]! * b.py + m[o + 2]! * b.pz + m[o + 3]!;
          const y = m[o + 4]! * b.px + m[o + 5]! * b.py + m[o + 6]! * b.pz + m[o + 7]!;
          const z = m[o + 8]! * b.px + m[o + 9]! * b.py + m[o + 10]! * b.pz + m[o + 11]!;
          wp = Math.max(wp, Math.hypot(x - s[0]!, y - s[1]!, z - s[2]!));
          // the rotation difference, through the stored quaternion (w >= 0)
          const qx = s[3]!;
          const qy = s[4]!;
          const qz = s[5]!;
          const qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
          const r00 = 1 - 2 * (qy * qy + qz * qz);
          const r01 = 2 * (qx * qy - qw * qz);
          const r02 = 2 * (qx * qz + qw * qy);
          const r10 = 2 * (qx * qy + qw * qz);
          const r11 = 1 - 2 * (qx * qx + qz * qz);
          const r12 = 2 * (qy * qz - qw * qx);
          const r20 = 2 * (qx * qz - qw * qy);
          const r21 = 2 * (qy * qz + qw * qx);
          const r22 = 1 - 2 * (qx * qx + qy * qy);
          // the skew part of R_golden^T R_port
          const s12 =
            r00 * m[o + 1]! + r10 * m[o + 5]! + r20 * m[o + 9]! - (r01 * m[o]! + r11 * m[o + 4]! + r21 * m[o + 8]!);
          const s13 =
            r00 * m[o + 2]! + r10 * m[o + 6]! + r20 * m[o + 10]! - (r02 * m[o]! + r12 * m[o + 4]! + r22 * m[o + 8]!);
          const s23 =
            r01 * m[o + 2]! + r11 * m[o + 6]! + r21 * m[o + 10]! - (r02 * m[o + 1]! + r12 * m[o + 5]! + r22 * m[o + 9]!);
          wa = Math.max(wa, 0.5 * Math.hypot(s12, s13, s23));
        });
        for (const lim of [1, 4, 16]) {
          if (t <= lim) {
            const u = upto[lim]!;
            u[0] = Math.max(u[0], wp);
            u[1] = Math.max(u[1], wa);
          }
        }
      });
      const y = f.table!.yard;
      report.push(
        `${f.name.padEnd(9)} ` +
          [1, 4, 16]
            .map((s) => `${s}s ${upto[s]![0].toExponential(1)}m/${upto[s]![1].toExponential(1)}r`)
            .join(' ') +
          `  yard ` +
          ['1', '4', '16'].map((s) => `${s}s ${y[s]![0].toExponential(1)}/${y[s]![1].toExponential(1)}`).join(' '),
      );
      // the rule, over every frame: stored by gen.py as log10 x 100, re-judged here; and
      // the logic test above proves those frames are this port's
      const dpos = f.series!.pos.map((v) => 10 ** (v / 100));
      const drot = f.series!.rot.map((v) => 10 ** (v / 100));
      const gaps = logicGaps(dpos, drot);
      expect(gaps, `${f.name}: a logic-gap jump`).toEqual([]);
      const b = BOUNDS[f.name];
      expect(b, `${f.name} has a stated bound`).toBeDefined();
      // sampled here against the reference, and over every frame as gen.py measured it
      expect(upto[16]![0], `${f.name} position at 16 s`).toBeLessThanOrEqual(b!.pos);
      expect(upto[16]![1], `${f.name} angle at 16 s`).toBeLessThanOrEqual(b!.ang);
      expect(f.table!.ts['16']![0], `${f.name} position, every frame`).toBeLessThanOrEqual(b!.pos);
      expect(f.table!.ts['16']![1], `${f.name} angle, every frame`).toBeLessThanOrEqual(b!.ang);
    });
  }
  it('report', () => {
    console.info(`TS vs C++ float, worst up to t | C++ vs itself nudged 1 ULP\n${report.join('\n')}`);
  });
});

function byName(name: string): Fixture {
  const f = fixtures.find((x) => x.name === name);
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

interface Prepared {
  dt: Float64Array;
  P: Float64Array[];
  bones: Float64Array[][];
  frames: PhysFrame[];
  scene: PhysScene;
  insts: PhysInstance[];
  out: Float64Array;
  bodies: number;
}

function prepare(f: Fixture): Prepared {
  const times = motionTimes(f.spec);
  const P: Float64Array[] = [];
  const bones: Float64Array[][] = [];
  const pivots = f.items.map((it) => Float32Array.from(it.pivots));
  for (const { t } of times) {
    const p = new Float64Array(16);
    placementAt(f.spec, t, p);
    P.push(p);
    bones.push(
      f.items.map((it, i) => {
        const n = it.pivots.length / 3;
        const b = new Float64Array(n * 16);
        bonesAt(f.spec, t, p, pivots[i]!, n, b);
        return b;
      }),
    );
  }
  const scene = new PhysScene();
  const insts = f.items.map((it) => new PhysInstance(it.model, scene, it.attached));
  const frames = f.items.map((it, i) => emptyFrame(it.pivots.length / 3, pivots[i]!));
  return {
    dt: Float64Array.from(times.map((x) => x.dt)),
    P,
    bones,
    frames,
    scene,
    insts,
    out: new Float64Array(16),
    bodies: f.items.reduce((n, it) => n + it.model.bodies.length, 0),
  };
}

/** One frame of an item set, reusing every object: what an engine loop does. */
function stepAll(s: Prepared, i: number): void {
  const fi = i % s.dt.length;
  const dt = s.dt[fi]!;
  const n = s.insts.length;
  for (let k = 0; k < n; k++) {
    const fr = s.frames[k]!;
    fr.dt = dt;
    fr.camDist2 = 0;
    fr.placement = s.P[fi]!;
    fr.boneWorld = s.bones[fi]![k]!;
    s.insts[k]!.step(fr);
  }
  s.scene.step(dt);
}

function readOutputs(s: Prepared, f: Fixture): void {
  const n = s.insts.length;
  for (let k = 0; k < n; k++) {
    const nb = f.items[k]!.model.bodies.length;
    for (let b = 0; b < nb; b++) s.insts[k]!.output(b, s.out, 0);
  }
}

describe('performance', () => {
  const gcFn = (() => {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc') as () => void;
  })();

  /** Every allocation while run() runs, kept or already collected: heap growth alone would
   *  miss what a scavenge collects, and a double boxed per call is exactly such garbage. */
  async function allocationsIn(run: () => void): Promise<Map<string, number>> {
    const session = new inspector.Session();
    session.connect();
    const post = (method: string, params?: object): Promise<any> =>
      new Promise((res, rej) =>
        session.post(method as 'HeapProfiler.enable', params as never, (e, r) => (e ? rej(e) : res(r))),
      );
    await post('HeapProfiler.startSampling', {
      samplingInterval: 256,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    run();
    const { profile } = await post('HeapProfiler.stopSampling');
    session.disconnect();
    const sites = new Map<string, number>();
    const walk = (n: any): void => {
      if (n.selfSize > 0 && /src[\\/]physics[\\/]/.test(n.callFrame.url)) {
        const k = n.callFrame.functionName || '(anon)';
        sites.set(k, (sites.get(k) ?? 0) + n.selfSize);
      }
      for (const c of n.children) walk(c);
    };
    walk(profile.head);
    return sites;
  }

  // PHYS_PERF=full: the heavier files and longer runs; the numbers quoted for this core
  const full = process.env.PHYS_PERF === 'full';
  const SETTLE = full ? 40000 : 12000;
  const TIMED = full ? 8000 : 2000;
  const STEPS = full ? 40000 : 8000;
  for (const name of full ? ['2053901', '1323353', 'pair', '5425295', '4497847'] : ['2053901', 'pair']) {
    it(`${name}: step cost and bytes per step`, async () => {
      const f = byName(name);
      const s = prepare(f);
      // settle: past the JIT's tiers and the pools' high-water marks
      for (let i = 0; i < SETTLE; i++) {
        stepAll(s, i);
        readOutputs(s, f);
      }
      // the cost of one frame, every item + the scene step + reading every output
      const times = new Float64Array(TIMED);
      const clock = performance;
      for (let i = 0; i < TIMED; i++) {
        const a = clock.now();
        stepAll(s, i);
        readOutputs(s, f);
        times[i] = clock.now() - a;
      }
      times.sort();
      let sum = 0;
      for (let i = 0; i < TIMED; i++) sum += times[i]!;
      const meanUs = (sum / TIMED) * 1000;
      const p99Us = times[Math.floor(TIMED * 0.99)]! * 1000;
      const worstUs = times[TIMED - 1]! * 1000;
      // allocation: what the physics allocated, by the sampling profiler
      const sites = await allocationsIn(() => {
        for (let i = 0; i < STEPS; i++) {
          stepAll(s, i);
          readOutputs(s, f);
        }
      });
      let bytes = 0;
      for (const v of sites.values()) bytes += v;
      const perStep = bytes / STEPS;
      // and the collector's own word, clock-free: its events over a long run, and the
      // heap's growth, which only means something when none fell inside
      gcFn();
      let gcs = 0;
      const obs = new PerformanceObserver((l) => {
        gcs += l.getEntries().length;
      });
      obs.observe({ entryTypes: ['gc'] });
      await new Promise((r) => setTimeout(r, 10));
      gcs = 0;
      const h0 = process.memoryUsage().heapUsed;
      const c0 = clock.now();
      for (let i = 0; i < STEPS; i++) {
        stepAll(s, i);
        readOutputs(s, f);
      }
      const c1 = clock.now();
      const h1 = process.memoryUsage().heapUsed;
      await new Promise((r) => setTimeout(r, 10));
      obs.disconnect();
      const bodies = f.items.reduce((n, it) => n + it.model.bodies.length, 0);
      console.info(
        `${name}: ${bodies} bodies, ${(((c1 - c0) / STEPS) * 1000).toFixed(1)} us/frame clock-free; ` +
          `timed mean ${meanUs.toFixed(1)}, p99 ${p99Us.toFixed(0)}, worst ${worstUs.toFixed(0)} us; ` +
          `${perStep.toFixed(2)} B/frame allocated by the physics ` +
          `${JSON.stringify([...sites].map(([k, v]) => [k, Math.round(v / STEPS)]).filter((x) => (x[1] as number) > 0))}; ` +
          `${gcs} GC events and ${((h1 - h0) / STEPS).toFixed(2)} B/frame heap growth over ${STEPS} frames`,
      );
      // Under one HeapNumber a frame. Not 0 because a function hit too rarely to tier up
      // (an edge contact's edgeHull, reduce) still runs in the interpreter, whose temporaries
      // box; everything hot is optimised and allocates nothing. The collector confirms it.
      expect(perStep, 'bytes per frame allocated inside src/physics').toBeLessThan(16);
      expect(gcs, 'GC events over the run').toBeLessThanOrEqual(4);
      expect(meanUs).toBeLessThan(2000);
    }, 240000);
  }
});
