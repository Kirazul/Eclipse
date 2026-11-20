import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookComment, OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

let look: OutfitPost | null = null;
let comment: LookComment | null = null;
vi.mock("@/lib/data", () => ({ repository: { getOutfit: async () => look, getComment: async () => comment } }));

const { alertCommentReport, alertModerators } = await import("./moderation-alert");
const { siteUrl } = await import("@/lib/site");

const HOOK = "https://discord.test/api/webhooks/2/mods";
const post: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "@everyone *free gold*",
  author: "Kira",
  authorId: "33333333-3333-4333-8333-333333333333",
  authorVerified: false,
  code: "ECA1:c2xvdCAwIDEK",
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 2,
  createdAt: "2026-11-01T00:00:00.000Z",
  gallery: ["https://stub.supabase.co/storage/v1/object/public/showcase/a/b.avif"],
};

const said: LookComment = {
  id: "55555555-5555-4555-8555-555555555555",
  outfitId: post.id,
  authorId: "44444444-4444-4444-8444-444444444444",
  author: "Spammer\_1",
  authorVerified: false,
  authorAvatar: null,
  body: "@here buy **gold** at example dot com",
  createdAt: "2026-11-13T00:00:00.000Z",
};

const sent: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  look = post;
  comment = said;
  sent.length = 0;
  vi.stubEnv("DISCORD_MOD_WEBHOOK_URL", HOOK);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the moderators' Discord alert", () => {
  it("names the look, the reason and where to review it, and pings nobody", async () => {
    await alertModerators(post.id, "spam");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(HOOK);
    expect(sent[0].body.allowed_mentions).toEqual({ parse: [] });
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.title).toBe("Reported: @everyone *free gold*");
    expect(embed.url).toBe(`${siteUrl}/community-gallery/${post.id}`);
    expect(embed.description).toContain("Spam or advertising");
    expect(embed.description).toContain(`${siteUrl}/moderation`);
    expect(embed.description).toContain("Kira");
    expect(embed.thumbnail).toEqual({ url: `${siteUrl}/community-gallery/${post.id}/cover` });
  });

  it("never says who sent the report", async () => {
    await alertModerators(post.id, "other");
    expect(JSON.stringify(sent[0].body)).not.toMatch(/reporter|reported by/i);
  });

  it("sends nothing when no channel is set up", async () => {
    vi.stubEnv("DISCORD_MOD_WEBHOOK_URL", "");
    await alertModerators(post.id, "spam");
    expect(sent).toEqual([]);
  });

  it("sends nothing for a look that is already gone", async () => {
    look = null;
    await alertModerators(post.id, "spam");
    expect(sent).toEqual([]);
  });

  it("leaves the picture out when the look has no screenshot", async () => {
    look = { ...post, gallery: [] };
    await alertModerators(post.id, "spam");
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.thumbnail).toBeUndefined();
  });
});

describe("the moderators' alert for a comment", () => {
  it("quotes the comment as typed, names the look and the reason, and pings nobody", async () => {
    await alertCommentReport(said.id, "offensive");
    expect(sent).toHaveLength(1);
    expect(sent[0].body.allowed_mentions).toEqual({ parse: [] });
    const [embed] = sent[0].body.embeds as Record<string, unknown>[];
    expect(embed.title).toBe("Reported comment on @everyone *free gold*");
    expect(embed.url).toBe(`${siteUrl}/community-gallery/${post.id}#comment-${said.id}`);
    expect(embed.description).toContain("Offensive or abusive");
    expect(embed.description).toContain(String.raw`Spammer\_1`);
    expect(embed.description).toContain(String.raw`buy \*\*gold\*\*`);
    expect(embed.description).toContain(`${siteUrl}/moderation`);
  });

  it("never says who sent the report", async () => {
    await alertCommentReport(said.id, "spam");
    expect(JSON.stringify(sent[0].body)).not.toMatch(/reporter|reported by/i);
  });

  it("sends nothing for a comment that is already gone, or with no channel set up", async () => {
    comment = null;
    await alertCommentReport(said.id, "spam");
    comment = said;
    vi.stubEnv("DISCORD_MOD_WEBHOOK_URL", "");
    await alertCommentReport(said.id, "spam");
    expect(sent).toEqual([]);
  });
});

describe("the alert's Keep and Delete buttons", () => {
  const CHANNEL = "1300000000000000001";
  let botAnswers = 200;
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];

  beforeEach(() => {
    calls.length = 0;
    botAnswers = 200;
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (method === "GET" && url === HOOK) return Response.json({ channel_id: CHANNEL });
      if (url.includes("/channels/")) return new Response(null, { status: botAnswers });
      return new Response(null, { status: 204 });
    });
  });

  it("has the bot post the alert in the webhook's channel, with buttons naming the look", async () => {
    await alertModerators(post.id, "spam");
    const posted = calls.find((c) => c.method === "POST")!;
    expect(posted.url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages`);
    expect(posted.body!.allowed_mentions).toEqual({ parse: [] });
    const [row] = posted.body!.components as { components: { custom_id?: string; url?: string }[] }[];
    expect(row.components.map((b) => b.custom_id ?? b.url)).toEqual([
      `mod:keep:look:${post.id}`, `mod:ask:look:${post.id}`, `${siteUrl}/moderation`,
    ]);
  });

  it("names the comment on a comment's alert", async () => {
    await alertCommentReport(said.id, "spam");
    const posted = calls.find((c) => c.method === "POST")!;
    const [row] = posted.body!.components as { components: { custom_id?: string }[] }[];
    expect(row.components[0].custom_id).toBe(`mod:keep:comment:${said.id}`);
  });

  it("still alerts through the webhook, without buttons, when the bot may not post there", async () => {
    botAnswers = 403;
    await alertModerators(post.id, "spam");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.at(-1)!.url).toBe(HOOK);
    expect(posts.at(-1)!.body!.components).toBeUndefined();
  });
});
