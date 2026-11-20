import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));
vi.mock("@/app/actions", () => ({ voteOutfit: vi.fn(), votedLooks: vi.fn() }));

import { OutfitCard, OutfitPoster } from "./outfit-card";

const POST: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Raid night",
  author: "Someone",
  authorId: "22222222-2222-4222-8222-222222222222",
  authorVerified: false,
  code: `ECA1:${Buffer.from("slot 0 259306\nslot 4 1001735\n").toString("base64")}`,
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 12,
  createdAt: "2026-11-01T00:00:00.000Z",
  gallery: ["https://example.test/capture.webp"],
};

const render = (post: OutfitPost) => renderToStaticMarkup(createElement(OutfitPoster, { post }));

describe("a Showcase poster", () => {
  it("can be voted on where it is seen, beside its code", () => {
    const html = render(POST);
    expect(html).toContain('aria-label="Upvote, 12 votes"');
    expect(html).toContain('aria-label="Copy code"');
  });

  it("shows no count nobody could have recorded", () => {
    const html = render({ ...POST, upvotes: null });
    expect(html).not.toContain("Upvote");
    expect(html).toContain('aria-label="Copy code"');
  });
});

describe("a Community Gallery card", () => {
  const card = (post: OutfitPost) => renderToStaticMarkup(createElement(OutfitCard, { post }));

  it("leads with the look's own capture when it has one", () => {
    expect(card(POST)).toContain("capture-thumb.webp");
  });

  it("shows no picture for a look that has none", () => {
    const html = card({ ...POST, gallery: [] });
    expect(html).not.toContain("capture");
    expect(html).toContain('aria-label="Copy code"');
  });

  it("stays clean: no strip of item icons", () => {
    expect(card(POST)).not.toMatch(/class="hex[\s"]/);
  });

  it("keeps the details off the card at rest: they show on hover only", () => {
    const html = card({ ...POST, className: "Death Knight", race: "dwarf", armor: "plate" });
    expect(html).not.toContain(">+3<");
    expect(html).not.toContain(">+4<");
    expect(html).not.toMatch(/truncate rounded-\[6px\] border border-line px-2/);
  });

  it("shows how many copied it, once anyone has", () => {
    expect(card({ ...POST, copies: 1234 })).toContain(">1,234 copies<");
    expect(card({ ...POST, copies: 1234 })).toContain(">1.2K<");
    expect(card({ ...POST, copies: 1 })).toContain(">1 copy<");
    expect(card({ ...POST, copies: 0 })).not.toContain("copies");
    expect(card(POST)).not.toContain("copies");
  });

  it("says when it was posted", () => {
    expect(card(POST)).toContain("Nov 1, 2026");
    expect(card({ ...POST, createdAt: null })).not.toContain("2026");
  });

  it("keeps the caption and the other details for hover", () => {
    const html = card({ ...POST, race: "dwarf", description: "Made for raid night" });
    expect(html).toContain("Made for raid night");
    expect(html).toContain(">Armor<");
    expect(card({ ...POST, categories: [] })).not.toContain("group-hover:opacity-100");
  });

  it("labels a private look, and only a private one", () => {
    expect(card({ ...POST, isPrivate: true })).toMatch(/<\/svg>Private<\/span>/);
    expect(card(POST)).not.toContain(">Private<");
  });
});
