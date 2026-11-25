// The game's vocabulary. Slots are MorphOffsets.h, races are
// tools/races/races_matrix.py plus the client's own ChrRaces ids.

export const SLOT_NAMES = [
  "Head", "Neck", "Shoulders", "Shirt", "Chest", "Waist", "Legs", "Feet",
  "Wrists", "Hands", "Ring 1", "Ring 2", "Trinket 1", "Trinket 2", "Back",
  "Main Hand", "Off Hand", "Ranged", "Tabard",
] as const;

/** morph::SlotIsVisual, in the order a person reads a character. */
export const VISIBLE_SLOTS = [0, 2, 14, 4, 3, 18, 8, 9, 5, 6, 7, 15, 16, 17] as const;

/** kHome (Dressing.h) turned around: the item types each visible slot can wear. */
export const SLOT_INV_TYPES: Readonly<Record<number, readonly number[]>> = {
  0: [1], 2: [3], 3: [4], 4: [5, 20], 5: [6], 6: [7], 7: [8], 8: [9], 9: [10], 14: [16],
  15: [13, 17, 21], 16: [13, 14, 22, 23], 17: [15, 25, 26, 28], 18: [19],
};

export const SHEATHE_NAMES = ["Natural", "Back", "Hip", "Hidden"] as const;

export const CLASSES = [
  "Death Knight", "Druid", "Hunter", "Mage", "Paladin",
  "Priest", "Rogue", "Shaman", "Warlock", "Warrior",
] as const;
export type ClassName = (typeof CLASSES)[number];

export const ARMOR_TYPES = ["cloth", "leather", "mail", "plate"] as const;
export type ArmorType = (typeof ARMOR_TYPES)[number];

/** A look's body, read from its code: the overlay's rlook m/f, or a classic look line's gender. */
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

export const ARMOR_LABEL: Record<ArmorType, string> = {
  cloth: "Cloth", leather: "Leather", mail: "Mail", plate: "Plate",
};

export const ARMOR_CLASSES: Record<ArmorType, readonly ClassName[]> = {
  cloth: ["Mage", "Priest", "Warlock"],
  leather: ["Druid", "Rogue"],
  mail: ["Hunter", "Shaman"],
  plate: ["Death Knight", "Paladin", "Warrior"],
};

// What a look changes, read from its code (src/lib/codec/categories.ts), in the order
// it is listed. Only what a code carries: the overlay keeps incarnations and spell
// visuals in their own files, so a look can never hand them on. Retail and PvP looks
// are Armor with a tag.
export const CATEGORIES = ["Armor", "Race morph", "Creature morph", "Cosmetics", "Mounted"] as const;
export type Category = (typeof CATEGORIES)[number];

export const SORTS = ["trending", "newest", "top"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABEL: Record<Sort, string> = {
  trending: "Trending", newest: "Newest", top: "Top rated",
};

export const LOOKS_PER_PAGE = 24;

export const RACE_LABEL: Record<string, string> = {
  human: "Human", orc: "Orc", dwarf: "Dwarf", nightelf: "Night Elf", undead: "Forsaken",
  tauren: "Tauren", gnome: "Gnome", troll: "Troll", goblin: "Goblin", bloodelf: "Blood Elf",
  draenei: "Draenei", worgen: "Worgen", gilnean: "Worgen (Gilnean)", pandaren: "Pandaren",
  nightborne: "Nightborne", highmountain: "Highmountain Tauren", voidelf: "Void Elf",
  lightforged: "Lightforged Draenei", zandalari: "Zandalari Troll", kultiran: "Kul Tiran",
  darkiron: "Dark Iron Dwarf", vulpera: "Vulpera", maghar: "Mag'har Orc", mechagnome: "Mechagnome",
  dracthyr: "Dracthyr", visage: "Dracthyr (Visage)", earthen: "Earthen", haranir: "Haranir",
  orcupright: "Orc (upright)", magharupright: "Mag'har (upright)",
};

/** The client's ChrClasses id, as the game reports its own character's class. */
export const CLASS_BY_ID: Record<number, ClassName> = {
  1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest",
  6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 11: "Druid",
};

/** A stored `look` line's race byte, the client's ChrRaces id. */
export const RACE_BY_ID: Record<number, string> = {
  1: "human", 2: "orc", 3: "dwarf", 4: "nightelf", 5: "undead",
  6: "tauren", 7: "gnome", 8: "troll", 10: "bloodelf", 11: "draenei",
};

export const COLOUR_AXES = ["Skin", "Hair", "Eyes", "Death knight eyes", "Tattoo"] as const;

export const WORLD_GROUPS = ["Classic", "Burning Crusade", "Wrath", "Capitals", "Instances", "Other"] as const;
export type WorldGroup = (typeof WORLD_GROUPS)[number];

export const toCss = ([r, g, b]: readonly number[]) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
