import { describe, expect, it } from "vitest";
import golden from "./golden/fields.json";
import { decodeOutfit, encodeOutfit } from "./outfit";

/**
 * Codes the real C++ wrote and read back (Eclipse-Viewer's golden/fields.json, made by
 * its harness from Morph.cpp and Share.cpp). Each `again` is what the game writes after
 * importing `code`, so this port must write exactly the same.
 */
describe("the codec against the game's own C++", () => {
  for (const c of golden as { name: string; code: string; again: string }[]) {
    it(c.name, () => {
      const decoded = decodeOutfit(c.code);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) return;
      expect(encodeOutfit(decoded.outfit)).toBe(c.again);
    });
  }
});
