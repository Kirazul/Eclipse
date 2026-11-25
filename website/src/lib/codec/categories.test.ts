import { describe, expect, it } from "vitest";
import { codeCategories } from "./categories";
import { OUTFIT_TAG } from "./outfit";

const code = (text: string) => OUTFIT_TAG + Buffer.from(text).toString("base64");

describe("a look's categories, read from its code", () => {
  it("files gear under Armor", () => {
    expect(codeCategories(code("slot 0 231001\n"))).toEqual(["Armor"]);
  });

  it("does not count a hidden slot as gear", () => {
    expect(codeCategories(code("slot 0 0\n"))).toEqual([]);
  });

  it("files a creature morph, a race morph, cosmetics and mounts by their lines", () => {
    expect(codeCategories(code("display 1234 0\n"))).toEqual(["Creature morph"]);
    expect(codeCategories(code("look 1 0 2 3 4 5 6\n"))).toEqual(["Race morph"]);
    expect(codeCategories(code("rlook 37 f 1 2 3\n"))).toEqual(["Race morph"]);
    expect(codeCategories(code("mount 134653\n"))).toEqual(["Mounted"]);
    expect(codeCategories(code("mountfly 134653\n"))).toEqual(["Mounted"]);
  });

  it("lists every category a look touches, in a fixed order", () => {
    expect(codeCategories(code("mount 5\nslot 4 1001735\ndisplay 9 0\n"))).toEqual(["Armor", "Creature morph", "Mounted"]);
  });

  it("files nothing for a code that will not decode", () => {
    expect(codeCategories("ECA1:!!!")).toEqual([]);
    expect(codeCategories("not a code")).toEqual([]);
  });
});
