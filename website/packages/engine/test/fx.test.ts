/**
 * The particle and ribbon simulations against the client's own step, written out here
 * from CParticleEmitter2::MoveParticle and CRibbonEmitter::Update (Saty's 3.3.5 source).
 * A wrong axis or a wrong sign in these is an explosion on screen.
 */
import { describe, expect, it } from "vitest";
import type { FxParticle, FxRibbon } from "@eclipse/format";
import { FX_CLOCK, INSTANCE_STRIDE, ParticleEmitterSim, SplinePath, curveAt } from "../src/render/particlesSim";
import { RIBBON_STRIDE, RibbonEmitterSim } from "../src/render/ribbonsSim";

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** Scaled and turned: whole numbers fit a tagged integer and would hide any boxing. */
const POSED = new Float32Array([0.7, 0.3, 0.1, 0, -0.3, 0.7, 0.2, 0, 0.1, -0.2, 0.75, 0, 1.5, 2.25, -0.75, 1]);
const HEAD = 0x20000;

function emitter(over: Partial<FxParticle>): ParticleEmitterSim {
  const data: FxParticle = {
    flags: HEAD,
    bone: 0,
    pos: [0, 0, 0],
    type: 1,
    blend: 4,
    tex: [0],
    wrap: [0],
    color: { t: [], v: [[255, 128, 0]] },
    alpha: { t: [], v: [1] },
    scale: { t: [], v: [[1, 1]] },
    life: 1,
    rate: 100,
    speed: 2,
    ...over,
  };
  return new ParticleEmitterSim(data, [], { groundY: 0, seed: 12345 });
}

function tick(sim: ParticleEmitterSim, dt: number, b: ArrayLike<number> = IDENTITY): void {
  sim.setTransform(b);
  sim.frameDt = dt;
  sim.update();
}

function run(sim: ParticleEmitterSim, seconds: number, dt = 1 / 60, b: ArrayLike<number> = IDENTITY): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) tick(sim, dt, b);
}

describe("life curves", () => {
  const out = new Float32Array(3);
  it("two values ignore their times", () => {
    curveAt({ t: [0.9, 0.95], v: [0, 10] }, 0.5, out, 1);
    expect(out[0]).toBeCloseTo(5);
  });
  it("three values read only the middle time", () => {
    const c = { t: [0, 0.25, 1], v: [0, 1, 0] };
    curveAt(c, 0.125, out, 1);
    expect(out[0]).toBeCloseTo(0.5);
    curveAt(c, 0.625, out, 1);
    expect(out[0]).toBeCloseTo(0.5);
  });
  it("more search their keys and hold past the ends", () => {
    const c = { t: [0.1, 0.2, 0.4, 0.8], v: [1, 2, 3, 4] };
    curveAt(c, 0.05, out, 1);
    expect(out[0]).toBeCloseTo(1);
    curveAt(c, 0.3, out, 1);
    expect(out[0]).toBeCloseTo(2.5);
    curveAt(c, 0.95, out, 1);
    expect(out[0]).toBeCloseTo(4);
  });
  it("vectors interpolate per channel", () => {
    curveAt({ t: [0, 1], v: [[0, 10, 20], [10, 20, 30]] }, 0.5, out, 3);
    expect([...out]).toEqual([5, 15, 25]);
  });
});

describe("a plane emitter", () => {
  it("moves exactly as MoveParticle steps it", () => {
    const g = 9.5;
    const drag = 0.8;
    const dt = 1 / 60;
    const sim = emitter({ rate: 60, gravity: g, drag, speed: 3, lat: 0, life: 10 });
    tick(sim, dt);
    expect(sim.live).toBeGreaterThan(0);
    // The first particle's first step, then the client's own loop.
    const first = sim.particle(0);
    let vy = first.vy;
    let y = first.y;
    // Born going up: local Z is the engine's +Y, retail's up.
    expect(first.vx).toBeCloseTo(0, 5);
    expect(first.vz).toBeCloseTo(0, 5);
    for (let i = 0; i < 120; i++) {
      y = y + vy * dt - g * dt * dt * 0.5;
      vy = vy - g * dt;
      vy = vy - Math.min(1, dt * drag) * vy;
      tick(sim, dt);
    }
    const now = sim.particle(0);
    expect(now.y).toBeCloseTo(y, 3);
    expect(now.vy).toBeCloseTo(vy, 3);
  });

  it("spawns across its area in the emitter's frame, turned by the client's R", () => {
    const sim = emitter({ width: 2, length: 4, speed: 0, rate: 600, life: 10 });
    run(sim, 0.5);
    let xMax = 0;
    let yMax = 0;
    let zMax = 0;
    for (let i = 0; i < sim.live; i++) {
      const p = sim.particle(i);
      xMax = Math.max(xMax, Math.abs(p.x));
      yMax = Math.max(yMax, Math.abs(p.y));
      zMax = Math.max(zMax, Math.abs(p.z));
    }
    // Local x -> engine x, local y -> engine -z, local z (plane normal) -> engine y.
    expect(xMax).toBeGreaterThan(0.9);
    expect(xMax).toBeLessThanOrEqual(1);
    expect(zMax).toBeGreaterThan(1.9);
    expect(zMax).toBeLessThanOrEqual(2);
    expect(yMax).toBeLessThan(1e-6);
  });

  it("emits at the rate, and holds rate x life alive", () => {
    const sim = emitter({ rate: 100, life: 1 });
    run(sim, 3);
    expect(sim.live).toBeGreaterThan(90);
    expect(sim.live).toBeLessThan(110);
  });

  it("stops when invisible, and what lives finishes", () => {
    const sim = emitter({ rate: 100, life: 0.5, visible: { clips: { "*": [[0, 1000], [1, 0]] }, hold: true } });
    sim.setClip("*");
    sim.setTransform(IDENTITY);
    FX_CLOCK[0] = 500;
    sim.updateParams();
    run(sim, 0.4);
    expect(sim.live).toBeGreaterThan(10);
    FX_CLOCK[0] = 1500;
    sim.updateParams();
    run(sim, 1);
    expect(sim.live).toBe(0);
    expect(sim.active).toBe(false);
  });

  it("a burst fires once per show of the track", () => {
    const sim = emitter({ flags: HEAD | 0x8000, rate: 25, life: 10 });
    run(sim, 1);
    expect(sim.live).toBe(25);
  });

  it("packed gravity keeps its sideways part, in the engine's axes", () => {
    const sim = emitter({ gravity: [1, 2, -3], speed: 0, rate: 60, life: 10 });
    const dt = 1 / 60;
    run(sim, 1, dt);
    const p = sim.particle(0);
    // Retail (x, y, z) reads as (y, z, x).
    expect(p.vx / p.vy).toBeCloseTo(2 / -3, 3);
    expect(p.vz / p.vy).toBeCloseTo(1 / -3, 3);
  });

  it("wind stops at its age", () => {
    const sim = emitter({ wind: [0, 6, 0, 0.5], speed: 0, rate: 60, life: 10 });
    run(sim, 2);
    let oldest = sim.particle(0);
    for (let i = 1; i < sim.live; i++) if (sim.particle(i).age > oldest.age) oldest = sim.particle(i);
    expect(oldest.vx).toBeCloseTo(3, 0);
  });

  it("a local emitter stays local, and its matrix carries the bone", () => {
    const b = new Float32Array(IDENTITY);
    b[12] = 5;
    const sim = emitter({ flags: HEAD | 0x10, pos: [1, 0, 0], speed: 0, rate: 60, life: 10 });
    run(sim, 0.2, 1 / 60, b);
    expect(Math.abs(sim.particle(0).x)).toBeLessThan(1e-6);
    expect(sim.xform[12]).toBeCloseTo(6);
    // World space takes the position.
    const world = emitter({ pos: [1, 0, 0], speed: 0, rate: 60, life: 10 });
    run(world, 0.2, 1 / 60, b);
    expect(world.particle(0).x).toBeCloseTo(6);
  });

  it("a particle does not follow a world-space emitter once born", () => {
    const sim = emitter({ speed: 0, rate: 60, life: 10 });
    run(sim, 0.1);
    const x = sim.particle(0).x;
    const moved = new Float32Array(IDENTITY);
    moved[12] = 10;
    run(sim, 0.1, 1 / 60, moved);
    expect(sim.particle(0).x).toBeCloseTo(x, 6);
  });

  it("flag 0x800 spreads spawns along the path the bone took", () => {
    const sim = emitter({ flags: HEAD | 0x800, speed: 0, rate: 3000, life: 10 });
    tick(sim, 1 / 60);
    const moved = new Float32Array(IDENTITY);
    moved[12] = 10;
    tick(sim, 1 / 60, moved);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < sim.live; i++) {
      lo = Math.min(lo, sim.particle(i).x);
      hi = Math.max(hi, sim.particle(i).x);
    }
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(9);
  });

  it("a long frame runs as steps of a tenth of a second", () => {
    const sim = emitter({ speed: 0, gravity: 10, rate: 30, life: 100 });
    tick(sim, 0.05);
    const before = sim.particle(0);
    tick(sim, 0.35);
    const after = sim.particle(0);
    expect(after.age - before.age).toBeCloseTo(0.35, 4);
  });
});

describe("a display's ParticleColor", () => {
  it("replaces the curve's three keys", () => {
    const out = new Float32Array(3);
    const c = { t: [0, 0.25, 1], v: [[255, 0, 0], [0, 255, 0], [0, 0, 255]] as [number, number, number][] };
    curveAt(c, 0.25, out, 3);
    expect([...out]).toEqual([0, 255, 0]);
  });
});

describe("a sphere emitter", () => {
  it("keeps to its radii and pushes outward", () => {
    const sim = emitter({ type: 2, width: 1, length: 2, lat: Math.PI / 2, lon: Math.PI, speed: 1, rate: 300, life: 10 });
    run(sim, 0.1);
    for (let i = 0; i < sim.live; i++) {
      const p = sim.particle(i);
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThan(0.95);
      expect(r).toBeLessThan(2.3);
      expect(p.x * p.vx + p.y * p.vy + p.z * p.vz).toBeGreaterThan(0);
    }
  });
  it("0x80 ends a particle at the centre", () => {
    const sim = emitter({ flags: HEAD | 0x80, type: 2, width: 1, length: 1, lat: Math.PI / 2, lon: Math.PI, speed: -2, rate: 200, life: 10 });
    run(sim, 2);
    // Each lives 0.5 s to the centre, so far fewer than the 400 emitted are left.
    expect(sim.live).toBeGreaterThan(50);
    expect(sim.live).toBeLessThan(150);
  });
});

describe("what the GPU reads", () => {
  it("flipbook cells follow the head curve, colour and size the life curves", () => {
    const sim = emitter({
      rows: 2,
      cols: 2,
      head: { t: [0, 1], v: [0, 3] },
      scale: { t: [0, 1], v: [[1, 1], [3, 3]] },
      color: { t: [0, 1], v: [[0, 0, 0], [255, 255, 255]] },
      alpha: { t: [0, 1], v: [1, 0] },
      speed: 0,
      rate: 10,
      life: 1,
    });
    const out = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    run(sim, 0.8, 0.01);
    const n = sim.write(out);
    expect(n).toBeGreaterThan(0);
    let found = false;
    for (let i = 0; i < n; i++) {
      const o = i * INSTANCE_STRIDE;
      const age = sim.particle(i).age;
      expect(out[o + 12]).toBeCloseTo(1 + 2 * age, 1);
      expect(out[o + 8]).toBeCloseTo(age, 1);
      expect(out[o + 11]).toBeCloseTo(1 - age, 1);
      const cell = Math.floor(age * 3 + 1e-3);
      const u = out[o + 14]!;
      const v = out[o + 15]!;
      expect([0, 0.5]).toContain(u);
      expect([0, 0.5]).toContain(v);
      if (age > 0.7) {
        expect(u * 2 + v * 4).toBeCloseTo(cell, 0);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("sorts far to near for flag 2", () => {
    const sim = emitter({ flags: HEAD | 2, speed: 1, rate: 200, life: 10, lat: 1.2, lon: Math.PI });
    run(sim, 0.5);
    const out = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    // Depth is the engine's z: drawn from the most negative up.
    sim.viewZ[2] = 1;
    const n = sim.write(out);
    for (let i = 1; i < n; i++) expect(out[i * INSTANCE_STRIDE + 2]).toBeGreaterThanOrEqual(out[(i - 1) * INSTANCE_STRIDE + 2]!);
  });

  it("three-texture layers scroll and stay in 0..1", () => {
    const sim = emitter({ flags: HEAD | 0x10000000, multi: { mat: 1, scale: [1, 2], p0: [1, 0, 0, -1], p1: [0, 0, 0, 0], colorMult: 1 } });
    run(sim, 2);
    const out = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    const n = sim.write(out);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      for (let k = 20; k < 24; k++) {
        const v = out[i * INSTANCE_STRIDE + k]!;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the cutoff comes through, and no NaN ever reaches the buffer", () => {
    const sim = emitter({ cut: { t: [0, 1], v: [0.5, 0.5] }, gravity: 3, drag: 0.5, lat: 1, lon: 3 });
    run(sim, 2);
    const out = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    const n = sim.write(out);
    for (let i = 0; i < n * INSTANCE_STRIDE; i++) expect(Number.isFinite(out[i])).toBe(true);
    expect(out[18]).toBeCloseTo(0.5);
  });

  it("allocates nothing while it runs", () => {
    const sim = emitter({ rate: 500, life: 2, gravity: 2, drag: 0.5, head: { t: [0, 1], v: [0, 3] }, rows: 2, cols: 2, lat: 1, lon: 3 });
    const out = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    sim.frameDt = 1 / 60;
    const frame = () => {
      sim.setTransform(POSED);
      sim.updateParams();
      sim.update();
      sim.write(out);
    };
    // Warm up the tiers: an interpreter boxes doubles, optimised code does not.
    for (let i = 0; i < 20000; i++) frame();
    const samples: number[] = [];
    for (let s = 0; s < 8; s++) {
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 2000; i++) frame();
      const after = process.memoryUsage().heapUsed;
      samples.push((after - before) / 2000);
    }
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1]!;
    const started = performance.now();
    for (let i = 0; i < 2000; i++) frame();
    const us = ((performance.now() - started) / 2000) * 1000;
    console.log(`particles: ${median.toFixed(2)} bytes and ${us.toFixed(0)} us per frame at ${sim.live} live`);
    expect(median).toBeLessThan(16);
    // Tens of thousands of frames: past the default 5 s when every test file runs at once.
  }, 30_000);
});

describe("a spline path", () => {
  it("walks by arc length, end to end", () => {
    const s = new SplinePath([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    s.at(0);
    expect(s.x).toBeCloseTo(0);
    s.at(0.5);
    expect(s.x).toBeCloseTo(1.5, 1);
    s.at(1);
    expect(s.x).toBeCloseTo(3);
    expect(s.tx).toBeCloseTo(1);
  });
});

function ribbon(over: Partial<FxRibbon>): RibbonEmitterSim {
  const data: FxRibbon = {
    bone: 0,
    pos: [0, 0, 0],
    tex: [0],
    wrap: [0],
    mats: [{ blend: 4, flags: 1 }],
    edgesPerSec: 30,
    lifetime: 0.5,
    above: 0.5,
    below: 0.25,
    ...over,
  };
  return new RibbonEmitterSim(data, []);
}

/** Travelling along the engine's Z, away from the ribbon's span. */
function moving(z: number): Float32Array {
  const b = new Float32Array(IDENTITY);
  b[14] = z;
  return b;
}

function step(r: RibbonEmitterSim, b: ArrayLike<number>, dt: number): void {
  r.setPos(b);
  r.frameDt = dt;
  r.update();
}

describe("a ribbon", () => {
  it("lays edges at the emitter's rate and ages them out", () => {
    const r = ribbon({});
    let t = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      t += dt;
      step(r, moving(t), dt);
    }
    // 30 per second, alive 0.5 s.
    expect(r.segments).toBeGreaterThan(12);
    expect(r.segments).toBeLessThanOrEqual(r.edges - 1);
    // The ring has wrapped by now and is still continuous along the path.
    const v = r.vertices;
    let i = r.readPos;
    let last = -Infinity;
    for (let k = 0; k < r.segments; k++) {
      const z = v[i * 2 * RIBBON_STRIDE + 2]!;
      expect(z).toBeGreaterThan(last);
      last = z;
      i = (i + 1) % r.edges;
    }
    expect(last).toBeGreaterThan(t - 0.1);
    expect(v[r.readPos * 2 * RIBBON_STRIDE + 2]).toBeGreaterThan(t - 0.6);
  });

  it("spans above and below along the bone's retail Y, which is the engine's X", () => {
    const r = ribbon({ above: 0.5, below: 0.25 });
    for (let i = 0; i < 10; i++) step(r, moving(0), 1 / 60);
    const o = r.readPos * 2 * RIBBON_STRIDE;
    expect(r.vertices[o]).toBeCloseTo(-0.25, 3);
    expect(r.vertices[o + RIBBON_STRIDE]).toBeCloseTo(0.5, 3);
  });

  it("u runs with age, v spans the texture", () => {
    const r = ribbon({ lifetime: 1, edgesPerSec: 10 });
    const dt = 1 / 30;
    for (let i = 0; i < 20; i++) step(r, moving(i * 0.1), dt);
    const o = r.readPos * 2 * RIBBON_STRIDE;
    const age = 20 * dt;
    expect(r.vertices[o + 3]).toBeGreaterThan(0.3);
    expect(r.vertices[o + 3]).toBeLessThanOrEqual(age + dt);
    expect(r.vertices[o + 4]).toBe(0);
    expect(r.vertices[o + RIBBON_STRIDE + 4]).toBe(1);
  });

  it("gravity pulls old edges down the engine's Y, as the client's step does", () => {
    const g = -2;
    const r = ribbon({ gravity: g, lifetime: 2, edgesPerSec: 10 });
    const dt = 1 / 60;
    step(r, moving(0), dt);
    const edge = r.readPos;
    let expected = r.vertices[edge * 2 * RIBBON_STRIDE + 1]!;
    for (let i = 0; i < 60; i++) {
      const age = (r as unknown as { ages: Float32Array }).ages[edge]!;
      expected += (age * 2 + dt) * g * dt;
      step(r, moving(i * 0.01), dt);
    }
    expect(r.vertices[edge * 2 * RIBBON_STRIDE + 1]).toBeCloseTo(expected, 3);
    expect(r.vertices[edge * 2 * RIBBON_STRIDE + 1]).toBeLessThan(-0.5);
  });

  it("switched off, it stops writing and empties, and costs nothing after", () => {
    const r = ribbon({ visible: { clips: { "*": [[0, 1000], [1, 0]] }, hold: true } });
    FX_CLOCK[0] = 100;
    r.updateParams();
    for (let i = 0; i < 60; i++) step(r, moving(i * 0.1), 1 / 60);
    expect(r.segments).toBeGreaterThan(0);
    FX_CLOCK[0] = 1500;
    r.updateParams();
    for (let i = 0; i < 60; i++) step(r, moving(i * 0.1), 1 / 60);
    expect(r.segments).toBe(0);
    expect(r.active).toBe(false);
  });

  it("layers scroll at their speed, mod 1", () => {
    const r = ribbon({ tex: [0, 1, 2], layers: [{ scale: [1, 1], speed: [0, 0] }, { scale: [1, 1], speed: [1, 0] }, { scale: [1, 1], speed: [0, 0.5] }] });
    r.frameDt = 0.25;
    r.scroll();
    r.frameDt = 1;
    r.scroll();
    expect(r.offsets[2]).toBeCloseTo(0.25);
    expect(r.offsets[5]).toBeCloseTo(0.625);
  });

  it("allocates nothing while it runs", () => {
    const r = ribbon({ edgesPerSec: 60, lifetime: 1 });
    const b = moving(0);
    r.frameDt = 1 / 60;
    const fast = () => {
      b[14] = b[14]! + 0.01;
      r.setPos(b);
      r.updateParams();
      r.update();
    };
    for (let i = 0; i < 40000; i++) fast();
    const samples: number[] = [];
    for (let s = 0; s < 8; s++) {
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 2000; i++) fast();
      samples.push((process.memoryUsage().heapUsed - before) / 2000);
    }
    samples.sort((a, c) => a - c);
    const median = samples[samples.length >> 1]!;
    console.log(`ribbons: ${median.toFixed(2)} bytes per frame at ${r.segments} edges`);
    expect(median).toBeLessThan(16);
    // Tens of thousands of frames: past the default 5 s when every test file runs at once.
  }, 30_000);
});
