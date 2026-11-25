/**
 * How a grid cell looks at what it holds, as arithmetic: Eclipse's FigureGrid.cpp and
 * FigureMath.h, in this engine's axes. The poster baker and a live cell run the same
 * numbers, so a poster and the first live frame are one picture.
 *
 *   A weapon stands alone, one pose per kind (ArmPose), its silhouette filling the cell.
 *   A creature stands alone at three quarters, the same way.
 *   Armour looks at one region of a whole body, at the angle the realm's camera rows give.
 *   A set, or a bare body, is the whole figure from the front.
 */
import type { SlotId, Vec3 } from "@eclipse/format";

/** kWeaponFill: how much of the cell a silhouette spans on its tighter axis. */
export const CELL_FILL = 0.88;
/** A whole figure stands a little off the frame, the 1.12 the grid has always used. */
export const FIGURE_FILL = 1 / 1.12;

/** Where retail's X, Y and Z axes point in view space, as rows: x right, y up, z toward the viewer. */
export type Rows = readonly [number, number, number, number, number, number, number, number, number];

// The cell's own diagonal, the longest line a weapon can lie along in it.
const DIAGONAL = Math.hypot(78, 104);
const DX = 78 / DIAGONAL;
const DY = 104 / DIAGONAL;

export type CellView = "mainhand" | "offhand" | "ranged" | "crossbow" | "shield" | "creature";

export const VIEW_ROWS: Record<CellView, Rows> = {
  // Grip low left, tip high right, +Y faces you.
  mainhand: [DX, DY, 0, 0, 0, 1, DY, -DX, 0],
  // The mirror.
  offhand: [-DX, DY, 0, 0, 0, 1, DY, DX, 0],
  ranged: [DX, DY, 0, 0, 0, 1, DY, -DX, 0],
  // Limbs spread along Y, thin along Z: seen from above.
  crossbow: [DX, DY, 0, -DY, DX, 0, 0, 0, 1],
  // Upright, top +X, its face +Y toward you.
  shield: [0, 1, 0, 0, 0, 1, 1, 0, 0],
  // Faces +X, +Z up: turned 35 degrees from side-on toward you, seen from 8 degrees above.
  creature: [-0.81915, -0.07983, 0.56784, 0.57358, -0.11401, 0.81096, 0, 0.99027, 0.13917],
};

export interface Basis {
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

/** Retail's rows in the baker's axes, (x, y, z) -> (y, z, x): a cyclic permutation, so still a rotation. */
export function basisOfRows(r: Rows): Basis {
  return {
    right: [r[3], r[6], r[0]],
    up: [r[4], r[7], r[1]],
    back: [r[5], r[8], r[2]],
  };
}

/** A camera at `azimuth` from the model's front (+Z, toward +X) and `elevation` above level. */
export function basisOfAngles(azimuth: number, elevation = 0): Basis {
  const sa = Math.sin(azimuth);
  const ca = Math.cos(azimuth);
  const se = Math.sin(elevation);
  const ce = Math.cos(elevation);
  return {
    right: [ca, 0, -sa],
    up: [-sa * se, ce, -ca * se],
    back: [sa * ce, se, ca * ce],
  };
}

/**
 * Which pose a weapon takes. `size` is its model's bounds in the baker's axes: retail's Y,
 * Z, X. A shield hangs on the arm, attachment 0, but a row can file one elsewhere, so its
 * shape counts too: as long as it is wide, and thin. Nothing else held is all three.
 */
export function weaponView(slot: SlotId, attachment: number, size: Vec3): CellView {
  const [thin, wide, long] = size;
  const shieldShaped = wide > 0 && long / wide > 0.6 && long / wide < 2.6 && thin < Math.min(long, wide) * 0.6;
  if (attachment === 0 || (slot !== "mainhand" && attachment !== 2 && shieldShaped)) return "shield";
  if (slot === "offhand") return "offhand";
  if (slot === "ranged") return thin > wide * 1.15 ? "crossbow" : "ranged";
  return "mainhand";
}

/**
 * One region of a figure: `centre` and `height` as fractions of its standing height,
 * `pan` across the view, `azimuth` from the front. From Eclipse's UiCameraCentre.inc,
 * human rows, HD block: x, y, z, facing. Height is the view at the row's zoom x,
 * (D - x) / D of the whole-figure view, which shows 1.15 of a figure; D is the
 * character camera's distance, 3.0 male and 2.5 female by the rows' own legs, boots and
 * helm. Centre is half the figure minus z, and z, y are yards on a 1.9 and 1.75 figure.
 */
export interface CellWindow {
  centre: number;
  height: number;
  pan: number;
  azimuth: number;
}

const HEIGHT_MALE = 1.9;
const HEIGHT_FEMALE = 1.75;
const WHOLE_VIEW = 1.15;

type Row = readonly [zoom: number, y: number, z: number, facing: number];

const ROWS_MALE: Partial<Record<SlotId, Row>> = {
  head: [2.2, 0.065, -0.7532, -0.5],
  shoulder: [1.95, 0.1195, -0.6431, -0.25],
  shirt: [1.85, -0.0112, -0.4044, -0.25],
  chest: [1.85, -0.0112, -0.4044, -0.25],
  waist: [2.15, -0.0107, -0.1547, -0.25],
  legs: [1.55, 0.0181, 0.2129, -0.25],
  feet: [1.95, -0.0085, 0.5253, -0.8],
  wrist: [2.19, -0.2038, -0.0353, 5.64],
  hands: [2.15, -0.1965, 0.0509, 5.66],
  back: [1.25, 0.0233, -0.417, Math.PI],
  tabard: [1.45, -0.0077, -0.3971, -0.25],
};

const ROWS_FEMALE: Partial<Record<SlotId, Row>> = {
  head: [1.85, 0.0505, -0.6593, -0.5],
  shoulder: [1.85, 0.0537, -0.5581, -0.25],
  shirt: [1.8, 0.0014, -0.3333, -0.25],
  chest: [1.8, 0.0014, -0.3333, -0.25],
  waist: [1.85, -0.0194, -0.1351, -0.25],
  legs: [1.2, -0.0215, 0.2144, -0.25],
  feet: [1.65, -0.0077, 0.5333, -0.35],
  wrist: [1.74, -0.1347, -0.0478, 5.48],
  hands: [1.72, -0.1446, 0.0021, 5.52],
  back: [1.0, 0.0056, -0.3816, Math.PI],
  tabard: [1.4, -0.0066, -0.3434, -0.25],
};

/** The whole figure, from the front, for a set and a bare body. */
export const WHOLE_FIGURE: CellWindow = { centre: 0.5, height: 1 / FIGURE_FILL, pan: 0, azimuth: 0 };

export function cellWindow(slot: SlotId | null, female: boolean): CellWindow {
  const row = slot ? (female ? ROWS_FEMALE : ROWS_MALE)[slot] : undefined;
  if (!row) return WHOLE_FIGURE;
  const [zoom, y, z, facing] = row;
  const distance = female ? 2.5 : 3;
  const height = female ? HEIGHT_FEMALE : HEIGHT_MALE;
  // A facing turns the model. Turning the camera the other way is the same picture.
  const turned = facing > Math.PI + 0.01 ? facing - 2 * Math.PI : facing;
  return {
    centre: 0.5 - z / height,
    height: ((distance - zoom) / distance) * WHOLE_VIEW,
    // +y pans the model left on screen, so the view looks further right.
    pan: -y / height,
    azimuth: -turned,
  };
}

/** Extents along a basis, [min right, min up, min back, max right, max up, max back]. */
export type Extents = [number, number, number, number, number, number];

export function emptyExtents(): Extents {
  return [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
}

export function addToExtents(e: Extents, b: Basis, x: number, y: number, z: number): void {
  const r = x * b.right[0] + y * b.right[1] + z * b.right[2];
  const u = x * b.up[0] + y * b.up[1] + z * b.up[2];
  const k = x * b.back[0] + y * b.back[1] + z * b.back[2];
  if (r < e[0]) e[0] = r;
  if (u < e[1]) e[1] = u;
  if (k < e[2]) e[2] = k;
  if (r > e[3]) e[3] = r;
  if (u > e[4]) e[4] = u;
  if (k > e[5]) e[5] = k;
}

export function validExtents(e: Extents): boolean {
  return e[3] >= e[0] && e[4] >= e[1] && e[5] >= e[2];
}

export interface CellCamera {
  position: Vec3;
  target: Vec3;
  distance: number;
  /** Half the depth of what is framed, for the near and far planes. */
  depth: number;
}

/**
 * The camera that shows `e` on `b` filling `fill` of the cell on its tighter axis, centred.
 * Fitted at the silhouette's near side: this camera is narrow, but it is not orthographic.
 */
export function fitExtents(e: Extents, b: Basis, aspect: number, fovDegrees: number, fill: number): CellCamera {
  const spanX = Math.max(1e-4, e[3] - e[0]);
  const spanY = Math.max(1e-4, e[4] - e[1]);
  const depth = Math.max(1e-4, e[5] - e[2]) / 2;
  const tan = Math.tan((fovDegrees * Math.PI) / 360);
  const halfHeight = Math.max(spanY / 2, spanX / 2 / aspect) / fill;
  const distance = halfHeight / tan + depth;
  const cx = (e[0] + e[3]) / 2;
  const cy = (e[1] + e[4]) / 2;
  const cz = (e[2] + e[5]) / 2;
  const target: Vec3 = [
    b.right[0] * cx + b.up[0] * cy + b.back[0] * cz,
    b.right[1] * cx + b.up[1] * cy + b.back[1] * cz,
    b.right[2] * cx + b.up[2] * cy + b.back[2] * cz,
  ];
  return {
    position: [target[0] + b.back[0] * distance, target[1] + b.back[1] * distance, target[2] + b.back[2] * distance],
    target,
    distance,
    depth,
  };
}

/**
 * A window on a figure: its height is the cell's whole height, and it stays centred on
 * the middle of what stands in that band of the figure. `middle` is that band's centre
 * across the view, from the figure's own vertices; the arms are out of frame on purpose.
 */
export function windowExtents(w: CellWindow, figureMinY: number, figureHeight: number, middle: number, aspect: number, b: Basis): Extents {
  const height = figureHeight * w.height;
  const cy = figureMinY + figureHeight * w.centre;
  const half = (height * aspect) / 2;
  const cx = middle + figureHeight * w.pan;
  const depth = figureHeight / 2;
  // Up is world Y for a level camera, so the band's middle is `cy` along `up`.
  const u = cy * b.up[1];
  return [cx - half, u - height / 2, -depth, cx + half, u + height / 2, depth];
}

/** A silhouette's pixels: drawn this strongly, or a glow this bright, as a poster's coverage counts it. */
const SOLID = 24;
/** Parts this close, a share of the frame's width, are one shape: a hoof under a leg, a flame off a wing. */
const JOINED = 0.03;
/** A part apart from the rest counts from this share of the largest. A storm orb far above a gryphon does not. */
const COUNTS = 0.05;

export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a picture's real shape reaches, in pixels. RGBA, premultiplied: an additive glow is
 * colour with no alpha of its own, so its brightest channel counts for it. Null when it is
 * empty. Runs on a small measuring frame, once per look, so it stays one pass over the pixels:
 * the parts are found on a coarse grid of `JOINED`-sized blocks, each keeping its exact reach.
 */
export function silhouetteBounds(rgba: ArrayLike<number>, width: number, height: number): PixelBox | null {
  const size = Math.max(1, Math.round(width * JOINED));
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const blocks = new Int32Array(cols * rows * 5);
  for (let y = 0, p = 0; y < height; y++) {
    const row = (y / size) | 0;
    for (let x = 0; x < width; x++, p += 4) {
      if (rgba[p + 3]! < SOLID && rgba[p]! < SOLID && rgba[p + 1]! < SOLID && rgba[p + 2]! < SOLID) continue;
      const b = (row * cols + ((x / size) | 0)) * 5;
      if (blocks[b] === 0) {
        blocks[b + 1] = x;
        blocks[b + 2] = y;
        blocks[b + 3] = x;
        blocks[b + 4] = y;
      } else {
        if (x < blocks[b + 1]!) blocks[b + 1] = x;
        if (y < blocks[b + 2]!) blocks[b + 2] = y;
        if (x > blocks[b + 3]!) blocks[b + 3] = x;
        if (y > blocks[b + 4]!) blocks[b + 4] = y;
      }
      blocks[b]!++;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const parts: (PixelBox & { mass: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || blocks[start * 5] === 0) continue;
    const part = { x0: width, y0: height, x1: -1, y1: -1, mass: 0 };
    parts.push(part);
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop()!;
      const b = at * 5;
      part.mass += blocks[b]!;
      if (blocks[b + 1]! < part.x0) part.x0 = blocks[b + 1]!;
      if (blocks[b + 2]! < part.y0) part.y0 = blocks[b + 2]!;
      if (blocks[b + 3]! > part.x1) part.x1 = blocks[b + 3]!;
      if (blocks[b + 4]! > part.y1) part.y1 = blocks[b + 4]!;
      const col = at % cols;
      const row = (at - col) / cols;
      for (let v = Math.max(0, row - 1); v <= Math.min(rows - 1, row + 1); v++) {
        for (let u = Math.max(0, col - 1); u <= Math.min(cols - 1, col + 1); u++) {
          const next = v * cols + u;
          if (!seen[next] && blocks[next * 5] !== 0) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
  }
  if (parts.length === 0) return null;
  let most = 0;
  for (const p of parts) if (p.mass > most) most = p.mass;
  const box: PixelBox = { x0: width, y0: height, x1: -1, y1: -1 };
  for (const p of parts) {
    if (p.mass < most * COUNTS) continue;
    if (p.x0 < box.x0) box.x0 = p.x0;
    if (p.y0 < box.y0) box.y0 = p.y0;
    if (p.x1 > box.x1) box.x1 = p.x1;
    if (p.y1 > box.y1) box.y1 = p.y1;
  }
  return box;
}

// CreatureExtents in FigureMath.h: a posed vertex further from where the file put it than
// a creature bends hangs on a bone nothing animates, and counts for nothing.
const CREATURE_BEND = 0.6;
const CREATURE_KEPT = 0.6;
const CREATURE_SPAN = 1.5;

/** `rest` and `posed` are flat xyz of the same vertices. */
export function creatureExtents(rest: ArrayLike<number>, posed: ArrayLike<number>, b: Basis): Extents {
  const n = Math.floor(rest.length / 3);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const v = rest[i * 3 + a]!;
      if (v < lo[a]!) lo[a] = v;
      if (v > hi[a]!) hi[a] = v;
    }
  }
  const diag2 = (hi[0]! - lo[0]!) ** 2 + (hi[1]! - lo[1]!) ** 2 + (hi[2]! - lo[2]!) ** 2;
  const limit2 = CREATURE_BEND * CREATURE_BEND * diag2;
  const pose = emptyExtents();
  const file = emptyExtents();
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const rx = rest[i * 3]!;
    const ry = rest[i * 3 + 1]!;
    const rz = rest[i * 3 + 2]!;
    const px = posed[i * 3]!;
    const py = posed[i * 3 + 1]!;
    const pz = posed[i * 3 + 2]!;
    addToExtents(file, b, rx, ry, rz);
    const d2 = (px - rx) ** 2 + (py - ry) ** 2 + (pz - rz) ** 2;
    if (d2 <= limit2 && Number.isFinite(d2)) {
      addToExtents(pose, b, px, py, pz);
      kept++;
    }
  }
  let usePose = n > 0 && kept >= CREATURE_KEPT * n;
  for (let a = 0; usePose && a < 2; a++) {
    if (pose[a + 3]! - pose[a]! > CREATURE_SPAN * (file[a + 3]! - file[a]!)) usePose = false;
  }
  return usePose ? pose : file;
}
