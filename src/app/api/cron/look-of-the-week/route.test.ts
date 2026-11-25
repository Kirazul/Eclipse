import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

// The roles run after the answer, as next/server's after() runs them on Vercel.
const later: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (task: () => unknown) => void later.push(Promise.resolve().then(task)) }));
const settle = () => Promise.all(later.splice(0));

let pick: { post: OutfitPost; votes: number } | null = null;
vi.mock("@/lib/data", () => ({ repository: { lookOfTheWeek: async () => pick } }));

// The roles' own tests cover Discord; here only who is crowned, and that creators sync.
const crowned: (string | null)[] = [];
let synced = 0;
let rolesFail = false;
let rolesHang = false;
const order: string[] = [];
vi.mock("@/lib/discord-roles", () => ({
  crownLookOfTheWeek: async (look: string | null) => {
    order.push("roles");
    if (rolesHang) await new Promise(() => {});
    if (rolesFail) throw new Error("Discord is down");
    crowned.push(look);
  },
  syncCreators: async () => (synced++, 0),
}));

const { GET } = await import("./route");
const { siteUrl } = await import("@/lib/site");

const HOOK = "https://discord.test/api/webhooks/1/secret";
const post: OutfitPost = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Frost in the Fens",
  author: "Kira_*the*_Bold",
  authorId: "33333333-3333-4333-8333-333333333333",
  authorVerified: false,
  code: "ECA1:c2xvdCAwIDEK",
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 9,
  createdAt: "2026-11-01T00:00:00.000Z",
  gallery: ["https://stub.supabase.co/storage/v1/object/public/showcase/a/b.avif"],
};

const sent: { url: string; body: Record<string, unknown> }[] = [];
const call = (auth?: string) =>
  GET(new Request(`${siteUrl}/api/cron/look-of-the-week`, auth ? { headers: { authorization: auth } } : {}));

beforeEach(() => {
  pick = null;
  sent.length = 0;
  crowned.length = 0;
  synced = 0;
  rolesFail = false;
  rolesHang = false;
  order.length = 0;
  later.length = 0;
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("DISCORD_WEBHOOK_URL", HOOK);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    order.push("post");
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the weekly Discord post", () => {
  it("answers only Vercel's scheduler, which sends the cron secret", async () => {
    pick = { post, votes: 4 };
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("refuses everyone when no secret is set, rather than everyone being allowed", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("posts nothing in a quiet week", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posted: false });
    expect(sent).toEqual([]);
  });

  it("posts the look, its votes, its creator and its screenshot", async () => {
    pick = { post, votes: 4 };
    const res = await call("Bearer cron-secret");
    expect(await res.json()).toEqual({ posted: true, id: post.id });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(HOOK);
    const embed = (sent[0].body.embeds as Record<string, unknown>[])[0];
    expect(embed.title).toBe("Frost in the Fens");
    expect(embed.url).toBe(`${siteUrl}/community-gallery/${post.id}`);
    expect(embed.description).toContain("4 upvotes");
    expect(embed.image).toEqual({ url: `${siteUrl}/community-gallery/${post.id}/cover` });
  });

  it("never pings anyone, and shows a name's markdown as plain text", async () => {
    pick = { post, votes: 4 };
    await call("Bearer cron-secret");
    expect(sent[0].body.allowed_mentions).toEqual({ parse: [] });
    const embed = (sent[0].body.embeds as Record<string, unknown>[])[0];
    expect(embed.description).toContain("Kira\\_\\*the\\*\\_Bold");
  });

  it("shows the code in a block Discord gives a copy button", async () => {
    pick = { post, votes: 4 };
    await call("Bearer cron-secret");
    const embed = (sent[0].body.embeds as Record<string, unknown>[])[0];
    expect(embed.description).toContain("```\nECA1:c2xvdCAwIDEK\n```");
  });

  it("leaves the image out when the look has no screenshot", async () => {
    pick = { post: { ...post, gallery: [] }, votes: 2 };
    await call("Bearer cron-secret");
    expect((sent[0].body.embeds as Record<string, unknown>[])[0].image).toBeUndefined();
  });

  it("does nothing without a webhook", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    pick = { post, votes: 4 };
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ posted: false });
    expect(sent).toEqual([]);
  });

  it("hands the Look of the Week role to the winner, and keeps creators' roles current", async () => {
    pick = { post, votes: 4 };
    await call("Bearer cron-secret");
    await settle();
    expect(crowned).toEqual([post.id]);
    expect(synced).toBe(1);
  });

  it("takes the role back in a quiet week, also with no webhook", async () => {
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    await call("Bearer cron-secret");
    await settle();
    expect(crowned).toEqual([null]);
  });

  it("touches no role for a caller without the secret", async () => {
    await call("Bearer wrong");
    await settle();
    expect(crowned).toEqual([]);
    expect(synced).toBe(0);
  });

  it("still posts when the roles fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rolesFail = true;
    pick = { post, votes: 4 };
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ posted: true, id: post.id });
    await settle();
  });

  it("keeps creators' roles current when the Look of the Week role fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rolesFail = true;
    pick = { post, votes: 4 };
    await call("Bearer cron-secret");
    await settle();
    expect(synced).toBe(1);
    expect(logged).toHaveBeenCalled();
  });

  it("posts before it touches a role, so a slow Discord cannot hold the post back", async () => {
    rolesHang = true;
    pick = { post, votes: 4 };
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ posted: true, id: post.id });
    expect(order[0]).toBe("post");
  });

  it("reports a refused post as a failure, so the scheduler's log shows it", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    pick = { post, votes: 4 };
    expect((await call("Bearer cron-secret")).status).toBe(502);
  });
});
