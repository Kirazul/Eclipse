import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const PLAYER = "354266414397390858";
const APP = "1400000000000000001";
const NOW = Date.parse("2026-11-20T06:00:00Z");

let accountFor: Record<string, { looks: number; upvotes: number; name: string | null }> = {};
let links: { discord_id: string; access_token: string; refresh_token: string; expires_at: string; stats: { looks: number; upvotes: number; name: string | null } }[] = [];
const db: string[] = [];
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => true,
  discordLinkSave: async (player: string) => (db.push(`save ${player}`), accountFor[player] ?? null),
  discordLinks: async () => links,
  discordLinkTokens: async (player: string, access: string) => void db.push(`tokens ${player} ${access}`),
  discordLinkForget: async (player: string) => void db.push(`forget ${player}`),
}));

const { GET: callback } = await import("@/app/api/discord/linked-roles/callback/route");
const { syncLinkedRoles, STATE_COOKIE } = await import("./linked-roles");

/** Discord, as the code sees it: the token endpoint, who the token is, and role data. */
/** What Discord answers a refresh with, when not a new token. */
let refreshAnswer: (() => Response) | null = null;
const calls: { url: string; method: string; body: string }[] = [];

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_SECRET", "client-secret");
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  accountFor = { [PLAYER]: { looks: 3, upvotes: 41, name: "Kira" } };
  links = [];
  db.length = 0;
  calls.length = 0;
  refreshAnswer = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = init.body ? String(init.body) : "";
    calls.push({ url, method: init.method ?? "GET", body });
    if (url.endsWith("/applications/@me")) return Response.json({ id: APP });
    if (url.endsWith("/oauth2/token")) {
      if (body.includes("refresh_token") && refreshAnswer) return refreshAnswer();
      return Response.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 604800 });
    }
    if (url.endsWith("/users/@me")) return Response.json({ id: PLAYER });
    if (url.includes("/role-connection")) return Response.json({});
    return new Response(null, { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const back = (query: string, cookie?: string) =>
  callback(new NextRequest(`https://eclipse.test/api/discord/linked-roles/callback?${query}`, {
    headers: cookie ? { cookie: `${STATE_COOKIE}=${cookie}` } : {},
  }));
const statusOf = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("status");

describe("connecting Discord for Linked Roles", () => {
  it("keeps the player and tells Discord their looks and upvotes", async () => {
    const res = await back("code=abc&state=s1", "s1");
    expect(statusOf(res)).toBe("ok");
    expect(db).toEqual([`save ${PLAYER}`]);
    const push = calls.find((c) => c.url.includes("/role-connection"))!;
    expect(push.url).toBe(`https://discord.com/api/v10/users/@me/applications/${APP}/role-connection`);
    expect(JSON.parse(push.body)).toEqual({
      platform_name: "Eclipse",
      platform_username: "Kira",
      metadata: { looks: "3", upvotes: "41" },
    });
  });

  it("refuses an answer this browser did not ask for, before touching Discord", async () => {
    for (const res of [await back("code=abc&state=s1", "other"), await back("code=abc&state=s1")]) {
      expect(statusOf(res)).toBe("failed");
    }
    expect(calls).toEqual([]);
    expect(db).toEqual([]);
  });

  it("says so when the Discord account has no Eclipse account", async () => {
    accountFor = {};
    const res = await back("code=abc&state=s1", "s1");
    expect(statusOf(res)).toBe("no-account");
    expect(calls.some((c) => c.url.includes("/role-connection"))).toBe(false);
  });

  it("does nothing until the app's OAuth secret is set", async () => {
    vi.stubEnv("DISCORD_CLIENT_SECRET", "");
    expect(statusOf(await back("code=abc&state=s1", "s1"))).toBe("off");
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 0, forgotten: 0 });
    expect(calls).toEqual([]);
  });
});

describe("the daily refresh", () => {
  const link = (expires: string) => ({
    discord_id: PLAYER, access_token: "old-access", refresh_token: "old-refresh", expires_at: expires,
    stats: { looks: 5, upvotes: 60, name: "Kira" },
  });

  it("pushes each player's current numbers with the token it holds", async () => {
    links = [link("2026-11-25T00:00:00Z")];
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 1, forgotten: 0 });
    const push = calls.find((c) => c.url.includes("/role-connection"))!;
    expect(JSON.parse(push.body).metadata).toEqual({ looks: "5", upvotes: "60" });
    expect(calls.some((c) => c.url.endsWith("/oauth2/token"))).toBe(false);
  });

  it("renews a token near its end and keeps the new one", async () => {
    links = [link("2026-11-20T12:00:00Z")];
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 1, forgotten: 0 });
    expect(db).toEqual([`tokens ${PLAYER} fresh-access`]);
  });

  it("forgets a player who removed the connection in Discord", async () => {
    links = [link("2026-11-20T12:00:00Z")];
    refreshAnswer = () => Response.json({ error: "invalid_grant" }, { status: 400 });
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 0, forgotten: 1 });
    expect(db).toEqual([`forget ${PLAYER}`]);
  });

  // None of these says the player removed anything, so the connection must survive them.
  it.each([
    ["a rate limit", () => Response.json({ message: "slow down", retry_after: 5 }, { status: 429 })],
    ["an outage", () => new Response("bad gateway", { status: 502 })],
    ["our own secret being wrong", () => Response.json({ error: "invalid_client" }, { status: 401 })],
    ["a malformed request of ours", () => Response.json({ error: "invalid_request" }, { status: 400 })],
  ])("keeps a player through %s", async (_, answer) => {
    links = [link("2026-11-20T12:00:00Z")];
    refreshAnswer = answer;
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 0, forgotten: 0 });
    expect(db).toEqual([]);
  });

  it("goes on to the next player when one fails", async () => {
    links = [link("2026-11-20T12:00:00Z"), { ...link("2026-11-25T00:00:00Z"), discord_id: "708022303841058907" }];
    refreshAnswer = () => { throw new TypeError("fetch failed"); };
    expect(await syncLinkedRoles(NOW)).toEqual({ pushed: 1, forgotten: 0 });
    expect(db).toEqual([]);
  });
});
