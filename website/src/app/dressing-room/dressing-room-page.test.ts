import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SLOT_NAMES, VISIBLE_SLOTS } from "@/lib/domain";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", async () => {
  const { dressedCode } = await import("@/lib/dressing-room");
  const shared = { id: "shared", title: "A shared look", code: dressedCode({ 4: 0 }, { race: "nightelf", gender: 1 }) };
  return {
    repository: { live: true },
    getOutfit: async (id: string) => (id === shared.id ? shared : null),
  };
});

import { GET } from "../api/items/route";
import { GET as getSets } from "../api/sets/route";
import DressingRoomPage from "./page";

const render = async (look?: string) =>
  renderToStaticMarkup(await DressingRoomPage({ searchParams: Promise.resolve(look ? { look } : {}) }));

const ask = async (query: string) => {
  const res = GET(new NextRequest(`https://site.test/api/items${query}`));
  return (await res.json()) as { id: number; name: string }[];
};

const html = await render();

describe("a look opened from the Wardrobe", () => {
  it("starts with its hidden slots and race, and links back to it", async () => {
    const opened = await render("shared");
    expect(opened).toContain('href="/community-gallery/shared"');
    // The chest is hidden on purpose, and the code to copy is already there.
    expect(opened).toContain("Hidden");
    expect(opened).toContain('aria-label="Copy code"');
  });

  it("says where it started, from the messages, so the Russian site says it in Russian", async () => {
    const opened = await render("shared");
    expect(opened).toMatch(/Started from <a [^>]*href="\/community-gallery\/shared"[^>]*>A shared look<\/a>\. Its armor and race are on the rack/);
  });

  it("opens empty for a look that is gone", async () => {
    expect(await render("missing")).toBe(html);
  });
});

describe("the dressing room page", () => {

  it("offers every slot that shows on a character, and only those", () => {
    for (const slot of VISIBLE_SLOTS) expect(html).toContain(`aria-label="Choose ${SLOT_NAMES[slot]}"`);
    expect(html).not.toContain('aria-label="Choose Neck"');
  });

  it("offers the game's sets, but opens with none on the rack", () => {
    expect(html).toMatch(/role="tab"[^>]*>Sets</);
    expect(html).not.toContain("Random set");
    expect(html).not.toMatch(/in the 3D preview/);
  });

  it("has no code to copy before anything is chosen", () => {
    expect(html).not.toContain('aria-label="Copy code"');
  });

  it("says what the preview leaves out, so nobody mistakes it for the game", () => {
    expect(html).toMatch(/current game&#x27;s models/i);
    expect(html).toMatch(/without HD models or the race pack/i);
  });

  it("does not make the page wait for the character", () => {
    expect(html).toContain("Dressing the character");
  });

  // Rings and scenes are CC BY-NC-SA: the credit goes wherever they appear.
  it("credits the Narcissus art it shows", () => {
    expect(html).toContain("Peterodox");
  });
});

describe("the items route", () => {
  it("answers one slot's items", async () => {
    const hits = await ask("?slot=0");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("answers nothing for a slot it cannot read", async () => {
    expect(await ask("?slot=abc")).toEqual([]);
    expect(await ask("")).toEqual([]);
  });
});

describe("the sets route", () => {
  const sets = async (query: string) =>
    (await getSets(new NextRequest(`https://site.test/api/sets${query}`)).json()) as { id: number; name: string; pieces: Record<string, unknown> }[];

  it("finds sets by name", async () => {
    expect((await sets("?q=champion%27s%20battlegear")).map((s) => s.name)).toContain("Champion's Battlegear");
  });

  it("answers one set for any number, so a random pick is the visitor's own", async () => {
    const [one] = await sets("?at=123456789");
    expect(Object.keys(one!.pieces).length).toBeGreaterThan(0);
    expect(await sets("?at=abc")).toEqual([]);
  });
});
