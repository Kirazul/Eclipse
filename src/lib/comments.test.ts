import { describe, expect, it } from "vitest";
import { commentPage, commentSchema } from "./comments";
import { COMMENT_MAX } from "./limits";

// What the database's check accepts (the look_comments migration): 1 to 500 characters,
// no padding, and no control character but a line break.
const STORED = /^(?! |\n)[^\u0001-\u0009\u000b-\u001f\u007f]{1,500}(?<! |\n)$/u;

describe("a comment's text", () => {
  it("is trimmed and keeps its line breaks", () => {
    expect(commentSchema.parse("  Love the cape.\nWhere is the helm from?  \n")).toBe("Love the cape.\nWhere is the helm from?");
  });

  it("turns Windows line breaks and tabs into what the database keeps", () => {
    expect(commentSchema.parse("one\r\ntwo\tthree")).toBe("one\ntwo three");
  });

  it("closes up runs of blank lines to one", () => {
    expect(commentSchema.parse("one\n\n\n\n\ntwo")).toBe("one\n\ntwo");
  });

  it("refuses an empty comment and one past the limit", () => {
    expect(commentSchema.safeParse(" \n ").success).toBe(false);
    expect(commentSchema.safeParse("x".repeat(COMMENT_MAX + 1)).success).toBe(false);
    expect(commentSchema.parse("x".repeat(COMMENT_MAX))).toHaveLength(COMMENT_MAX);
  });

  it("drops invisible control characters rather than storing them", () => {
    expect(commentSchema.parse("bell\u0007 and\u001b escape")).toBe("bell and escape");
  });

  it("only ever hands the database text its check accepts", () => {
    for (const text of ["hi", " a \r\n\r\n\r\n b ", "\u0007x\u0007", "x\n\n\n", "é🙂\n\nok"]) {
      expect(commentSchema.parse(text)).toMatch(STORED);
    }
  });
});

describe("a look's description", () => {
  const base = {
    title: "A look",
    code: "ECA1:c2xvdCAwIDEK",
    gallery: ["11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.avif"],
  };

  it("is optional: left out or blank, the look has none", async () => {
    const { submitOutfitSchema } = await import("@/lib/codec/schema");
    expect(submitOutfitSchema.parse(base).description).toBeUndefined();
    expect(submitOutfitSchema.parse({ ...base, description: " \n " }).description).toBeUndefined();
  });

  it("is cleaned as a comment is, and kept to the limit", async () => {
    const { submitOutfitSchema } = await import("@/lib/codec/schema");
    expect(submitOutfitSchema.parse({ ...base, description: " Crystal set\r\n\r\n\r\nwith a cape " }).description)
      .toBe("Crystal set\n\nwith a cape");
    expect(submitOutfitSchema.safeParse({ ...base, description: "x".repeat(COMMENT_MAX + 1) }).success).toBe(false);
  });

  it("no longer needs typed tags", async () => {
    const { submitOutfitSchema } = await import("@/lib/codec/schema");
    expect(submitOutfitSchema.parse(base).tags).toEqual([]);
  });
});

describe("which page of a look's comments a link asks for", () => {
  it("is the newest page without one", () => {
    expect(commentPage(undefined)).toBe(1);
    expect(commentPage("")).toBe(1);
  });

  it("is the page a link names, counted back from the newest", () => {
    expect(commentPage("2")).toBe(2);
    expect(commentPage(["3", "4"])).toBe(3);
  });

  it("is the newest page for anything that is not a page", () => {
    for (const bad of ["0", "-2", "1.5", "two", "1e3", "99999999999"]) expect(commentPage(bad), bad).toBe(1);
  });
});
