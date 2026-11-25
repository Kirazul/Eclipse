/**
 * The dressing room's geography: which part of the figure a slot looks at, and
 * which component slot it feeds in the geoset rules. Rule from Eclipse's wardrobe:
 * hovering a helmet looks at the head, the face as a barber would; a whole set
 * steps back. The head's lift is DressRoom.cpp's kHeadLift: a head dead centre in
 * a tall stage reads as sitting low, so it is raised a fraction of what is seen.
 */
import type { SlotId, Vec3 } from "@eclipse/format";
import { COMP } from "./retailGeo";

/** Fractions of the figure's height, feet at 0 and crown at 1. */
const REGIONS: Record<SlotId, { lo: number; hi: number; azimuth: number; widen: number }> = {
  head: { lo: 0.8, hi: 1.0, azimuth: 0, widen: 0.5 },
  shoulder: { lo: 0.68, hi: 0.92, azimuth: 0, widen: 1 },
  back: { lo: 0.3, hi: 0.92, azimuth: Math.PI, widen: 1 },
  chest: { lo: 0.48, hi: 0.86, azimuth: 0, widen: 1 },
  shirt: { lo: 0.48, hi: 0.86, azimuth: 0, widen: 1 },
  tabard: { lo: 0.32, hi: 0.82, azimuth: 0, widen: 1 },
  wrist: { lo: 0.4, hi: 0.68, azimuth: 0, widen: 1 },
  hands: { lo: 0.32, hi: 0.6, azimuth: 0, widen: 1 },
  waist: { lo: 0.42, hi: 0.66, azimuth: 0, widen: 1 },
  legs: { lo: 0.05, hi: 0.56, azimuth: 0, widen: 1 },
  feet: { lo: 0, hi: 0.2, azimuth: 0, widen: 1 },
  mainhand: { lo: 0, hi: 1, azimuth: 0, widen: 1 },
  offhand: { lo: 0, hi: 1, azimuth: 0, widen: 1 },
  ranged: { lo: 0, hi: 1, azimuth: 0, widen: 1 },
};

export const HEAD_LIFT = 0.14;

export interface SlotView {
  min: Vec3;
  max: Vec3;
  azimuth: number;
}

/** The world box a slot frames, cut from the figure's bounds. */
export function slotView(slot: SlotId, bounds: { min: Vec3; max: Vec3 }): SlotView {
  const r = REGIONS[slot];
  const h = bounds.max[1] - bounds.min[1];
  let lo = bounds.min[1] + h * r.lo;
  let hi = bounds.min[1] + h * r.hi;
  if (slot === "head") {
    const lift = (hi - lo) * HEAD_LIFT;
    lo -= lift;
    hi -= lift;
  }
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const hx = ((bounds.max[0] - bounds.min[0]) / 2) * r.widen;
  const hz = ((bounds.max[2] - bounds.min[2]) / 2) * r.widen;
  return { min: [cx - hx, lo, cz - hz], max: [cx + hx, hi, cz + hz], azimuth: r.azimuth };
}

export const WEAPON_SLOTS: readonly SlotId[] = ["mainhand", "offhand", "ranged"];

/** Component slot in the geoset rules, or -1 for a slot they do not read. */
export function componentSlot(slot: SlotId): number {
  switch (slot) {
    case "shirt":
      return COMP.shirt;
    case "chest":
      return COMP.chest;
    case "waist":
      return COMP.belt;
    case "legs":
      return COMP.legs;
    case "feet":
      return COMP.feet;
    case "wrist":
      return COMP.wrist;
    case "hands":
      return COMP.hands;
    case "tabard":
      return COMP.tabard;
    case "back":
      return COMP.cape;
    default:
      return -1;
  }
}

/** Later paints cover earlier. Eclipse: tools/races/races_outfit.py PAINT_ORDER. */
export const PAINT_ORDER: readonly SlotId[] = ["shirt", "legs", "feet", "chest", "wrist", "hands", "waist", "tabard"];

/**
 * Component sections as fractions of the composite, the layout retail's
 * CharComponentTextureSections uses on a 2:1 body. A manifest may override them.
 */
export const DEFAULT_SECTIONS: Record<number, { x: number; y: number; w: number; h: number }> = {
  0: { x: 0, y: 0, w: 0.25, h: 0.25 },
  1: { x: 0, y: 0.25, w: 0.25, h: 0.25 },
  2: { x: 0, y: 0.5, w: 0.25, h: 0.125 },
  3: { x: 0.5, y: 0, w: 0.25, h: 0.25 },
  4: { x: 0.5, y: 0.25, w: 0.25, h: 0.125 },
  5: { x: 0.5, y: 0.375, w: 0.25, h: 0.25 },
  6: { x: 0.5, y: 0.625, w: 0.25, h: 0.25 },
  7: { x: 0.5, y: 0.875, w: 0.25, h: 0.125 },
};
