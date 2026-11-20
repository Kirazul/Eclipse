import "server-only";
import setsJson from "@/data/catalog/sets.json";
import { itemIcon } from "@/lib/catalog";
import { lookCategories } from "@/lib/codec/categories";
import { decodeOutfit, emptyOutfit, encodeOutfit } from "@/lib/codec/outfit";
import { ARMOR_CLASSES, ARMOR_TYPES, LOOKS_PER_PAGE, type ArmorType } from "@/lib/domain";
import type { OutfitFilters, OutfitPost, Repository } from "./types";

// What the site can show with no database, and after every published look once
// there is one. Every word of it is real: the game's own item sets and the one
// saved look in the Eclipse repo. Nobody
// published these, so they carry no author, votes or date, and nothing here is
// dressed up with a race, mount or enchant the set does not hold. Writes are
// refused rather than pretended.

interface SetRow {
  id: number;
  name: string;
  armor: ArmorType;
  pieces: Record<string, number>;
}

const NOT_LIVE = "Publishing is not open yet: the community database is not connected.";

// A set with an icon on most of its pieces, so a card can show what it is.
function usableSets(armor: ArmorType): SetRow[] {
  return (setsJson as unknown as SetRow[]).filter((s) => {
    if (s.armor !== armor) return false;
    const items = Object.values(s.pieces);
    return items.length >= 6 && items.filter(itemIcon).length >= items.length - 1;
  });
}

function setLook(set: SetRow): OutfitPost {
  const outfit = emptyOutfit();
  for (const [slot, item] of Object.entries(set.pieces)) outfit.slots[Number(slot)] = item;
  return {
    id: `set-${set.id}`,
    title: set.name,
    author: null,
    authorId: null,
    authorVerified: false,
    code: encodeOutfit(outfit),
    className: null,
    armor: set.armor,
    race: null,
    categories: lookCategories(outfit),
    tags: [
      ...(/gladiator/i.test(set.name) ? ["pvp"] : []),
      ...(Object.values(set.pieces).some((i) => i > 200000) ? ["retail"] : []),
    ],
    upvotes: null,
    createdAt: null,
    gallery: [],
  };
}

// The one real saved look (overlay profiles/morph.cfg), slot for slot.
function crystalScholar(): OutfitPost {
  const outfit = emptyOutfit();
  outfit.slots = { 0: 259306, 2: 1001733, 4: 1001735, 5: 1001729, 6: 1001732, 8: 1001736, 9: 1001731, 14: 1001728 };
  outfit.mount = 134653;
  return {
    id: "crystal-scholar",
    title: "Crystal Scholar on a yellow ottuk",
    author: "Eclipse",
    authorId: null,
    authorVerified: false,
    code: encodeOutfit(outfit),
    className: null,
    armor: "cloth",
    race: null,
    categories: lookCategories(outfit),
    tags: ["saved look", "retail", "mount"],
    upvotes: null,
    createdAt: null,
    gallery: [],
  };
}

// One of each armor type in turn, so a first page is not all cloth.
function interleaved(lists: SetRow[][]): SetRow[] {
  const longest = Math.max(...lists.map((l) => l.length));
  return Array.from({ length: longest }, (_, i) => lists.flatMap((l) => (i < l.length ? [l[i]] : []))).flat();
}

let looks: OutfitPost[] | null = null;
function allLooks(): OutfitPost[] {
  looks ??= [crystalScholar(), ...interleaved(ARMOR_TYPES.map(usableSets)).map(setLook)];
  return looks;
}

// Nobody chose a class for a set, but its armor says who wears it.
function wornBy(o: OutfitPost, className: NonNullable<OutfitFilters["className"]>): boolean {
  if (o.className) return o.className === className;
  return o.armor !== null && ARMOR_CLASSES[o.armor].includes(className);
}

// Read once per look: the filter runs over every set on every Wardrobe page.
const worn = new Map<string, Set<number>>();
function wears(o: OutfitPost, item: number): boolean {
  let items = worn.get(o.id);
  if (!items) {
    const r = decodeOutfit(o.code);
    items = new Set(r.ok ? Object.values(r.outfit.slots) : []);
    worn.set(o.id, items);
  }
  return items.has(item);
}

function matches(o: OutfitPost, f: OutfitFilters): boolean {
  // Nobody can bookmark a built-in look.
  if (f.saved) return false;
  if (f.captured && !o.gallery.length) return false;
  if (f.authorId && o.authorId !== f.authorId) return false;
  if (f.excludeAuthorId && o.authorId === f.excludeAuthorId) return false;
  if (f.className && !wornBy(o, f.className)) return false;
  if (f.race && o.race !== f.race) return false;
  if (f.armor && o.armor !== f.armor) return false;
  if (f.category && !o.categories.includes(f.category)) return false;
  if (f.tag && !o.tags.includes(f.tag)) return false;
  if (f.item && !wears(o, f.item)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    return [o.title, ...o.tags].some((t) => t.toLowerCase().includes(q));
  }
  return true;
}

export const matchingLooks = (f: OutfitFilters) => allLooks().filter((o) => matches(o, f));

export const builtinRepository: Repository = {
  live: false,
  async listOutfits(f) {
    const hits = matchingLooks(f);
    const size = f.pageSize ?? LOOKS_PER_PAGE;
    const start = (Math.max(1, f.page ?? 1) - 1) * size;
    return { posts: hits.slice(start, start + size), total: hits.length };
  },
  async getOutfit(id) {
    return allLooks().find((o) => o.id === id) ?? null;
  },
  async getCreator() {
    return null;
  },
  async lookOfTheWeek() {
    return null;
  },
  async searchIndex() {
    return allLooks().map(({ id, title, author }) => ({ id, title, author }));
  },
  // The game's own sets have no creators.
  async listCreators() {
    return [];
  },
  async createOutfit() {
    return { ok: false, error: NOT_LIVE };
  },
  async vote() {
    return { ok: false, error: NOT_LIVE };
  },
  async votedOn() {
    return [];
  },
  async report() {
    return { ok: false, error: NOT_LIVE };
  },
  async isBookmarked() {
    return false;
  },
  async setBookmark() {
    return { ok: false, error: NOT_LIVE };
  },
  async listReports() {
    return [];
  },
  async dismissReports() {
    return { ok: false, error: NOT_LIVE };
  },
  async listComments() {
    return [];
  },
  async getComment() {
    return null;
  },
  async addComment() {
    return { ok: false, error: NOT_LIVE };
  },
  async deleteComment() {
    return { ok: false, error: NOT_LIVE };
  },
  async reportComment() {
    return { ok: false, error: NOT_LIVE };
  },
  async listCommentReports() {
    return [];
  },
  async dismissCommentReports() {
    return { ok: false, error: NOT_LIVE };
  },
  async uploadScreenshot() {
    return { ok: false, error: NOT_LIVE };
  },
  async removeScreenshot() {
    return { ok: false, error: NOT_LIVE };
  },
  async deleteOutfit() {
    return { ok: false, error: NOT_LIVE };
  },
  async setOutfitPrivate() {
    return { ok: false, error: NOT_LIVE };
  },
  async getAccount() {
    return null;
  },
  async setDisplayName() {
    return { ok: false, error: NOT_LIVE };
  },
  async listGameLinks() {
    return [];
  },
  async listGameSets() {
    return [];
  },
  async getGameSet() {
    return null;
  },
  async newGameLinkCode() {
    return { ok: false, error: NOT_LIVE };
  },
  async unlinkGame() {
    return { ok: false, error: NOT_LIVE };
  },
  async sendToGame() {
    return { ok: false, error: NOT_LIVE };
  },
  async removeGameSet() {
    return { ok: false, error: NOT_LIVE };
  },
  async removeSetPicture() {
    return { ok: false, error: NOT_LIVE };
  },
  async clearOrphanPictures() {},
};
