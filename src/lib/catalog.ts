import "server-only";
import displaysJson from "@/data/catalog/displays.json";
import enchantsJson from "@/data/catalog/enchants.json";
import itemsJson from "@/data/catalog/items.json";
import mountsJson from "@/data/catalog/mounts.json";
import placesJson from "@/data/catalog/places.json";
import qualityJson from "@/data/catalog/quality.json";
import {
  ARMOR_TYPES, COLOUR_AXES, RACE_BY_ID, RACE_LABEL, SLOT_INV_TYPES, SLOT_NAMES, VISIBLE_SLOTS, WORLD_GROUPS,
  type ArmorType, type WorldGroup,
} from "@/lib/domain";
import { enchanted, type Outfit } from "@/lib/codec/outfit";
import type { WorldPlace } from "@/lib/codec/world";

// tools/export_catalog.py writes these from the Eclipse data. Numbers in a code
// mean nothing without them: the code holds ids, the names live here.
type ItemRow = [id: number, name: string, invType: number, armor: number, icon: string];
type MountRow = [display: number, name: string, icon: string];
type PlaceRow = [tag: string, name: string, parent: number, group: number];

const itemById = new Map((itemsJson as ItemRow[]).map((r) => [r[0], r]));
const mountById = new Map((mountsJson as MountRow[]).map((r) => [r[0], r]));
const placeRows = placesJson.rows as PlaceRow[];
// Quality and enchant names are sparse: a miss means unknown, never zero.
const qualityById = qualityJson as Record<string, number>;
const enchantById = enchantsJson as Record<string, string>;
// tools/export_item_displays.mjs: the retail display each item's 3D model is baked under.
const displayById = displaysJson as Record<string, number>;
const displayOf = (id: number) => displayById[String(id)] ?? null;
const placeByTag = new Map(placeRows.map((r, i) => [r[0], { row: r, index: i }]));

export const catalogCounts = {
  items: itemById.size,
  mounts: mountById.size,
  places: placeRows.length,
  races: Object.keys(RACE_LABEL).length,
};

export function itemIcon(id: number): string | null {
  return itemById.get(id)?.[4] || null;
}

export function itemName(id: number): string | null {
  return itemById.get(id)?.[1] ?? null;
}

export interface PlaceInfo {
  tag: string;
  name: string;
  path: string;
  group: WorldGroup;
}

function placeInfo(tag: string): PlaceInfo | null {
  const hit = placeByTag.get(tag);
  if (!hit) return null;
  const path: string[] = [];
  for (let p = hit.row[2]; p >= 0; p = placeRows[p][2]) path.push(placeRows[p][1]);
  return { tag, name: hit.row[1], path: path.join(" · "), group: WORLD_GROUPS[hit.row[3]] };
}

export const resolvePlace = placeInfo;

export interface ItemHit {
  id: number;
  name: string;
  icon: string | null;
  /** 0 poor .. 7 heirloom, or null when no source names it. */
  quality: number | null;
  /** The baked 3D model it is drawn with, or null when none is baked. */
  display: number | null;
}

/** Items a slot can wear, by name. An empty query lists the slot's first few. */
export function searchItems(query: string, slot: number, limit = 24): ItemHit[] {
  const fits = SLOT_INV_TYPES[slot];
  if (!fits) return [];
  const q = query.trim().toLowerCase();
  const hits: ItemHit[] = [];
  for (const [id, name, invType, , icon] of itemsJson as ItemRow[]) {
    if (fits.includes(invType) && name.toLowerCase().includes(q)) {
      hits.push({ id, name, icon: icon || null, quality: qualityById[String(id)] ?? null, display: displayOf(id) });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

export interface WearableItem extends ItemHit {
  invType: number;
  /** The visible slot it goes in; a one-hander counts as Main Hand. */
  slot: number;
}

// Integer keys come out in order, so a type two slots share lands on the first.
const slotOfType = new Map<number, number>();
for (const [slot, types] of Object.entries(SLOT_INV_TYPES)) {
  for (const t of types) if (!slotOfType.has(t)) slotOfType.set(t, Number(slot));
}

function wearable([id, name, invType, , icon]: ItemRow): WearableItem | null {
  const slot = slotOfType.get(invType);
  if (slot === undefined) return null;
  // Some exported names carry a trailing space.
  return { id, name: name.trim(), invType, slot, icon: icon || null, quality: qualityById[String(id)] ?? null, display: displayOf(id) };
}

/** A piece a visible slot can wear, by its id. Null for anything else. */
export function wearableItem(id: number): WearableItem | null {
  const row = itemById.get(id);
  return row ? wearable(row) : null;
}

/** Wearable pieces whose name holds every typed word; names that start with the first word come first. */
export function findWearable(query: string, limit: number): WearableItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const leading: WearableItem[] = [];
  const others: WearableItem[] = [];
  for (const row of itemsJson as ItemRow[]) {
    const name = row[1].toLowerCase().trim();
    if (!words.every((w) => name.includes(w))) continue;
    const item = wearable(row);
    if (!item) continue;
    (name.startsWith(words[0]) ? leading : others).push(item);
    if (leading.length >= limit) break;
  }
  return [...leading, ...others].slice(0, limit);
}

export interface ResolvedSlot {
  slot: number;
  label: string;
  /** 0 when the code hides the slot on purpose. */
  item: number;
  name: string | null;
  icon: string | null;
  /** 0 poor .. 7 heirloom, or null when no source names it. */
  quality: number | null;
  /** The baked 3D model it is drawn with, or null when none is baked. */
  display: number | null;
}

export interface ResolvedMount {
  id: number;
  name: string | null;
  icon: string | null;
}

export interface ResolvedOutfit {
  slots: ResolvedSlot[];
  race: string | null;
  /** The key of RACE_LABEL, for the race's art. Null for a stored race id the site has no key for. */
  raceKey: string | null;
  /** The armor type most of its armor pieces share, or null when none has a majority. */
  armor: ArmorType | null;
  sex: "Male" | "Female" | null;
  morph: number | null;
  morphName: string | null;
  mount: ResolvedMount | null;
  mountFly: ResolvedMount | null;
  mountHidden: boolean;
  glows: { hand: "Main Hand" | "Off Hand"; id: number; name: string | null; colour: string | null }[];
  sheathe: { hand: "Main Hand" | "Off Hand"; position: number }[];
  scale: number | null;
  colours: { axis: string; hex: string }[];
  tints: number;
  cosmetics: number;
  unknown: string[];
}

const mount = (id: number): ResolvedMount | null => {
  if (!id) return null;
  const row = mountById.get(id);
  return { id, name: row?.[1] ?? null, icon: row?.[2] || null };
};

// Head, shoulders, chest, waist, legs, feet, wrists and hands: the slots whose armor type
// says who wears a look. A cloak's type is incidental, and the rest are never armor.
const ARMOR_SLOTS = [0, 2, 4, 5, 6, 7, 8, 9];

/** The majority vote tools/export_catalog.py takes for a named set, over a look's own pieces. */
function armorOf(slots: Outfit["slots"]): ArmorType | null {
  const votes = new Map<number, number>();
  let total = 0;
  for (const slot of ARMOR_SLOTS) {
    const kind = itemById.get(slots[slot])?.[3] ?? 0;
    if (kind < 1 || kind > ARMOR_TYPES.length) continue;
    votes.set(kind, (votes.get(kind) ?? 0) + 1);
    total++;
  }
  for (const [kind, count] of votes) if (count * 2 > total) return ARMOR_TYPES[kind - 1];
  return null;
}

const hexColour = (v: number) => `#${v.toString(16).padStart(6, "0").toUpperCase()}`;
const HANDS = ["Main Hand", "Off Hand"] as const;

export function resolveOutfit(o: Outfit): ResolvedOutfit {
  const order = new Map<number, number>(VISIBLE_SLOTS.map((s, i) => [s, i]));
  const slots = Object.entries(o.slots)
    .map(([key, item]) => {
      const slot = Number(key);
      const row = itemById.get(item);
      return {
        slot,
        label: SLOT_NAMES[slot],
        item,
        name: row?.[1] ?? null,
        icon: row?.[4] || null,
        quality: qualityById[item] ?? null,
        display: displayOf(item),
      };
    })
    .sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99));

  let race: string | null = null;
  let raceKey: string | null = null;
  let sex: ResolvedOutfit["sex"] = null;
  if (o.look?.kind === "rlook") {
    race = RACE_LABEL[o.look.race] ?? o.look.race;
    raceKey = RACE_LABEL[o.look.race] ? o.look.race : null;
    sex = o.look.sex === "f" ? "Female" : "Male";
  } else if (o.look) {
    race = RACE_LABEL[RACE_BY_ID[o.look.race]] ?? `Race ${o.look.race}`;
    raceKey = RACE_BY_ID[o.look.race] ?? null;
    sex = o.look.gender ? "Female" : "Male";
  }

  return {
    slots,
    race,
    raceKey,
    armor: armorOf(o.slots),
    sex,
    morph: o.display || null,
    morphName: mountById.get(o.display)?.[1] ?? null,
    mount: mount(o.mount),
    mountFly: mount(o.mountFly),
    mountHidden: o.mountHidden,
    glows: o.glow.flatMap((g, i) =>
      enchanted(g) ? [{ hand: HANDS[i], id: g.id, name: enchantById[g.id] ?? null, colour: g.tint ? hexColour(g.colour) : null }] : [],
    ),
    sheathe: o.sheathe.flatMap((position, i) => (position ? [{ hand: HANDS[i], position }] : [])),
    scale: o.scale || null,
    colours: o.colors.map((c) => ({ axis: COLOUR_AXES[c.axis], hex: hexColour(c.rgb) })),
    tints: o.wtint.length + o.mtint.length,
    cosmetics: o.cosmetics.length,
    unknown: o.unknown,
  };
}

export interface ResolvedWorldPlace extends WorldPlace {
  info: PlaceInfo | null;
}

export const resolveWorld = (places: WorldPlace[]): ResolvedWorldPlace[] =>
  places.map((p) => ({ ...p, info: placeInfo(p.tag) }));
