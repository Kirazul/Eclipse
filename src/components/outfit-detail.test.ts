import { prerenderToNodeStream } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LookComment, OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/community-gallery",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/app/actions", () => ({ voteOutfit: vi.fn(), votedLooks: vi.fn() }));

const data = vi.hoisted(() => ({ comments: [] as LookComment[], total: null as number | null, reads: 0, pages: [] as (number | undefined)[] }));
vi.mock("@/lib/data", () => ({
  repository: {
    live: true,
    isBookmarked: async () => false,
    listComments: async (_: string, page?: number) => {
      data.reads++;
      data.pages.push(page);
      return { comments: data.comments, total: data.total ?? data.comments.length };
    },
  },
}));

const { OutfitDetail } = await import("./outfit-detail");
const { dressedCode } = await import("@/lib/dressing-room");

const POST: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Frost in the Fens",
  author: "Edvin",
  authorId: null,
  sharedOnDiscord: true,
  authorVerified: false,
  code: dressedCode({ 0: 1339122 }, null)!,
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 3,
  createdAt: null,
  gallery: ["https://example.test/capture.webp"],
};

const COMMENT: LookComment = {
  id: "44444444-4444-4444-8444-444444444444",
  outfitId: POST.id,
  authorId: "33333333-3333-4333-8333-333333333333",
  author: "Kira",
  authorAvatar: null,
  authorVerified: false,
  body: "Lovely colours",
  createdAt: "2026-11-02T00:00:00.000Z",
};

async function render(post: OutfitPost, commentPage?: number) {
  // Its comments are an async server component of their own, which a static render waits for.
  const { prelude } = await prerenderToNodeStream(await OutfitDetail({ post, commentPage }));
  let html = "";
  for await (const chunk of prelude) html += String(chunk);
  return html;
}

/** The classes of the element whose opening tag holds the marker, or of the element that opens just before it. */
const classesOf = (html: string, marker: string, parent = false) => {
  let open = html.lastIndexOf("<", html.indexOf(marker));
  if (parent) open = html.lastIndexOf("<", open - 1);
  return html.slice(open, html.indexOf(">", open)).match(/class="([^"]*)"/)?.[1] ?? "";
};

beforeEach(() => {
  data.comments = [];
  data.total = null;
  data.reads = 0;
  data.pages = [];
});

describe("a look's byline", () => {
  // In a flex row each run of text is an item of its own, and the row's gap would sit
  // between the name and its comma: "by Edvin , shared on Discord".
  it("reads as a sentence, with no space before its comma", async () => {
    const html = await render(POST);
    const line = html.match(/<(\w+)(?: class="([^"]*)")?>by <span class="text-ink">Edvin<\/span>, shared on Discord/);
    expect(line).not.toBeNull();
    expect(line![2] ?? "").not.toMatch(/\bflex\b|\bgap-/);
  });

  it("keeps the creator's link in the sentence", async () => {
    const html = await render({ ...POST, authorId: "33333333-3333-4333-8333-333333333333", sharedOnDiscord: false });
    const line = html.match(/<(\w+)(?: class="([^"]*)")?>by <a [^>]*href="\/creators\/33333333-3333-4333-8333-333333333333"/);
    expect(line).not.toBeNull();
    expect(line![2] ?? "").not.toMatch(/\bflex\b|\bgap-/);
  });
});

describe("a look's page layout", () => {
  it("keeps the conversation beside the picture once someone has commented", async () => {
    data.comments = [COMMENT];
    const html = await render(POST);
    expect(html).toContain("Lovely colours");
    expect(classesOf(html, 'aria-label="Comments"')).toContain("lg:col-start-2");
    expect(classesOf(html, 'aria-label="Use this look"', true)).toContain("lg:col-start-1");
  });

  it("keeps the author's caption beside the picture, as the start of the conversation", async () => {
    const html = await render({ ...POST, description: "Made for the Fens" });
    expect(html).toContain("Made for the Fens");
    expect(classesOf(html, 'aria-label="Comments"')).toContain("lg:col-start-2");
  });

  it("puts what the look wears beside the picture, and the empty conversation below, when nobody has said anything", async () => {
    const html = await render(POST);
    const aside = classesOf(html, 'aria-label="Comments"');
    expect(aside).not.toContain("lg:col-start-2");
    expect(aside).toContain("lg:row-start-2");
    expect(classesOf(html, 'aria-label="Use this look"', true)).toContain("lg:col-start-2");
    // Still there to write the first comment.
    expect(html).toContain('id="comments"');
  });

  it("reads the comments once", async () => {
    await render(POST);
    expect(data.reads).toBe(1);
  });
});

describe("a look with more comments than one page shows", () => {
  it("opens on the newest, with a link back to older ones and the count of them all", async () => {
    data.comments = [COMMENT];
    data.total = 450;
    const html = await render(POST);
    expect(data.pages).toEqual([1]);
    expect(html).toContain(`href="/community-gallery/${POST.id}?comments=2#comments"`);
    expect(html).toContain("Show older comments");
    expect(html).toContain(">450<");
    expect(html).not.toContain("Show newer comments");
  });

  it("reaches back a page at a time, and forward again to the newest", async () => {
    data.comments = [COMMENT];
    data.total = 450;
    const html = await render(POST, 3);
    expect(data.pages).toEqual([3]);
    expect(html).not.toContain("Show older comments");
    expect(html).toContain(`href="/community-gallery/${POST.id}?comments=2#comments"`);
    expect(html).toContain("Show newer comments");
  });

  it("shows no link when every comment fits", async () => {
    data.comments = [COMMENT];
    const html = await render(POST);
    expect(html).not.toContain("Show older comments");
    expect(html).not.toContain("Show newer comments");
  });
});
