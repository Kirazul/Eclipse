import backdrops from "@/data/backdrops.json";
import type { ClassName } from "@/lib/domain";

// The one module that knows where real game art lives, so no component invents
// a path or a stand-in. See GOALS.md for where each kind of art comes from.

export const ICON_CDN = "https://wow.zamimg.com/images/wow/icons/large";

/** Morph slot (domain.ts SLOT_NAMES) -> the client's empty slot texture. */
const SLOT_TEXTURE: Record<number, string> = {
  0: "head", 1: "neck", 2: "shoulder", 3: "shirt", 4: "chest", 5: "waist", 6: "legs",
  7: "feet", 8: "wrists", 9: "hands", 10: "finger", 11: "finger", 12: "trinket",
  // The client draws the back slot with the chest texture.
  13: "trinket", 14: "chest", 15: "mainhand", 16: "offhand", 17: "ranged", 18: "tabard",
};

export const slotArt = (slot: number) => `/wow/slots/${SLOT_TEXTURE[slot] ?? "chest"}.jpg`;

/** Every source worth trying for an icon, best first; the last one is always ours. */
export function iconSources(icon: string | null, slot: number): string[] {
  const fallback = slotArt(slot);
  const name = icon?.trim().toLowerCase().replace(/\.blp$/, "");
  return name ? [`/icons/${name}.webp`, `${ICON_CDN}/${name}.jpg`, fallback] : [fallback];
}

export const classArt = (name: ClassName) => `/wow/classes/${name.toLowerCase().replaceAll(" ", "")}.jpg`;

/** Forms of one race share its portrait. */
const RACE_ART: Record<string, string> = {
  gilnean: "worgen", visage: "dracthyr", orcupright: "orc", magharupright: "maghar",
};

export const raceArt = (key: string, sex: "Male" | "Female" | null = null) =>
  `/wow/races/${RACE_ART[key] ?? key}_${sex === "Female" ? "female" : "male"}.jpg`;

/** Real art for the game concepts that have no item of their own. */
const CONCEPTS = {
  morph: "spell_nature_polymorph",
  mount: "ability_mount_ridinghorse",
  enchant: "trade_engraving",
  incarnation: "ability_druid_treeoflife",
  visual: "spell_arcane_arcane03",
  title: "inv_scroll_11",
  effect: "spell_holy_divineillumination",
  unknown: "inv_misc_questionmark",
} as const;

export const concept = (name: keyof typeof CONCEPTS) => `/wow/ui/${CONCEPTS[name]}.jpg`;

export const QUALITY_NAME = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"] as const;

// ShowcaseOverlay.cpp: QualityRing and QualityRgb. Not every piece has a known
// quality, and the studio then draws the plain ring and off-white type: it never
// guesses, and a guess here would be a lie about somebody's item.
const QUALITY_RING: Record<number, string> = {
  2: "uncommon", 3: "rare", 4: "epic", 5: "legendary", 6: "artifact", 7: "heirloom",
};
const QUALITY_COLOUR = ["#9d9d9d", "#f2f2f2", "#1eff00", "#3fa2ff", "#b45cff", "#ff8000", "#e6cc80", "#00ccff"];

export const ringArt = (quality: number | null) => `/wow/rings/${QUALITY_RING[quality ?? -1] ?? "white"}.png`;
export const qualityColour = (quality: number | null) => QUALITY_COLOUR[quality ?? 1] ?? QUALITY_COLOUR[1];

// FNV-1a. A multiplier of 31 would share a factor with the 93 backdrops, and the
// remainder would then land on a third of them.
const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** A Narcissus studio scene, the same one for a post every time it is drawn. */
export const backdropFor = (seed: string) => `/wow/backdrops/${backdrops[hash(seed) % backdrops.length]}.jpg`;

/** The same scene, small, for a card that draws it faintly (`tools/make-card-backdrops.mjs`). */
export const cardBackdropFor = (seed: string) => `/wow/backdrops/card/${backdrops[hash(seed) % backdrops.length]}.webp`;
