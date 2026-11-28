import { describe, expect, it, vi } from "vitest";
import displaysJson from "@/data/catalog/displays.json";
import setsJson from "@/data/catalog/sets.json";
import { VISIBLE_SLOTS } from "@/lib/domain";

vi.mock("server-only", () => ({}));

import { wearableItem } from "./catalog";
import { searchSets, setAt, setCount } from "./item-sets";

type Row = { id: number; name: string; pieces: Record<string, number> };
const rows = setsJson as unknown as Row[];
const displays = displaysJson as Record<string, number>;

describe("the game's item sets in the Dressing room", () => {
  it("offers every set, each with something to wear", () => {
    expect(setCount).toBe(rows.length);
    for (let i = 0; i < setCount; i++) expect(Object.keys(setAt(i)!.pieces).length).toBeGreaterThan(0);
  });

  it("finds a set by any of the words in its name, in any case", () => {
    const hits = searchSets("battlegear CHAMPION");
    expect(hits.map((s) => s.name)).toContain("Champion's Battlegear");
    for (const s of hits) expect(s.name.toLowerCase()).toMatch(/(?=.*battlegear)(?=.*champion)/);
  });

  it("puts names that start with the first word first", () => {
    const hits = searchSets("wrath", 50);
    const firstOther = hits.findIndex((s) => !s.name.toLowerCase().startsWith("wrath"));
    if (firstOther >= 0) for (const s of hits.slice(firstOther)) expect(s.name.toLowerCase().startsWith("wrath")).toBe(false);
  });

  it("lists a few sets before anything is typed, and nothing for a name no set has", () => {
    expect(searchSets("", 24)).toHaveLength(24);
    expect(searchSets("zzzz no such set")).toEqual([]);
  });

  it("keeps sets that share a name apart by their id", () => {
    const named = new Map<string, number>();
    for (const r of rows) named.set(r.name, (named.get(r.name) ?? 0) + 1);
    const [shared] = [...named].find(([, n]) => n > 1)!;
    const hits = searchSets(shared, 100).filter((s) => s.name === shared);
    expect(hits.length).toBeGreaterThan(1);
    expect(new Set(hits.map((s) => s.id)).size).toBe(hits.length);
  });

  it("wears each piece in the slot the set names, the same item a slot search would offer", () => {
    const visible = new Set<number>(VISIBLE_SLOTS);
    const row = rows.find((r) => r.name === "Champion's Battlegear")!;
    const set = searchSets("Champion's Battlegear").find((s) => s.id === row.id)!;
    expect(Object.keys(set.pieces).map(Number).sort((a, b) => a - b)).toEqual(Object.keys(row.pieces).map(Number).sort((a, b) => a - b));
    for (const [slot, piece] of Object.entries(set.pieces)) {
      expect(visible.has(Number(slot))).toBe(true);
      expect(piece.id).toBe(row.pieces[slot]);
      const { id, name, icon, quality, display } = wearableItem(piece.id)!;
      expect(piece).toEqual({ id, name, icon, quality, display });
    }
  });

  it("counts the pieces the 3D preview can draw: those with a baked display", () => {
    for (let i = 0; i < setCount; i += 37) {
      const set = setAt(i)!;
      const pieces = Object.values(set.pieces);
      expect(set.shown).toBe(pieces.filter((p) => String(p.id) in displays).length);
      expect(set.total).toBe(pieces.length);
    }
  });

  it("picks a set from any number, so a random one needs no list on the page", () => {
    expect(setAt(setCount)!.id).toBe(setAt(0)!.id);
    expect(setAt(-1)!.id).toBe(setAt(setCount - 1)!.id);
    expect(setAt(2.7)!.id).toBe(setAt(2)!.id);
    expect(setAt(Number.NaN)).toBeNull();
  });
});
