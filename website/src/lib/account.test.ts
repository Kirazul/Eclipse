import { describe, expect, it } from "vitest";
import { safeNext } from "./account";
import { displayNameSchema } from "./codec/schema";

describe("a public name", () => {
  it.each(["Kira", "kira_01", "sir.lee", "Zul'jin", "Lee Yam", "Ñandú", "ゆき"])("accepts %s", (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it("is stored without the spaces around it", () => {
    expect(displayNameSchema.parse("  Kira  ")).toBe("Kira");
  });

  it.each(["", " ", "x", "a".repeat(33), "<b>", "a​b", "-kira", "kira\nlee"])("refuses %j", (name) => {
    expect(displayNameSchema.safeParse(name).success).toBe(false);
  });
});

describe("the page to return to", () => {
  it.each([
    ["/inspector", "/inspector"],
    ["/community-gallery/set-1074", "/community-gallery/set-1074"],
    ["/community-gallery?armor=cloth", "/community-gallery?armor=cloth"],
  ])("keeps %s", (value, expected) => {
    expect(safeNext(value)).toBe(expected);
  });

  // A browser reads \ as /, so /\evil.com leaves the site just as //evil.com does.
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "/\t/evil.com", "wardrobe", "", null, undefined])(
    "sends %j to the Wardrobe",
    (value) => {
      expect(safeNext(value)).toBe("/community-gallery");
    },
  );
});
