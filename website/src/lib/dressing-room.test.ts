import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { decodeOutfit } from "@/lib/codec/outfit";
import { resolveOutfit } from "@/lib/catalog";
import { dressedCode, startingRack } from "./dressing-room";

const decode = (code: string | null) => {
  const r = decodeOutfit(code ?? "");
  if (!r.ok) throw new Error(r.error);
  return r.outfit;
};

describe("a dressing room code", () => {
  it("has nothing to say until something is chosen", () => {
    expect(dressedCode({}, null)).toBeNull();
  });

  it("reads back in the game's format with every piece in its slot", () => {
    expect(decode(dressedCode({ 0: 1339122, 15: 410 }, null)).slots).toEqual({ 0: 1339122, 15: 410 });
  });

  it("hides a slot with item 0, which the game reads as hidden on purpose", () => {
    expect(decode(dressedCode({ 0: 0 }, null)).slots).toEqual({ 0: 0 });
  });

  it("leaves the race alone unless one is chosen", () => {
    expect(decode(dressedCode({ 0: 1339122 }, null)).look).toBeNull();
  });

  it("opens a published look with its pieces, hidden slots and race", () => {
    const outfit = decode(dressedCode({ 0: 1339122, 4: 0 }, { race: "nightelf", gender: 1 }));
    const rack = startingRack(outfit, resolveOutfit(outfit));
    expect(rack.look).toEqual({ race: "nightelf", gender: 1, choices: null });
    expect(rack.pieces[4]).toBeNull();
    expect(rack.pieces[0]).toMatchObject({ id: 1339122 });
    // The rack gives the same code back, so nothing is lost on the way in.
    const again = dressedCode(Object.fromEntries(Object.entries(rack.pieces).map(([s, p]) => [s, p?.id ?? 0])), rack.look);
    expect(decode(again).slots).toEqual(outfit.slots);
  });

  it("leaves out what the Dressing room cannot dress", () => {
    // A ring shows on no character.
    const outfit = decode(dressedCode({ 0: 1339122, 10: 5976 }, null));
    const rack = startingRack(outfit, resolveOutfit(outfit));
    expect(Object.keys(rack.pieces)).toEqual(["0"]);
    expect(rack.look).toBeNull();
  });

  it("writes a chosen race as a look with the default appearance", () => {
    expect(decode(dressedCode({}, { race: "nightelf", gender: 1 })).look).toEqual({
      kind: "look", race: 4, gender: 1, skin: 0, face: 0, hairStyle: 0, hairColour: 0, facialHair: 0,
    });
  });

  it("writes a retail race as an rlook over the classic body a player without it wears", () => {
    const outfit = decode(dressedCode({}, { race: "vulpera", gender: 0 }));
    expect(outfit.look).toMatchObject({ kind: "rlook", race: "vulpera", sex: "m", line: "rlook vulpera m" });
    expect(outfit.fallback).toMatchObject({ kind: "look", race: 7, gender: 0 });
  });

  it("writes a chosen appearance as retail's option and choice ids", () => {
    const outfit = decode(dressedCode({}, { race: "human", gender: 1, choices: [[10, 3], [12, 7]] }));
    expect(outfit.look).toMatchObject({ kind: "rlook", line: "rlook human f 10:3 12:7" });
    expect(outfit.fallback).toMatchObject({ race: 1, gender: 1 });
  });

  it("opens a retail look with its appearance", () => {
    const outfit = decode(dressedCode({ 0: 1339122 }, { race: "vulpera", gender: 1, choices: [[10, 3]] }));
    expect(startingRack(outfit, resolveOutfit(outfit)).look).toEqual({ race: "vulpera", gender: 1, choices: [[10, 3]] });
  });
});
