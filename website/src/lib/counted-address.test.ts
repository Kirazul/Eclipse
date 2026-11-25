import { describe, expect, it } from "vitest";
import { countedAddress } from "./counted-address";

const SITE = "https://eclipse.test";

describe("the address a page view is counted under", () => {
  it("keeps the page", () => {
    expect(countedAddress(`${SITE}/community-gallery`)).toBe(`${SITE}/community-gallery`);
  });

  it("drops what follows it: a code to import, a search, a sign-in's answer", () => {
    expect(countedAddress(`${SITE}/loadouts?code=ECA1:c2xv&from=abc#top`)).toBe(`${SITE}/loadouts`);
    expect(countedAddress(`${SITE}/community-gallery?q=frost`)).toBe(`${SITE}/community-gallery`);
  });

  it("does not tell one private loadout from another", () => {
    expect(countedAddress(`${SITE}/sets/44444444-4444-4444-8444-444444444444`)).toBe(`${SITE}/sets/[id]`);
  });
});
