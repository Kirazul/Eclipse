import { describe, expect, it, vi } from "vitest";
import { decodeOutfit, OUTFIT_TAG, type Outfit } from "@/lib/codec/outfit";

vi.mock("server-only", () => ({}));
const { pieceTitle } = await import("./look-title");

/** A look wearing these items, slot by slot from the head down. */
function wearing(...items: number[]): Outfit {
  const slots = [0, 2, 4, 5, 6, 7, 8, 9, 14];
  const text = items.map((item, i) => `slot ${slots[i]} ${item}\n`).join("");
  const r = decodeOutfit(OUTFIT_TAG + Buffer.from(text).toString("base64"));
  if (!r.ok) throw new Error(r.error);
  return r.outfit;
}

describe("a look's title from what it wears", () => {
  it("is the name its pieces share in front", () => {
    // Dark Ranger General's Hood, Spaulder, Breastplate, Leggings
    expect(pieceTitle(wearing(210741, 210742, 210745, 210744))).toBe("Dark Ranger General");
  });

  it("is the name its pieces share behind", () => {
    // Crown, Girdle and Greatboots of the Golden King
    expect(pieceTitle(wearing(673306, 673307, 673308))).toBe("Golden King");
  });

  it("keeps the word that tells one variant of a set from another", () => {
    // Umbral Armbands, Touch, Skirt and Cassock of Lunar Communion
    expect(pieceTitle(wearing(278663, 278664, 278665, 278667))).toBe("Umbral Lunar Communion");
  });

  it("still finds the shared name among a few odd pieces", () => {
    // Three Dark Ranger General pieces with a wand and a rifle
    expect(pieceTitle(wearing(210741, 69, 210742, 410, 210745))).toBe("Dark Ranger General");
  });

  it("is the item set's name when the pieces share no name", () => {
    // Stormrage Mantle, Robes, Sash and Woolies: one word in common is not a name
    expect(pieceTitle(wearing(1516894, 1516889, 1516895, 1516893))).toBe("Stormrage Regalia");
  });

  it("is nothing for pieces with nothing in common", () => {
    // Reconditioned Icefury Wand, Goldshire Standard Issue Rifle, Crude Blunderbuss
    expect(pieceTitle(wearing(69, 410, 411))).toBeNull();
  });

  it("is nothing for one piece, or for hidden slots", () => {
    expect(pieceTitle(wearing(210741))).toBeNull();
    expect(pieceTitle(wearing(0, 0, 0))).toBeNull();
  });
});
