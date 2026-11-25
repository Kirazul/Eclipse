import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

let pick: { post: OutfitPost; votes: number } | null = null;
vi.mock("@/lib/data", () => ({ repository: { live: true, lookOfTheWeek: async () => pick } }));

const { LookOfTheWeek } = await import("./look-of-the-week");
const { dressedCode } = await import("@/lib/dressing-room");

const post: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Frost in the Fens",
  author: "Kira",
  authorId: "33333333-3333-4333-8333-333333333333",
  authorVerified: false,
  code: dressedCode({ 0: 1339122 }, null)!,
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 12,
  createdAt: "2026-11-01T00:00:00.000Z",
  gallery: [],
};

const render = async () => {
  const el = await LookOfTheWeek();
  return el ? renderToStaticMarkup(el) : "";
};

beforeEach(() => {
  pick = null;
});

describe("the look of the week", () => {
  it("shows nothing in a quiet week, not an empty section", async () => {
    expect(await render()).toBe("");
  });

  it("names the look, its votes this week and its creator", async () => {
    pick = { post, votes: 7 };
    const html = await render();
    expect(html).toContain("Look of the week");
    expect(html).toContain("Frost in the Fens");
    expect(html).toContain("with 7 votes");
    expect(html).toContain(`href="/creators/${post.authorId}"`);
    expect(html).toContain(`href="/community-gallery/${post.id}"`);
  });
});
