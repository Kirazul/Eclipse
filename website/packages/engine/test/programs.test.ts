import { describe, expect, it } from "vitest";
import { CATALOGUE_PROGRAMS, batchProgram, blendState } from "../src/wow/programs";

describe("the programs warmed for the item catalogue", () => {
  /** Measured over every GLB of the catalogue's items: combiner case, side, alpha key. */
  const MEASURED = [
    "12|front|-", "6|double|-", "6|front|-", "15|front|-", "1|front|-", "0|front|-", "1|front|key", "7|double|-", "12|double|-",
    "14|front|-", "1|double|key", "1|double|-", "4|front|-", "9|front|-", "15|double|-", "14|double|-", "8|front|-", "7|front|-",
    "29|front|-", "0|double|-", "21|front|-", "13|front|-", "36|double|-", "6|double|key", "29|double|-", "20|front|-",
  ];

  it("cover every program a real item asks for, once each", () => {
    const keys = CATALOGUE_PROGRAMS.map((r) => `${batchProgram(r.units, r.shader).combiner}|${r.flags & 4 ? "double" : "front"}|${blendState(r.blend, r.flags).alphaKey ? "key" : "-"}`);
    expect([...keys].sort()).toEqual([...MEASURED].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("edge fade", () => {
  it("is retail's on the programs that have it, and only them", () => {
    expect(batchProgram(2, 0x8021).edgeFade).toBe(true);
    expect(batchProgram(2, 0x8015).edgeFade).toBe(true);
    expect(batchProgram(2, 0x8000).edgeFade).toBe(false);
    expect(batchProgram(2, 0x4014).edgeFade).toBe(false);
  });
  it("a second UV set is read by the programs that name it", () => {
    expect(batchProgram(2, 0x4014).uvSources.slice(0, 2)).toEqual([0, 1]);
    expect(batchProgram(2, 0x14).uvSources.slice(0, 2)).toEqual([0, 0]);
  });
});
