import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const pending: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (work: () => Promise<unknown>) => pending.push(work()) }));
vi.mock("@/lib/data", () => ({ repository: {} }));

const MOD = "354266414397390858";
const PLAYER = "708022303841058907";
const LOOK = "11111111-1111-4111-8111-111111111111";
const ALERT = "1300000000000000009";
const CHANNEL = "1300000000000000001";

/** What the database was asked to do, by whom. */
const acted: string[] = [];
let gone = false;
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => true,
  discordIsModerator: async (player: string) => player === MOD,
  discordKeepReported: async (player: string, kind: string, id: string) => (acted.push(`keep ${kind} ${id} by ${player}`), !gone),
  discordDeleteReported: async (player: string, kind: string, id: string) => (acted.push(`delete ${kind} ${id} by ${player}`), !gone),
}));

const { POST } = await import("./route");
const { siteUrl } = await import("@/lib/site");

let keys: CryptoKeyPair;
const toHex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex");

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  vi.stubEnv("DISCORD_PUBLIC_KEY", toHex(await crypto.subtle.exportKey("raw", keys.publicKey)));
});

const fetched: { url: string; method: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  acted.length = 0;
  fetched.length = 0;
  gone = false;
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    fetched.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(null, { status: 200 });
  });
});

afterEach(async () => {
  await Promise.all(pending.splice(0));
  vi.unstubAllGlobals();
});

async function clicks(customId: string, user = MOD, message = ALERT) {
  const body = JSON.stringify({
    type: 3,
    application_id: "app-1",
    token: "tok-1",
    guild_id: "1200000000000000001",
    channel_id: CHANNEL,
    member: { user: { id: user, username: "kira", global_name: "Kira_*" } },
    message: { id: message },
    data: { custom_id: customId, component_type: 2 },
  });
  const timestamp = "1762500000";
  const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
  const res = await POST(new Request(`${siteUrl}/api/discord/interactions`, {
    method: "POST",
    headers: { "x-signature-timestamp": timestamp, "x-signature-ed25519": toHex(sig) },
    body,
  }));
  return (await res.json()) as { type: number; data: { content?: string; flags?: number; components?: { components: { custom_id: string }[] }[] } };
}

describe("the Keep and Delete buttons on a report alert", () => {
  it("keeps a look for a moderator and settles the alert with who kept it", async () => {
    const answer = await clicks(`mod:keep:look:${LOOK}`);
    expect(acted).toEqual([`keep look ${LOOK} by ${MOD}`]);
    expect(answer.type).toBe(7);
    expect(answer.data.content).toBe("Kept by Kira\\_\\*.");
    expect(answer.data.components).toEqual([]);
  });

  it("refuses anyone who is not a site moderator, privately, and touches nothing", async () => {
    for (const id of [`mod:keep:look:${LOOK}`, `mod:ask:look:${LOOK}`, `mod:delete:look:${LOOK}:${ALERT}`]) {
      const answer = await clicks(id, PLAYER);
      expect(answer.type).toBe(4);
      expect(answer.data.flags).toBe(64);
      expect(answer.data.content).toContain("moderators");
    }
    expect(acted).toEqual([]);
  });

  it("asks before deleting, privately, with a button that names the alert", async () => {
    const answer = await clicks(`mod:ask:comment:${LOOK}`);
    expect(acted).toEqual([]);
    expect(answer.type).toBe(4);
    expect(answer.data.flags).toBe(64);
    expect(answer.data.components![0].components[0].custom_id).toBe(`mod:delete:comment:${LOOK}:${ALERT}`);
  });

  it("deletes on the second click, and settles the alert as the bot", async () => {
    const answer = await clicks(`mod:delete:look:${LOOK}:${ALERT}`, MOD, "1300000000000000077");
    expect(acted).toEqual([`delete look ${LOOK} by ${MOD}`]);
    expect(answer.type).toBe(7);
    expect(answer.data.content).toBe("Deleted the look.");
    const edit = fetched.find((f) => f.method === "PATCH")!;
    expect(edit.url).toBe(`https://discord.com/api/v10/channels/${CHANNEL}/messages/${ALERT}`);
    expect(edit.body).toMatchObject({ content: "Deleted by Kira\\_\\*.", components: [] });
  });

  it("says so when another moderator got there first", async () => {
    gone = true;
    const answer = await clicks(`mod:keep:comment:${LOOK}`);
    expect(answer.data.content).toBe("This comment was already deleted.");
  });

  it("ignores buttons it does not know", async () => {
    const answer = await clicks("mod:explode:look:x");
    expect(answer.type).toBe(4);
    expect(acted).toEqual([]);
  });
});
