import { CATEGORIES, type Category } from "@/lib/domain";
import { decodeOutfit, type Outfit } from "./outfit";

// Gear slots are 0..18 (morph::kSlotCount), and item 0 hides a slot.
const GEAR_SLOTS = 19;

/**
 * What a look changes, read from its code: never chosen by its author, so nobody can
 * file a look where it does not belong. private.code_categories (the look_categories
 * migration) files published looks the same way, and a test holds the two together.
 */
export function lookCategories(o: Outfit): Category[] {
  const has: Record<Category, boolean> = {
    Armor: Object.entries(o.slots).some(([slot, item]) => Number(slot) < GEAR_SLOTS && item > 0),
    "Race morph": o.look !== null,
    "Creature morph": o.display > 0,
    Cosmetics: o.cosmetics.length > 0,
    Mounted: o.mount > 0 || o.mountFly > 0,
  };
  return CATEGORIES.filter((c) => has[c]);
}

export function codeCategories(code: string): Category[] {
  const r = decodeOutfit(code);
  return r.ok ? lookCategories(r.outfit) : [];
}
