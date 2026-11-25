/**
 * Retail 12.1's item geosets: which value each body group shows for an outfit.
 * A port of Eclipse's src/eclipse/races/RetailGeo.h in the same rule order, which
 * reads retail's own builder (sub_10005FA40) and applier (sub_1000597C0). Pure.
 *
 * Every group starts at -2. -2 is the group's equipped default, -1 its
 * customization base or else its naked default, anything else is the value itself.
 */
export const GROUPS = 54;
export const SLOTS = 11;

/** Component slots, in retail's ITEM_SLOT order. */
export const COMP = { shirt: 2, chest: 3, belt: 4, legs: 5, feet: 6, wrist: 7, hands: 8, tabard: 9, cape: 10 } as const;

/** Pad bits: ItemDisplayInfo.Flags 0x100000 / 0x1000000 / 0x2000000, and the wrist rule's model kinds. */
export const PAD = { keepFoot: 1, chest: 2, glove: 4, kind0: 8, kind1: 16 } as const;
/** Component flags: 0x20 the chest suppresses the legs, 0x40 a guild tabard. */
export const COMP_FLAGS = { legsOff: 0x20, guild: 0x40 } as const;

/** Regions an item paints: bit r = component section r. */
export const SECTION = { armUpper: 0, armLower: 1, hand: 2, torsoUpper: 3, torsoLower: 4, legUpper: 5, legLower: 6, foot: 7 } as const;

export interface GeoSlot {
  worn: boolean;
  /** GeosetGroup[0..5]. */
  gg: readonly number[];
  pad: number;
  regions: number;
}

export const EMPTY_SLOT: GeoSlot = { worn: false, gg: [0, 0, 0, 0, 0, 0], pad: 0, regions: 0 };

/** Per group: naked default (-1), equipped default (-2). */
export const DEFAULTS: readonly (readonly [number, number])[] = [
  [1, 1], [1, 1], [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [1, 2], [1, 1], [0, 1], [1, 1], [0, 1],
  [1, 1], [0, 1], [0, 0], [1, 1], [0, 0], [0, 0], [1, 1], [1, 1], [0, 1], [1, 1], [1, 1], [1, 1],
  [0, 0], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [0, 0], [0, 0], [1, 2], [0, 1], [0, 1], [0, 0],
  [0, 0], [0, 0], [0, 1], [0, 0], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
  [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
];

/** The groups a retail slot rule writes (14, the Demon Hunter loincloth, stays off). */
export const RETAIL_GROUPS: readonly number[] = [4, 5, 8, 9, 10, 11, 12, 13, 15, 18, 20, 22, 23, 28, 30];

/**
 * `has(id)` is the model's own HasGeoset. `keepRobe` is Eclipse's one step off
 * retail: shaped boots under a robe move the skirt to 1303 only when the body has it.
 */
export function geosetValues(
  slots: readonly GeoSlot[],
  compFlags: number,
  has: (id: number) => boolean,
  keepRobe: boolean,
): Int32Array {
  const v = new Int32Array(GROUPS).fill(-2);
  const s = (slot: number) => slots[slot] ?? EMPTY_SLOT;
  const gg = (slot: number, k: number) => (s(slot).worn ? (s(slot).gg[k] ?? 0) : 0);
  const pad = (slot: number) => (s(slot).worn ? s(slot).pad : 0);
  const paints = (slot: number, r: number) => s(slot).worn && ((s(slot).regions >> r) & 1) !== 0;
  const { shirt, chest, belt, legs, feet, wrist, hands, tabard, cape } = COMP;
  const guild = (compFlags & COMP_FLAGS.guild) !== 0;
  const legsOff = (compFlags & COMP_FLAGS.legsOff) !== 0;
  let robe = false;
  let shortPants = false;

  // The upper arm, the gloves and the sleeves: one sleeve source.
  if (gg(chest, 4)) v[28] = gg(chest, 4) + 1;
  if (gg(hands, 0) || pad(hands) & PAD.glove) {
    if (gg(hands, 0)) v[4] = gg(hands, 0) + 1;
    v[8] = -1;
  } else if (pad(chest) & PAD.chest || gg(chest, 0)) {
    v[4] = -1;
    v[8] = gg(chest, 0) + 1;
  } else if (paints(hands, 1)) {
    v[4] = -2;
    v[8] = -1;
  } else if (paints(chest, 1)) {
    v[4] = -1;
    v[8] = -2;
  } else if (gg(shirt, 0)) {
    v[4] = -1;
    v[8] = gg(shirt, 0) + 1;
  }

  // The hand attachment: the gloves' GeosetGroup[0] when their [1] is set;
  // bracers bring it back over bare forearms.
  if (gg(hands, 1)) v[23] = gg(hands, 0);
  if (
    s(wrist).worn &&
    pad(wrist) & (PAD.kind0 | PAD.kind1) &&
    !gg(hands, 0) &&
    !(s(hands).worn && pad(hands) & (PAD.kind0 | PAD.kind1))
  ) {
    if (gg(chest, 0) || pad(chest) & PAD.chest) v[23] = 1;
    else if (v[8] === -1 || v[8] === -3) v[23] = 1;
  }

  // The torso: the chest's GeosetGroup[3]; a tabard painting the upper torso
  // (not flagged 0x100000) gives 2202.
  const tabardTorso = paints(tabard, 3) && !(pad(tabard) & PAD.keepFoot);
  if (s(chest).worn) {
    if (tabardTorso) v[22] = 2;
    else if (gg(chest, 3)) v[22] = gg(chest, 3) + 1;
  } else if (tabardTorso) {
    v[22] = 2;
  }

  // A robe (chest, else legs unless suppressed) takes boots, kneepads, pants and
  // the Mechagnome legs; else the boots' shaft, else kneepads.
  if (gg(chest, 2) || (gg(legs, 2) && !legsOff)) {
    v[13] = (gg(chest, 2) ? gg(chest, 2) : gg(legs, 2)) + 1;
    v[5] = v[9] = v[11] = v[30] = -1;
    robe = true;
  } else if (gg(feet, 0)) {
    v[5] = gg(feet, 0) + 1;
  } else if (gg(legs, 1) && !legsOff) {
    v[9] = gg(legs, 1) + 1;
  }

  // The feet: only a value the model has.
  if (s(feet).worn && gg(feet, 1)) {
    const g1 = gg(feet, 1);
    const foot = g1 >= 2 ? g1 + 1 : robe ? (gg(feet, 0) ? 2 : 1) : g1;
    if (has(2000 + foot)) {
      v[20] = foot;
      if (robe && foot >= 3 && (!keepRobe || has(1303))) v[13] = 3;
    }
  } else if (paints(feet, 7) && !(pad(feet) & PAD.keepFoot)) {
    v[20] = 2;
  }

  // The pants: only a shape the model has; 1104 / 1105 replace the thighs (1105
  // takes kneepads from the legs unless the boots are 503).
  if (!robe && !legsOff && gg(legs, 0)) {
    const p = gg(legs, 0);
    if (has(1101 + p)) {
      if (p === 4) {
        if (gg(feet, 0) && gg(feet, 0) !== 2) v[9] = gg(legs, 1) + 1;
        v[13] = -1;
      } else if (p === 3) {
        v[13] = -1;
      } else if (p === 1) {
        shortPants = true;
      }
      v[11] = p + 1;
    }
  }

  // The tabard (a guild tabard is 1202); short pants keep 1201.
  if (!robe && (guild || gg(tabard, 0)) && !shortPants) v[12] = guild ? 2 : gg(tabard, 0) + 1;

  // The undershirt: the chest's GeosetGroup[1], else the shirt's; nothing under a
  // chest robe or a shaped tabard.
  if (!gg(chest, 2) && !(s(tabard).worn && gg(tabard, 0))) {
    if (gg(chest, 1)) v[10] = gg(chest, 1) + 1;
    else if (gg(shirt, 1)) v[10] = gg(shirt, 1) + 1;
  }

  // The cape (not under a guild tabard).
  if (!guild && gg(cape, 0)) v[15] = gg(cape, 0) + 1;

  // The belt; no belt under a tabard painting the upper legs is 1804.
  if (gg(belt, 0)) v[18] = gg(belt, 0) + 1;
  else if (paints(tabard, 5)) v[18] = 4;

  return v;
}

/** The applier's value: -2 the equipped default, -1 the customization base, else itself. */
export function resolveValue(group: number, x: number, base = -1): number {
  const d = DEFAULTS[group] ?? [0, 0];
  if (x === -2) return d[1];
  if (x === -1) return base !== -1 ? base : d[0];
  return x;
}

/**
 * A helm hiding a group shows the "under helm" value 1 when the model has it and
 * the player did not choose it as a look of their own, else nothing (0).
 * Eclipse: ApplyHelmetGroups in src/eclipse/races/Races.cpp.
 */
export function helmGroupValue(group: number, has: (id: number) => boolean, chosen: number | undefined): number {
  return has(group * 100 + 1) && chosen !== 1 ? 1 : 0;
}

/** Item display flags that pose a hand item (retail 0x10006EE80, Eclipse HandPose.h). */
export const HAND_FLAGS = { mirrorMain: 0x400, mirrorOff: 0x100, mirrorSheathed: 0x800, flipSheathed: 0x1000 } as const;
export const SHEATH_POINTS: readonly number[] = [26, 27, 28, 30, 31, 32, 33];

/**
 * The transform a hand item takes on its attachment. Retail negates its Y row to
 * mirror and its Y and Z rows to turn; the baker's axes are (y, z, x) of retail's,
 * so retail Y is baked X and retail Z is baked Y.
 */
export function handPose(flags: number, hand: 0 | 1 | -1, sheathed: boolean): { scale: [number, number, number]; mirrored: boolean } {
  const side = hand === 0 ? HAND_FLAGS.mirrorMain : hand === 1 ? HAND_FLAGS.mirrorOff : 0;
  const mirror = (flags & side) !== 0 !== (sheathed && (flags & HAND_FLAGS.mirrorSheathed) !== 0);
  const flip = sheathed && (flags & HAND_FLAGS.flipSheathed) !== 0;
  return { scale: [mirror !== flip ? -1 : 1, flip ? -1 : 1, 1], mirrored: mirror };
}
