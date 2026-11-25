import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/domain";
import { FEATURES } from "./features";

describe("the overlay's feature grid", () => {
  it("keeps the official page's sixteen features, in order", () => {
    expect(FEATURES.map((f) => f.title)).toEqual([
      "Wardrobe", "Customization", "Mounts", "Creature morph", "Enchants", "Incarnations",
      "Spell visuals", "Procs", "Optimize", "Titles", "Effects", "Colour", "World", "Font",
      "Loadouts", "Multiplayer",
    ]);
  });

  it("deep-links only to routes and filters that exist", () => {
    const linked = FEATURES.flatMap((f) => (f.href ? [f.href] : []));
    expect(linked.length).toBeGreaterThanOrEqual(7);
    for (const href of linked) {
      const url = new URL(href, "https://eclipse.test");
      expect(["/community-gallery", "/loadouts"], href).toContain(url.pathname);
      const category = url.searchParams.get("category");
      if (category) expect(CATEGORIES as readonly string[], href).toContain(category);
    }
  });

  it("links nothing a look code cannot carry", () => {
    // The overlay keeps these in their own files, so no Wardrobe look can show them.
    for (const title of ["Incarnations", "Spell visuals", "Procs"]) {
      expect(FEATURES.find((f) => f.title === title)?.href, title).toBeUndefined();
    }
  });
});
