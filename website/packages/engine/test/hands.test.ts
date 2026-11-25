import { describe, expect, it } from "vitest";
import { handPose } from "../src/logic/retailGeo";
import { collectionFor, itemKey, wornAttachment } from "../src/wow/outfit";

describe("the two hands take anything", () => {
  it("an item goes where it is worn", () => {
    expect(wornAttachment("mainhand", 2)).toBe(1);
    expect(wornAttachment("offhand", 1)).toBe(2);
    expect(wornAttachment("ranged", 2)).toBe(2);
    expect(wornAttachment("head", 11)).toBe(11);
  });

  it("a shield stays on the arm in the off hand, and is held in the main", () => {
    expect(wornAttachment("offhand", 0)).toBe(0);
    expect(wornAttachment("mainhand", 0)).toBe(1);
  });

  it("each hand's copy is its own piece, armour is one piece wherever", () => {
    expect(itemKey("item-1", "mainhand")).not.toBe(itemKey("item-1", "offhand"));
    expect(itemKey("item-1", "head")).toBe("item-1");
    expect(itemKey("item-1")).toBe("item-1");
  });
});

describe("the mirror bits", () => {
  it("mirror in the hand the flag names, and only there", () => {
    expect(handPose(0x100, 1, false).mirrored).toBe(true);
    expect(handPose(0x100, 0, false).mirrored).toBe(false);
    expect(handPose(0x400, 0, false).mirrored).toBe(true);
  });

  it("a mirror turns the determinant over, which is what swaps the cull", () => {
    const [x, y, z] = handPose(0x100, 1, false).scale;
    expect(x * y * z).toBe(-1);
    const [a, b, c] = handPose(0, 1, false).scale;
    expect(a * b * c).toBe(1);
  });

  it("sheathed 0x800 toggles it, 0x1000 turns it about X with no mirror left over", () => {
    expect(handPose(0x100 | 0x800, 1, true).mirrored).toBe(false);
    expect(handPose(0x800, 1, true).mirrored).toBe(true);
    const flip = handPose(0x1000, 1, true);
    expect(flip.mirrored).toBe(false);
    expect(flip.scale[0] * flip.scale[1] * flip.scale[2]).toBe(1);
  });
});

describe("a body's collection", () => {
  it("its own, then its race, then anyone's, and a donor is only a name", () => {
    const c = { "human-male": { manifest: "a" }, orc: { manifest: "b" }, "*": { manifest: "c" }, "gnome-male": { manifest: "d", donor: "goblin-male" } };
    expect(collectionFor(c, "human-male")?.manifest).toBe("a");
    expect(collectionFor(c, "orc-female")?.manifest).toBe("b");
    expect(collectionFor(c, "troll-male")?.manifest).toBe("c");
    expect(collectionFor(c, "gnome-male")?.donor).toBe("goblin-male");
  });
});
