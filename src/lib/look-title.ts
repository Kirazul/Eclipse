import "server-only";
import setsJson from "@/data/catalog/sets.json";
import { itemName } from "@/lib/catalog";
import type { Outfit } from "@/lib/codec/outfit";

// A name for a look nobody titled, such as one shared on Discord with only a picture:
// the name most of its pieces share ("Dark Ranger General's Hood", "... Spaulder"), or
// else the item set most of them come from. Players name their looks the same way.

type SetRow = { name: string; pieces: Record<string, number> };

/** The gear slots, 0 (head) to 18 (tabard); others in a code are not items. */
const GEAR_SLOTS = 19;
const WORDS_BETWEEN = new Set(["of", "the", "and", "a", "an"]);

const setsByItem = new Map<number, SetRow[]>();
for (const set of setsJson as unknown as SetRow[]) {
  for (const item of Object.values(set.pieces)) setsByItem.set(item, [...(setsByItem.get(item) ?? []), set]);
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * The names a piece could share with others: "Dark Ranger" and "Dark Ranger General" from
 * "Dark Ranger General's Hood"; "Golden King" from "Crown of the Golden King"; "Lunar
 * Communion" and "Umbral Lunar Communion" from "Umbral Armbands of Lunar Communion".
 * Always two words or more: one word in common ("Stormrage") is not a name.
 */
function namesIn(item: string): string[] {
  const name = item.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const of = name.indexOf(" of ");
  if (of > 0) {
    const head = words(name.slice(0, of));
    const tail = name.slice(of + 4).replace(/^the\s+/i, "").trim();
    const found: string[] = [];
    if (words(tail).length >= 2) found.push(tail);
    if (head.length >= 2 && tail) found.push(`${head[0]} ${tail}`);
    return found;
  }
  const all = words(name);
  const found: string[] = [];
  // Every lead-in short of the last word, which names the piece itself.
  for (let n = 2; n < all.length; n++) {
    if (WORDS_BETWEEN.has(all[n - 1].toLowerCase())) continue;
    found.push(all.slice(0, n).join(" ").replace(/['’]s$/, ""));
  }
  return found;
}

/** A shared name or set counts when at least two pieces, and a third of them, have it. */
const enough = (n: number, of: number) => n >= 2 && n * 3 >= of;

/** The look's title from its pieces, or null when they have nothing in common. */
export function pieceTitle(outfit: Outfit): string | null {
  const items = [
    ...new Set(
      Object.entries(outfit.slots)
        .filter(([slot, item]) => Number(slot) < GEAR_SLOTS && item > 0)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, item]) => item),
    ),
  ];
  const named = items.map(itemName).filter((n): n is string => n !== null);

  const shared = new Map<string, number>();
  for (const item of named) for (const name of new Set(namesIn(item))) shared.set(name, (shared.get(name) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [name, n] of shared) {
    // A tie goes to the longer name: "Dark Ranger General" over "Dark Ranger".
    if (n > most || (n === most && best !== null && words(name).length > words(best).length)) {
      best = name;
      most = n;
    }
  }
  if (best && enough(most, named.length)) return best;

  const fromSet = new Map<SetRow, number>();
  for (const item of items) for (const set of setsByItem.get(item) ?? []) fromSet.set(set, (fromSet.get(set) ?? 0) + 1);
  let set: SetRow | null = null;
  let pieces = 0;
  for (const [s, n] of fromSet) {
    if (n > pieces) {
      set = s;
      pieces = n;
    }
  }
  return set && enough(pieces, items.length) ? set.name.replace(/\s*\([^)]*\)\s*$/, "") : null;
}
