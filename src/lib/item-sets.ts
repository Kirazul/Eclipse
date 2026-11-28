import "server-only";
import setsJson from "@/data/catalog/sets.json";
import { wearableItem, type ItemHit } from "@/lib/catalog";
import { SLOT_INV_TYPES, type ArmorType } from "@/lib/domain";

// The game's own item sets (tools/export_catalog.py), to put on in the Dressing room.
// Each piece is the same item a slot search offers, so a set on the rack is exactly
// those pieces chosen one by one.

type SetRow = { id: number; name: string; armor: ArmorType; pieces: Record<string, number> };

export interface SetHit {
  id: number;
  name: string;
  armor: ArmorType;
  /** Visible slot -> the piece it wears. */
  pieces: Record<number, ItemHit>;
  /** How many of its pieces the 3D preview can draw: those with a baked display. */
  shown: number;
  total: number;
}

function hitOf(row: SetRow): SetHit {
  const pieces: Record<number, ItemHit> = {};
  for (const [key, item] of Object.entries(row.pieces)) {
    const slot = Number(key);
    const found = wearableItem(item);
    // Only a piece the slot can wear, as a slot search would offer it.
    if (!found || !SLOT_INV_TYPES[slot]?.includes(found.invType)) continue;
    const { id, name, icon, quality, display } = found;
    pieces[slot] = { id, name, icon, quality, display };
  }
  const worn = Object.values(pieces);
  return { id: row.id, name: row.name.trim(), armor: row.armor, pieces, shown: worn.filter((p) => p.display !== null).length, total: worn.length };
}

const sets = (setsJson as unknown as SetRow[]).map(hitOf).filter((s) => s.total > 0);

export const setCount = sets.length;

/** Sets whose name holds every typed word; names that start with the first word come first. */
export function searchSets(query: string, limit = 24): SetHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return sets.slice(0, limit);
  const leading: SetHit[] = [];
  const others: SetHit[] = [];
  for (const set of sets) {
    const name = set.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    (name.startsWith(words[0]) ? leading : others).push(set);
    if (leading.length >= limit) break;
  }
  return [...leading, ...others].slice(0, limit);
}

/** The set at any whole number, wrapped onto the list: the visitor's random pick. Null for no number. */
export function setAt(n: number): SetHit | null {
  if (!Number.isFinite(n) || !setCount) return null;
  const i = ((Math.trunc(n) % setCount) + setCount) % setCount;
  return sets[i] ?? null;
}
