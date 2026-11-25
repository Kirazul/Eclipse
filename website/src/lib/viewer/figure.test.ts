import { describe, expect, it } from "vitest";
import { bodyOf, lookTextOf, slotIdOf, wearerOf, wornOf } from "./figure";

describe("slotIdOf", () => {
  it("names the visible morph slots as the viewer does", () => {
    expect(slotIdOf(0)).toBe("head");
    expect(slotIdOf(14)).toBe("back");
    expect(slotIdOf(15)).toBe("mainhand");
    expect(slotIdOf(18)).toBe("tabard");
  });

  it("has no name for slots nothing draws", () => {
    expect(slotIdOf(1)).toBeNull();
    expect(slotIdOf(12)).toBeNull();
  });
});

describe("bodyOf", () => {
  it("dresses a classic race in its retail body", () => {
    expect(bodyOf({ race: 10, gender: 1 })).toBe("bloodelf-female");
    expect(bodyOf({ race: 1, gender: 0 })).toBe("human-male");
  });

  it("dresses a retail race by its key", () => {
    expect(bodyOf({ race: "vulpera", gender: 0 })).toBe("vulpera-male");
  });

  it("stands a human in for an unknown or missing race", () => {
    expect(bodyOf(null)).toBe("human-male");
    expect(bodyOf({ race: 999, gender: 1 })).toBe("human-female");
  });
});

describe("lookTextOf", () => {
  it("turns an rlook line's choices into the engine's look text", () => {
    expect(lookTextOf("rlook vulpera m 10:3 12:7")).toBe("10.3,12.7");
  });

  it("is undefined when a line chooses nothing", () => {
    expect(lookTextOf("rlook human f")).toBeUndefined();
    expect(lookTextOf(undefined)).toBeUndefined();
  });
});

describe("wornOf", () => {
  it("names each drawn slot's pack and drops slots nothing draws", () => {
    expect(wornOf({ 0: 1234, 1: 99, 15: 5678 })).toEqual([
      ["head", "item-1234"],
      ["mainhand", "item-5678"],
    ]);
  });

  it("keeps a worn piece with no baked model, so the page can say so", () => {
    expect(wornOf({ 4: null })).toEqual([["chest", null]]);
  });
});

describe("wearerOf", () => {
  it("keeps an rlook line whole, for its face and hair", () => {
    const line = "rlook vulpera f 10:3";
    expect(wearerOf({ kind: "rlook", race: "vulpera", sex: "f", line })).toEqual({ race: "vulpera", gender: 1, line });
  });

  it("reads a classic look's race and sex", () => {
    expect(wearerOf({ kind: "look", race: 4, gender: 1, skin: 0, face: 0, hairStyle: 0, hairColour: 0, facialHair: 0 })).toEqual({ race: 4, gender: 1 });
  });

  it("is null when the code has no look", () => {
    expect(wearerOf(null)).toBeNull();
  });
});
