import { describe, expect, test } from "vitest";
import {
  CELL_FILL,
  VIEW_ROWS,
  addToExtents,
  basisOfAngles,
  basisOfRows,
  cellWindow,
  creatureExtents,
  emptyExtents,
  fitExtents,
  weaponView,
  windowExtents,
  type Basis,
 silhouetteBounds } from "../src/logic/cellView";

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

function expectRotation(b: Basis) {
  for (const axis of [b.right, b.up, b.back]) expect(dot(axis, axis)).toBeCloseTo(1, 2);
  expect(dot(b.right, b.up)).toBeCloseTo(0, 2);
  expect(dot(b.up, b.back)).toBeCloseTo(0, 2);
  // Right-handed: a mirrored pose would turn every weapon inside out.
  const c = cross(b.right, b.up);
  expect(dot(c, b.back)).toBeCloseTo(1, 2);
}

describe("a cell's poses, FigureGrid.cpp ArmPose", () => {
  test("every pose is a proper rotation, in the baker's axes too", () => {
    for (const rows of Object.values(VIEW_ROWS)) expectRotation(basisOfRows(rows));
    for (const a of [0, 0.25, 0.64, Math.PI]) expectRotation(basisOfAngles(a));
  });

  test("a sword's length runs up the cell's diagonal, its flat toward you", () => {
    const b = basisOfRows(VIEW_ROWS.mainhand);
    // Retail +X is the baker's +Z: along the diagonal, up and to the right.
    const tip: [number, number, number] = [0, 0, 1];
    expect(dot(tip, b.right)).toBeGreaterThan(0.5);
    expect(dot(tip, b.up)).toBeGreaterThan(0.7);
    expect(dot(tip, b.back)).toBeCloseTo(0, 5);
    // Retail +Y is the baker's +X: the thin side, facing the viewer.
    expect(dot([1, 0, 0], b.back)).toBeCloseTo(1, 5);
  });

  test("the off hand is the main hand's mirror", () => {
    const main = basisOfRows(VIEW_ROWS.mainhand);
    const off = basisOfRows(VIEW_ROWS.offhand);
    expect(dot([0, 0, 1], off.right)).toBeCloseTo(-dot([0, 0, 1], main.right), 5);
    expect(dot([0, 0, 1], off.up)).toBeCloseTo(dot([0, 0, 1], main.up), 5);
  });

  test("a shield stands upright, face toward you", () => {
    const b = basisOfRows(VIEW_ROWS.shield);
    expect(dot([0, 0, 1], b.up)).toBeCloseTo(1, 5);
    expect(dot([1, 0, 0], b.back)).toBeCloseTo(1, 5);
  });

  test("a creature stands at three quarters, seen from 8 degrees above", () => {
    const b = basisOfRows(VIEW_ROWS.creature);
    const elevation = Math.asin(b.back[1]) * (180 / Math.PI);
    expect(elevation).toBeCloseTo(8, 0);
    // Facing +Z, turned 35 degrees from side-on toward you: 55 off the front, nose to the left.
    const azimuth = Math.atan2(b.back[0], b.back[2]) * (180 / Math.PI);
    expect(azimuth).toBeCloseTo(55, 0);
    expect(dot([0, 0, 1], b.right)).toBeLessThan(0);
  });

  test("a pose comes from the slot, the hand and the shape", () => {
    // Retail's Y, Z, X in the baker's axes: thin, wide, long.
    expect(weaponView("mainhand", 1, [0.1, 0.3, 1.5])).toBe("mainhand");
    expect(weaponView("offhand", 2, [0.1, 0.3, 1.5])).toBe("offhand");
    expect(weaponView("offhand", 0, [0.1, 0.5, 0.6])).toBe("shield");
    expect(weaponView("ranged", 1, [0.1, 0.5, 0.6])).toBe("shield");
    expect(weaponView("ranged", 2, [0.1, 1.5, 0.3])).toBe("ranged");
    expect(weaponView("ranged", 1, [0.9, 0.2, 1.1])).toBe("crossbow");
    expect(weaponView("ranged", 1, [0.1, 0.2, 1.3])).toBe("ranged");
    expect(weaponView("mainhand", 1, [0.1, 0.5, 0.6])).toBe("mainhand");
  });
});

describe("a cell's window on a figure, UiCameraCentre.inc", () => {
  test("a helm looks at the head, at retail's half turn", () => {
    const w = cellWindow("head", false);
    expect(w.centre).toBeGreaterThan(0.85);
    expect(w.height).toBeGreaterThan(0.25);
    expect(w.height).toBeLessThan(0.4);
    expect(w.azimuth).toBeCloseTo(0.5, 5);
  });

  test("a cloak is seen from behind", () => {
    expect(Math.abs(cellWindow("back", false).azimuth)).toBeCloseTo(Math.PI, 3);
    expect(Math.abs(cellWindow("back", true).azimuth)).toBeCloseTo(Math.PI, 3);
  });

  test("wrists and hands look at one arm: the rows say 5.64 radians, a short turn the other way", () => {
    for (const slot of ["wrist", "hands"] as const) {
      const w = cellWindow(slot, false);
      expect(w.azimuth).toBeGreaterThan(0.5);
      expect(w.azimuth).toBeLessThan(0.9);
      expect(w.pan).toBeGreaterThan(0.05);
    }
  });

  test("each region stands where it is on a body, top to bottom", () => {
    for (const female of [false, true]) {
      const at = (slot: "head" | "chest" | "waist" | "legs" | "feet") => cellWindow(slot, female).centre;
      expect(at("head")).toBeGreaterThan(at("chest"));
      expect(at("chest")).toBeGreaterThan(at("waist"));
      expect(at("waist")).toBeGreaterThan(at("legs"));
      expect(at("legs")).toBeGreaterThan(at("feet"));
    }
  });

  test("a set, and a bare body, are the whole figure from the front", () => {
    const w = cellWindow(null, false);
    expect(w.azimuth).toBe(0);
    expect(w.centre).toBe(0.5);
    expect(w.height).toBeGreaterThan(1);
  });

  test("the window is the cell's whole height, whatever the cell's size", () => {
    const b = basisOfAngles(0.25);
    const w = cellWindow("chest", false);
    const e = windowExtents(w, 0, 2, 0, 100 / 132, b);
    expect(e[4] - e[1]).toBeCloseTo(2 * w.height, 5);
    expect((e[3] - e[0]) / (e[4] - e[1])).toBeCloseTo(100 / 132, 5);
    expect((e[1] + e[4]) / 2).toBeCloseTo(2 * w.centre, 5);
  });
});

describe("fitting a silhouette", () => {
  test("it fills 88% of the cell on its tighter axis, centred", () => {
    const b = basisOfRows(VIEW_ROWS.creature);
    const e = emptyExtents();
    for (const [x, y, z] of [[0, 0, -1], [0, 1, 1], [0.4, 0, 0], [-0.4, 1, 0]] as const) addToExtents(e, b, x, y, z);
    const aspect = 100 / 132;
    const fov = 10;
    const at = fitExtents(e, b, aspect, fov, CELL_FILL);
    const tan = Math.tan((fov * Math.PI) / 360);
    const halfH = (at.distance - at.depth) * tan;
    const halfW = halfH * aspect;
    const fillW = (e[3] - e[0]) / (2 * halfW);
    const fillH = (e[4] - e[1]) / (2 * halfH);
    expect(Math.max(fillW, fillH)).toBeCloseTo(CELL_FILL, 5);
    // Centred: the target is the middle of the extents on every axis.
    expect(dot(at.target, b.right)).toBeCloseTo((e[0] + e[3]) / 2, 5);
    expect(dot(at.target, b.up)).toBeCloseTo((e[1] + e[4]) / 2, 5);
  });

  test("a vertex on a bone nothing animates counts for nothing", () => {
    const b = basisOfAngles(0);
    const n = 100;
    const rest = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rest[i * 3] = (i / n) * 2 - 1;
      rest[i * 3 + 1] = i % 2;
    }
    const posed = rest.slice();
    // Two of them flung ten times the model's size away.
    posed[0] = 40;
    posed[3] = -40;
    const e = creatureExtents(rest, posed, b);
    expect(e[3] - e[0]).toBeLessThan(2.5);
  });

  test("a pose that makes no sense falls back to the file's positions", () => {
    const b = basisOfAngles(0);
    const rest = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    // Every vertex far from home: nothing believable is left.
    const posed = rest.map((v) => v + 50);
    const e = creatureExtents(rest, posed, b);
    expect(e[3] - e[0]).toBeCloseTo(1, 5);
    expect(e[0]).toBeCloseTo(0, 5);
  });
});

describe("a silhouette's real reach", () => {
  const W = 100;
  const H = 120;
  const canvas = () => new Uint8Array(W * H * 4);
  const fill = (px: Uint8Array, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.set(rgba, (y * W + x) * 4);
  };

  test("an empty frame has none", () => {
    expect(silhouetteBounds(canvas(), W, H)).toBeNull();
  });

  test("it is the drawn pixels' box, to the pixel", () => {
    const px = canvas();
    fill(px, 20, 30, 70, 90, [10, 10, 10, 255]);
    expect(silhouetteBounds(px, W, H)).toEqual({ x0: 20, y0: 30, x1: 70, y1: 90 });
  });

  test("a glow is colour with no alpha of its own, and it counts", () => {
    const px = canvas();
    fill(px, 40, 40, 60, 60, [0, 0, 0, 255]);
    fill(px, 61, 40, 90, 60, [0, 200, 0, 0]);
    expect(silhouetteBounds(px, W, H)!.x1).toBe(90);
  });

  test("what barely shows does not", () => {
    const px = canvas();
    fill(px, 40, 40, 60, 60, [0, 0, 0, 255]);
    fill(px, 61, 40, 90, 60, [0, 10, 0, 10]);
    expect(silhouetteBounds(px, W, H)!.x1).toBe(60);
  });

  test("a far small orb doesn't shrink the animal, and a part of real size does count", () => {
    const px = canvas();
    fill(px, 20, 60, 80, 110, [0, 0, 0, 255]);
    // Well apart, and tiny: a storm orb over a gryphon.
    fill(px, 48, 2, 52, 6, [255, 255, 255, 255]);
    expect(silhouetteBounds(px, W, H)!.y0).toBe(60);
    // Well apart, and a part of it: a wing the pose holds off the body.
    fill(px, 20, 2, 80, 30, [0, 0, 0, 255]);
    expect(silhouetteBounds(px, W, H)!.y0).toBe(2);
  });

  test("a thin thing joined on counts whatever its size: a tail, a beam", () => {
    const px = canvas();
    fill(px, 20, 60, 80, 110, [0, 0, 0, 255]);
    fill(px, 50, 2, 50, 59, [255, 255, 255, 255]);
    expect(silhouetteBounds(px, W, H)!.y0).toBe(2);
  });
});
