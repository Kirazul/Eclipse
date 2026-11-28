import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const PLAYER = "708022303841058907";
const STRANGER = "111111111111111111";
const LOOK = "11111111-1111-4111-8111-111111111111";
const POST = { id: LOOK, title: "Dark Ranger", code: "ECA1:abc" };

const acted: string[] = [];
let full = false;
let linked = true;
vi.mock("@/lib/data", () => ({ repository: { getOutfit: async (id: string) => (id === LOOK ? POST : null) } }));
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => true,
  discordVote: async (player: string, look: string, up: boolean) =>
    player === PLAYER ? (acted.push(`vote ${up} ${look} by ${player}`), up ? 3 : 2) : null,
  discordSendToGame: async (player: string, name: string, code: string) => {
    if (player !== PLAYER) return { account: false };
    acted.push(`send ${name} ${code} by ${player}`);
    return { account: true, sent: full ? null : { name, linked } };
  },
}));

const { lookButton, lookButtons } = await import("./look-buttons");
const { translator } = await import("./t");

const click = (customId: string, player: string | null = PLAYER) => lookButton({
  type: 3, application_id: "1", token: "t",
  ...(player ? { member: { user: { id: player } } } : {}),
  data: { name: "", custom_id: customId },
});
const content = async (p: ReturnType<typeof click>) => (await p).data.content;

beforeEach(() => {
  acted.length = 0;
  full = false;
  linked = true;
});

describe("look buttons", () => {
  it("sit beside the link with the look's id", () => {
    expect(lookButtons(LOOK, translator()).map((b) => b.custom_id)).toEqual([`look:up:${LOOK}`, `look:send:${LOOK}`]);
  });

  it("upvote as the clicker, privately, with a way to take it back", async () => {
    const answer = await click(`look:up:${LOOK}`);
    expect(acted).toEqual([`vote true ${LOOK} by ${PLAYER}`]);
    expect(answer.data.flags).toBe(64);
    expect(answer.data.content).toContain("3 upvotes");
    expect(JSON.stringify(answer.data.components)).toContain(`look:down:${LOOK}`);
    expect(await content(click(`look:down:${LOOK}`))).toContain("taken back");
  });

  it("send the look to the clicker's sets, and say when no game is linked or the sets are full", async () => {
    expect(await content(click(`look:send:${LOOK}`))).toContain("Sent to your game as Dark Ranger");
    expect(acted).toEqual([`send Dark Ranger ECA1:abc by ${PLAYER}`]);
    linked = false;
    expect(await content(click(`look:send:${LOOK}`))).toContain("Link your game");
    full = true;
    expect(await content(click(`look:send:${LOOK}`))).toContain("sets are full");
  });

  it("ask a Discord account with no site account to sign in once, and change nothing", async () => {
    expect(await content(click(`look:up:${LOOK}`, STRANGER))).toContain("Sign in once");
    expect(await content(click(`look:send:${LOOK}`, STRANGER))).toContain("Sign in once");
    expect(acted).toEqual([]);
  });

  it("refuse a look that is not public, an unknown button, and a click outside a server", async () => {
    expect(await content(click("look:up:22222222-2222-4222-8222-222222222222"))).toContain("No look");
    expect(await content(click("look:boom:x"))).toContain("not part of Eclipse");
    expect(await content(click(`look:up:${LOOK}`, null))).toContain("only in the Eclipse server");
    expect(acted).toEqual([]);
  });
});
