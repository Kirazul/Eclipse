import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

const { announceLook } = await import("./look-feed");
const { siteUrl } = await import("@/lib/site");

const HOOK = "https://discord.test/api/webhooks/3/community-gallery";
const post: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "@everyone *free gold*",
  author: "Kira_",
  authorId: "33333333-3333-4333-8333-333333333333",
  authorVerified: false,
  code: "ECA1:c2xvdCAwIDEK",
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 0,
  createdAt: "2026-11-07T00:00:00.000Z",
  gallery: ["https://stub.supabase.co/storage/v1/object/public/showcase/a/b.avif"],
};

const sent: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubEnv("DISCORD_FEED_WEBHOOK_URL", HOOK);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the Wardrobe feed in Discord", () => {
  it("posts a new look with its title, author and picture, and pings nobody", async () => {
    await announceLook(post);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(HOOK);
    expect(sent[0].body.allowed_mentions).toEqual({ parse: [] });
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.title).toBe("@everyone *free gold*");
    expect(embed.url).toBe(`${siteUrl}/community-gallery/${post.id}`);
    expect(embed.description).toContain("Kira\\_");
    expect(embed.image).toEqual({ url: `${siteUrl}/community-gallery/${post.id}/cover` });
  });

  it("leaves the picture out when the look has no screenshot", async () => {
    await announceLook({ ...post, gallery: [] });
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.image).toBeUndefined();
  });

  it("shows the code in a block Discord gives a copy button", async () => {
    await announceLook(post);
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.description).toContain("```\nECA1:c2xvdCAwIDEK\n```");
  });

  it("sends a code too long to show, or one that would break out of its block, to the site", async () => {
    for (const code of [`ECA1:${"A".repeat(2000)}`, "ECA1:```@everyone"]) {
      sent.length = 0;
      await announceLook({ ...post, code });
      const [embed] = sent[0].body.embeds as Record<string, unknown>[];
      expect(embed.description).not.toContain("```");
      expect(embed.description).toContain("Community Gallery");
    }
  });

  it("sends nothing when no channel is set up", async () => {
    vi.stubEnv("DISCORD_FEED_WEBHOOK_URL", "");
    await announceLook(post);
    expect(sent).toEqual([]);
  });
});
