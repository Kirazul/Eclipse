import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const WINNER = "354266414397390858";
const BEFORE = "708022303841058907";
const GUILD = "1111111111111111111";
const CREATOR = "2222222222222222222";
const WEEK = "3333333333333333333";

let holder: string | null = null;
let creators: string[] = [];
let lookOwner: Record<string, string | null> = {};
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => true,
  discordIdOfLook: async (look: string) => lookOwner[look] ?? null,
  discordHasLooks: async (id: string) => creators.includes(id),
  discordCreators: async () => creators,
  swapRoleHolder: async (_: string, next: string | null) => {
    const previous = holder;
    holder = next;
    return previous;
  },
}));

const roles = await import("./discord-roles");

const calls: string[] = [];
let status = 204;

beforeEach(() => {
  holder = null;
  creators = [];
  lookOwner = { "look-1": WINNER, "set-1": null };
  calls.length = 0;
  status = 204;
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_GUILD_ID", GUILD);
  vi.stubEnv("DISCORD_CREATOR_ROLE_ID", CREATOR);
  vi.stubEnv("DISCORD_WEEK_ROLE_ID", WEEK);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url.replace("https://discord.com/api/v10", "")}`);
    return new Response(status === 204 ? null : "{}", { status });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const role = (method: string, member: string, id: string) => `${method} /guilds/${GUILD}/members/${member}/roles/${id}`;

describe("the Look of the Week role", () => {
  it("passes from last week's player to this week's", async () => {
    holder = BEFORE;
    await roles.crownLookOfTheWeek("look-1");
    expect(calls).toEqual([role("DELETE", BEFORE, WEEK), role("PUT", WINNER, WEEK)]);
  });

  it("goes back in a quiet week, and is not taken from a player who wins again", async () => {
    holder = WINNER;
    await roles.crownLookOfTheWeek("look-1");
    expect(calls).toEqual([role("PUT", WINNER, WEEK)]);
    calls.length = 0;
    await roles.crownLookOfTheWeek(null);
    expect(calls).toEqual([role("DELETE", WINNER, WEEK)]);
    expect(holder).toBeNull();
  });

  it("goes to nobody when the winner is one of the game's own sets", async () => {
    await roles.crownLookOfTheWeek("set-1");
    expect(calls).toEqual([]);
  });
});

describe("the Gallery Creator role", () => {
  it("goes to everyone with a look", async () => {
    creators = [WINNER, BEFORE];
    expect(await roles.syncCreators()).toBe(2);
    expect(calls).toEqual([role("PUT", WINNER, CREATOR), role("PUT", BEFORE, CREATOR)]);
  });

  it("goes to whoever a newly published look belongs to", async () => {
    await roles.grantCreatorOfLook("look-1");
    expect(calls).toEqual([role("PUT", WINNER, CREATOR)]);
  });

  it("is taken back only once a player's last look is gone", async () => {
    creators = [WINNER];
    await roles.recheckCreator(WINNER);
    expect(calls).toEqual([]);
    creators = [];
    await roles.recheckCreator(WINNER);
    expect(calls).toEqual([role("DELETE", WINNER, CREATOR)]);
  });

  it("shrugs off a player who is not in the server", async () => {
    status = 404;
    await expect(roles.grantCreator(WINNER)).resolves.toBeUndefined();
  });
});

describe("with a piece of the setup missing", () => {
  it("hands nothing out", async () => {
    vi.stubEnv("DISCORD_WEEK_ROLE_ID", "");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    creators = [WINNER];
    await roles.crownLookOfTheWeek("look-1");
    await roles.syncCreators();
    expect(calls).toEqual([]);
  });
});
