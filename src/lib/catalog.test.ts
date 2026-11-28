import { describe, expect, it, vi } from "vitest";
import itemsJson from "@/data/catalog/items.json";
import displaysJson from "@/data/catalog/displays.json";
import qualityJson from "@/data/catalog/quality.json";
import { emptyOutfit } from "@/lib/codec/outfit";
import { SLOT_INV_TYPES as SLOT_INV } from "@/lib/domain";

vi.mock("server-only", () => ({}));

import { findWearable, itemName, resolveOutfit, searchItems } from "./catalog";

type Row = [id: number, name: string, invType: number, armor: number, icon: string];
const rows = itemsJson as Row[];
const invTypeOf = new Map(rows.map((r) => [r[0], r[2]]));
const firstOf = (invType: number) => rows.find((r) => r[2] === invType)!;
const SLOT = { head: 0, neck: 1, chest: 4, mainHand: 15, offHand: 16, ranged: 17 };

// The hands are what Dressing.h's kHome is really for: type 13 is the only row with
// a second home, and the catalogue exporter's own table lists only the first.
describe("the items a slot can wear", () => {
  it("offers a slot only its own item types", () => {
    const hits = searchItems("", SLOT.head, 200);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => invTypeOf.get(h.id) === 1)).toBe(true);
  });

  it("offers a one-hander in either hand", () => {
    const [id, name] = firstOf(13);
    expect(searchItems(name, SLOT.mainHand, 200).map((h) => h.id)).toContain(id);
    expect(searchItems(name, SLOT.offHand, 200).map((h) => h.id)).toContain(id);
  });

  it("keeps a two-hander out of the off hand and a shield out of the main hand", () => {
    const [twoHander, twoHanderName] = firstOf(17);
    const [shield, shieldName] = firstOf(14);
    expect(searchItems(twoHanderName, SLOT.offHand, 200).map((h) => h.id)).not.toContain(twoHander);
    expect(searchItems(shieldName, SLOT.mainHand, 200).map((h) => h.id)).not.toContain(shield);
  });

  it("files robes with chests, and thrown weapons and relics with ranged", () => {
    expect(searchItems(firstOf(20)[1], SLOT.chest, 200).map((h) => h.id)).toContain(firstOf(20)[0]);
    expect(searchItems(firstOf(25)[1], SLOT.ranged, 200).map((h) => h.id)).toContain(firstOf(25)[0]);
    expect(searchItems(firstOf(28)[1], SLOT.ranged, 200).map((h) => h.id)).toContain(firstOf(28)[0]);
  });

  it("offers nothing for a slot that shows nothing on a character", () => {
    expect(searchItems("", SLOT.neck)).toEqual([]);
    expect(searchItems("", 99)).toEqual([]);
  });
});

describe("searching the items", () => {
  it("ignores case and stops at the limit", () => {
    const [, name] = firstOf(1);
    expect(searchItems(name.toUpperCase(), SLOT.head).some((h) => h.name === name)).toBe(true);
    expect(searchItems("", SLOT.head, 5)).toHaveLength(5);
  });

  it("finds the legendaries by the names the game gives them", () => {
    const names = (query: string) => searchItems(query, SLOT.mainHand, 200).map((h) => h.name);
    expect(names("shadowmourne")).toContain("Shadowmourne");
    expect(names("ashbringer")).toEqual(expect.arrayContaining(["Ashbringer", "Corrupted Ashbringer"]));
    expect(names("atiesh")).toContain("Atiesh, Greatstaff of the Guardian");
    expect(findWearable("shadowmourne", 5).map((w) => w.id)).toContain(49623);
  });

  it("names items as the realm's own server did", () => {
    expect(itemName(10294)).toBe("Girdle of Prophecy");
    expect(itemName(22984)).toBe("Dawnblade");
    expect(itemName(160694)).toBe("Re-Origination Pulse Rifle");
  });

  it("lists each item once, in id order, with no stray spaces in its name", () => {
    expect(rows.every((r, i) => i === 0 || r[0] > rows[i - 1][0])).toBe(true);
    expect(rows.filter((r) => r[1] !== r[1].trim() || /\s{2}/.test(r[1])).map((r) => r[0])).toEqual([]);
  });

  it("finds nothing for a name no item has", () => {
    expect(searchItems("zz no such item zz", SLOT.head)).toEqual([]);
  });

  it("says when it knows an item's quality and never guesses", () => {
    const known = Object.keys(qualityJson as Record<string, number>).map(Number).find((id) => invTypeOf.get(id) === 1);
    if (known) {
      const name = rows.find((r) => r[0] === known)![1];
      const hit = searchItems(name, SLOT.head, 200).find((h) => h.id === known);
      expect(hit?.quality).toBe((qualityJson as Record<string, number>)[String(known)]);
    }
    const unknown = rows.find((r) => r[2] === 1 && !(String(r[0]) in qualityJson))!;
    expect(searchItems(unknown[1], SLOT.head, 200).find((h) => h.id === unknown[0])?.quality).toBeNull();
  });

  it("leaves an item with no icon to the slot's own texture", () => {
    const bare = rows.find((r) => r[2] === 1 && !r[4]);
    if (bare) expect(searchItems(bare[1], SLOT.head, 200).find((h) => h.id === bare[0])?.icon).toBeNull();
  });
});

describe("the model each item is drawn with", () => {
  it("names the baked display, shared models included", () => {
    const displays = displaysJson as Record<string, number>;
    const [id, display] = Object.entries(displays)[0]!;
    const row = rows.find((r) => r[0] === Number(id))!;
    const slot = Number(Object.entries(SLOT_INV).find(([, types]) => types.includes(row[2]))![0]);
    const hit = searchItems(row[1], slot, 200).find((h) => h.id === row[0]);
    expect(hit?.display).toBe(display);
  });

  it("says when no model is baked, and never guesses", () => {
    const bare = rows.find((r) => r[2] === 1 && !(String(r[0]) in (displaysJson as Record<string, number>)))!;
    expect(searchItems(bare[1], SLOT.head, 200).find((h) => h.id === bare[0])?.display).toBeNull();
  });

  it("lists an enchant only when the code names one", () => {
    const outfit = emptyOutfit();
    outfit.glowKnown = true;
    // As the game writes a weapon with none, and one whose own enchant is left alone.
    outfit.glow = [
      { id: 0, managed: false, tint: false, colour: 0x73ccff },
      { id: 3370, managed: false, tint: true, colour: 0xff0000 },
    ];
    expect(resolveOutfit(outfit).glows).toEqual([]);
    outfit.glow = [{ id: 0, managed: true, tint: true, colour: 0x44fd04 }, { id: 3370, managed: true, tint: false, colour: 0 }];
    expect(resolveOutfit(outfit).glows.map((g) => [g.hand, g.id])).toEqual([["Off Hand", 3370]]);
  });

  it("carries the display through a resolved code", () => {
    const [id, display] = Object.entries(displaysJson as Record<string, number>)[0]!;
    const outfit = emptyOutfit();
    outfit.slots = { 0: Number(id) };
    expect(resolveOutfit(outfit).slots[0]?.display).toBe(display);
  });
});

describe("the armor a look wears", () => {
  const wearing = (slots: Record<number, number>) => resolveOutfit({ ...emptyOutfit(), slots }).armor;

  it("is the type most of its armor pieces share", () => {
    // Plate chest, legs and hands over cloth sandals.
    expect(wearing({ 4: 10482, 6: 10486, 9: 10484, 7: 10347 })).toBe("plate");
  });

  it("is unknown when no type has most of the pieces", () => {
    expect(wearing({ 4: 10482, 6: 10486, 0: 64931, 7: 10347 })).toBeNull();
  });

  it("leaves out the cloak, whose type says nothing about who wears it", () => {
    // A leather-typed cloak beside one plate piece.
    expect(wearing({ 14: 11426, 4: 10482 })).toBe("plate");
  });

  it("is unknown for a look with no armor pieces or only hidden slots", () => {
    expect(wearing({})).toBeNull();
    expect(wearing({ 4: 0, 6: 0 })).toBeNull();
  });
});
