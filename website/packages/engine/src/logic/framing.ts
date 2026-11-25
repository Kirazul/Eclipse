/**
 * The arithmetic of framing a model, free of three.js so it can be tested alone:
 * the outlier filter over part boxes, the camera boundary, the padding per style,
 * the per-model depth range and the shadow camera fit.
 */
import { IQR_FACTOR } from "../constants";

export type V3 = readonly [number, number, number];
export interface BoxLike {
  min: V3;
  max: V3;
}

export function iqrLimits(values: readonly number[], factor = IQR_FACTOR): { lower: number; upper: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  const iqr = q3 - q1;
  return { lower: q1 - iqr * factor, upper: q3 + iqr * factor };
}

/** Drops part boxes far outside the others on any edge. Empty result: keep all. */
export function filterOutlierBoxes<T extends BoxLike>(boxes: readonly T[], factor = IQR_FACTOR): T[] {
  if (boxes.length === 0) return [];
  const limits = [0, 1, 2].map((axis) => ({
    lo: iqrLimits(boxes.map((b) => b.min[axis]!), factor),
    hi: iqrLimits(boxes.map((b) => b.max[axis]!), factor),
  }));
  const kept = boxes.filter((b) =>
    limits.every((l, axis) => b.min[axis]! >= l.lo.lower && b.max[axis]! <= l.hi.upper),
  );
  return kept.length > 0 ? kept : [...boxes];
}

/** The camera target may wander this far: size x max(2, maxDim), at least 1 per axis. */
export function boundarySize(size: V3): [number, number, number] {
  const scale = Math.max(2, size[0], size[1], size[2]);
  return [
    Math.max(1, size[0] * scale),
    Math.max(1, size[1] * scale),
    Math.max(1, size[2] * scale),
  ];
}

export interface FramePadding {
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
}
export interface FrameStyle {
  padding: FramePadding;
  azimuth: number;
  polar: number;
}

const DEG = Math.PI / 180;

export function frameStyle(
  style: "default" | "mobile" | "lol",
  interactable: boolean,
  sizeZ: number,
): FrameStyle {
  if (style === "lol") {
    return {
      padding: { paddingBottom: 0.7, paddingLeft: 0.7, paddingRight: 0.7, paddingTop: 0.3 },
      azimuth: -15 * DEG,
      polar: Math.PI / 2 - 45 * DEG,
    };
  }
  if (style === "mobile") {
    return {
      padding: { paddingBottom: 0.8, paddingLeft: 0.2, paddingRight: 0.2, paddingTop: 0.5 },
      azimuth: 0,
      polar: Math.PI / 2 - 20 * DEG,
    };
  }
  const extra = sizeZ * 0.1;
  const base = interactable
    ? { paddingBottom: 0.2, paddingLeft: 0.1, paddingRight: 0.1, paddingTop: 0.1 }
    : { paddingBottom: 0.3, paddingLeft: 0.3, paddingRight: 0.3, paddingTop: 0.3 };
  return {
    padding: { ...base, paddingTop: base.paddingTop + extra, paddingBottom: base.paddingBottom + extra },
    azimuth: 0,
    polar: Math.PI / 2 - 30 * DEG,
  };
}

/**
 * BEAT: a near and far plane chosen around the model rather than a fixed .1/100.
 * At FOV 10 the camera stands far from the figure, so the fixed range wastes
 * nearly all of the depth buffer in front of it. The margin leaves room for a
 * limb or a weapon to swing toward the lens.
 */
export function depthRange(cameraDistance: number, radius: number): { near: number; far: number } {
  const near = Math.max(0.1, cameraDistance - Math.max(2.5 * radius, 1));
  const far = Math.min(100, cameraDistance + Math.max(6 * radius, 4));
  return { near, far: Math.max(far, near + 1) };
}

/** Depth step in world units at `distance` on a 24-bit buffer. Smaller is safer. */
export function depthResolution(near: number, far: number, distance: number): number {
  const scale = (1 / near - 1 / far) / 2 ** 24;
  return distance * distance * scale;
}

export interface ShadowFit {
  /** Half extent of the orthographic frustum, a whole number of texels. */
  half: number;
  texel: number;
  /** Centre of the frustum in world space, snapped to the texel grid in light space. */
  center: [number, number, number];
  near: number;
  far: number;
  /** Light-space X and Y of the centre, in texels: whole numbers by construction. */
  gridX: number;
  gridY: number;
}

function normalize(v: V3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: V3, b: V3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * BEAT: no shadow shimmer. The frustum is fitted to the model's bounds with a
 * margin for motion, its size is a whole number of texels and its centre sits on
 * the texel grid, so re-fitting (a new item, a new model) can never slide the
 * shadow by a fraction of a texel. The light is fixed in the world, so an orbit
 * does not touch it at all.
 */
export function fitShadow(box: BoxLike, lightPosition: V3, mapSize: number, margin = 1.25): ShadowFit {
  const dir = normalize(lightPosition);
  // The same basis three.js's lookAt builds for this light.
  const up: V3 = Math.abs(dir[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(up, dir));
  const top = cross(dir, right);

  let loX = Infinity;
  let hiX = -Infinity;
  let loY = Infinity;
  let hiY = -Infinity;
  let loZ = Infinity;
  let hiZ = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p: V3 = [
      i & 1 ? box.max[0] : box.min[0],
      i & 2 ? box.max[1] : box.min[1],
      i & 4 ? box.max[2] : box.min[2],
    ];
    const x = dot(p, right);
    const y = dot(p, top);
    const z = dot(p, dir);
    loX = Math.min(loX, x);
    hiX = Math.max(hiX, x);
    loY = Math.min(loY, y);
    hiY = Math.max(hiY, y);
    loZ = Math.min(loZ, z);
    hiZ = Math.max(hiZ, z);
  }

  const rawHalf = Math.max(hiX - loX, hiY - loY, 0.5) * 0.5 * margin;
  // A power-of-two step keeps the size, and so the texel, stable across models.
  const step = 2 ** Math.ceil(Math.log2(rawHalf * 8)) / 8;
  const half = Math.ceil(rawHalf / step) * step;
  const texel = (2 * half) / mapSize;

  const gridX = Math.round(((loX + hiX) * 0.5) / texel);
  const gridY = Math.round(((loY + hiY) * 0.5) / texel);
  const cx = gridX * texel;
  const cy = gridY * texel;
  const cz = (loZ + hiZ) * 0.5;
  const reach = (hiZ - loZ) * 0.5 * margin + 1;
  return {
    half,
    texel,
    gridX,
    gridY,
    center: [
      right[0] * cx + top[0] * cy + dir[0] * cz,
      right[1] * cx + top[1] * cy + dir[1] * cz,
      right[2] * cx + top[2] * cy + dir[2] * cz,
    ],
    near: 0.1,
    far: 2 * reach + 20,
  };
}
