import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowcaseMessage } from "@/lib/showcase-post";
import type { Interaction } from "./reply";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The admin key, the bot and the image work are stubbed: what is proved is who may ask, who
// may answer, what the player sees, and that a refused answer writes nothing.
let configured = true;
let alreadyLook: string | null = null;
let turn: "ok" | "asked" | "slow" = "ok";
let racedTo: string | null = null;
const asked: string[] = [];
const unasked: string[] = [];
const imported: { id: string; code: string; discordId: string; title: string; gallery: string[] }[] = [];
const removed: string[] = [];
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => configured,
  lookOfMessage: async () => alreadyLook,
  askCode: async (message: string, asker: string) => (asked.push(`${message} by ${asker}`), turn),
  unaskCode: async (message: string) => void unasked.push(message),
  storeScreenshot: async () => {},
  removeScreenshots: async (paths: string[]) => void removed.push(...paths),
  importDiscordLook: async (id: string, look: { code: string; discordId: string; title: string }, gallery: string[]) => {
    imported.push({ id, code: look.code, discordId: look.discordId, title: look.title, gallery });
    return racedTo ?? id;
  },
}));

let later: ShowcaseMessage[] = [];
let current: ShowcaseMessage | null = null;
let canPost = true;
const posted: { channel: string; message: string; body: { content: string; components: unknown[] } }[] = [];
vi.mock("@/lib/discord-bot", () => ({
  botConfigured: () => configured,
  messagesAfter: async () => later,
  messagesBefore: async () => [],
  messageOf: async () => current,
  replyTo: async (channel: string, message: string, body: { content: string; components: unknown[] }) => {
    if (canPost) posted.push({ channel, message, body });
    return canPost;
  },
  download: async () => Buffer.from("png"),
}));
vi.mock("@/lib/data/compress", () => ({
  compressScreenshot: async () => ({ full: Buffer.from("full"), thumb: Buffer.from("thumb") }),
}));
const granted: string[] = [];
vi.mock("@/lib/discord-roles", () => ({ grantCreator: async (id: string) => void granted.push(id) }));
const announced: string[] = [];
vi.mock("@/lib/look-feed", () => ({ announceLook: async (look: { id: string }) => void announced.push(look.id) }));
vi.mock("@/lib/data", () => ({ repository: { getOutfit: async (id: string) => ({ id }) } }));

const { askForCode, codeForm, saveCode } = await import("./ask-code");
const { SHOWCASE_CHANNEL } = await import("@/lib/showcase-post");
const { siteUrl } = await import("@/lib/site");

const PLAYER = "354266414397390858";
const ASKER = "708022303841058907";
const POST = "1400000000000000009";
const GUILD = "1200000000000000001";
const IMAGE = { url: "https://cdn.discordapp.com/attachments/1/2/shot.png", content_type: "image/png" };
// A real code: Simple Spear in the main hand.
const CODE = "ECA1:c2xvdCAxNSA0MjAK";
const MANAGE_MESSAGES = String(1 << 13);

const post = (over: Partial<ShowcaseMessage> = {}): ShowcaseMessage => ({
  id: POST,
  channel_id: SHOWCASE_CHANNEL,
  timestamp: "2026-11-10T12:00:00.000Z",
  content: "Frost knight",
  author: { id: PLAYER, username: "shadow", global_name: "Shadow" },
  attachments: [IMAGE, IMAGE],
  ...over,
});

const who = (id: string, permissions = "0") => ({ user: { id, username: "someone", global_name: "Some_one" }, permissions });

const ask = (message = post(), asker = ASKER, over: Partial<Interaction> = {}): Interaction => ({
  type: 2, application_id: "app-1", token: "tok-1", guild_id: GUILD, channel_id: SHOWCASE_CHANNEL, member: who(asker),
  data: { name: "Ask for the code", type: 3, target_id: message.id, resolved: { messages: { [message.id]: message } } },
  ...over,
});

const press = (asker = PLAYER, permissions = "0"): Interaction => ({
  type: 3, application_id: "app-1", token: "tok-1", guild_id: GUILD, channel_id: SHOWCASE_CHANNEL, member: who(asker, permissions),
  message: { id: "1400000000000000020" },
  data: { name: "", custom_id: `code:add:${POST}:${PLAYER}` },
});

const submit = (code: string, title = "", asker = PLAYER, over: Partial<Interaction> = {}): Interaction => ({
  type: 5, application_id: "app-1", token: "tok-1", guild_id: GUILD, channel_id: SHOWCASE_CHANNEL, member: who(asker),
  message: { id: "1400000000000000020" },
  data: {
    name: "", custom_id: `code:save:${POST}:${PLAYER}`,
    components: [
      { type: 18, component: { type: 4, custom_id: "code", value: code } },
      { type: 18, component: { type: 4, custom_id: "title", value: title } },
    ],
  },
  ...over,
});

beforeEach(() => {
  configured = true;
  alreadyLook = null;
  turn = "ok";
  racedTo = null;
  later = [];
  current = post();
  canPost = true;
  for (const list of [asked, unasked, imported, removed, posted, granted, announced]) list.length = 0;
});

describe("Ask for the code", () => {
  it("asks under the post, with a button for its player, and tells only the asker", async () => {
    const reply = await askForCode(ask());
    expect(asked).toEqual([`${POST} by ${ASKER}`]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ channel: SHOWCASE_CHANNEL, message: POST });
    // The name is shown as typed, never as markdown.
    expect(posted[0].body.content).toContain("Some\\_one");
    expect(JSON.stringify(posted[0].body.components)).toContain(`code:add:${POST}:${PLAYER}`);
    expect(reply.flags).toBe(64);
    expect(reply.content).toContain("Shadow");
  });

  it("does not ask for a code that is already there", async () => {
    expect((await askForCode(ask(post({ content: CODE })))).content).toContain(`/channels/${GUILD}/${SHOWCASE_CHANNEL}/${POST}`);
    later = [post({ id: "1400000000000000011", content: CODE, attachments: [], timestamp: "2026-11-10T12:05:00.000Z" })];
    expect((await askForCode(ask())).content).toContain("/1400000000000000011");
    later = [];
    alreadyLook = "11111111-1111-4111-8111-111111111111";
    expect((await askForCode(ask())).content).toContain(`${siteUrl}/community-gallery/${alreadyLook}`);
    expect(posted).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("asks once per post, and slows a person who asks for many", async () => {
    turn = "asked";
    expect((await askForCode(ask())).content).toMatch(/already/i);
    turn = "slow";
    expect((await askForCode(ask())).content).toMatch(/hour/i);
    expect(posted).toEqual([]);
  });

  it("gives the post's own player the button, asking nobody", async () => {
    const reply = await askForCode(ask(post(), PLAYER));
    expect(reply.flags).toBe(64);
    expect(JSON.stringify(reply.components)).toContain(`code:add:${POST}:${PLAYER}`);
    expect(asked).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("is for showcase posts with a player's screenshot", async () => {
    expect((await askForCode(ask(post({ attachments: [] })))).content).toMatch(/no screenshot/i);
    expect((await askForCode(ask(post({ author: { id: PLAYER, username: "bot", global_name: null, bot: true } })))).content).toMatch(/no screenshot/i);
    expect((await askForCode(ask(post(), ASKER, { channel_id: "1999999999999999999" }))).content).toContain(`<#${SHOWCASE_CHANNEL}>`);
    expect(posted).toEqual([]);
  });

  it("takes the request back when the bot cannot post it", async () => {
    canPost = false;
    expect((await askForCode(ask())).content).toMatch(/could not post/i);
    expect(unasked).toEqual([POST]);
  });

  it("says it is not switched on without the keys it needs", async () => {
    configured = false;
    expect((await askForCode(ask())).content).toMatch(/not switched on/i);
  });
});

describe("the button under a request", () => {
  it("opens a form for the post's player, and for a moderator", () => {
    for (const interaction of [press(), press(ASKER, MANAGE_MESSAGES)]) {
      const answer = codeForm(interaction);
      expect(answer.type).toBe(9);
      expect(JSON.stringify(answer.data)).toContain(`code:save:${POST}:${PLAYER}`);
    }
  });

  it("refuses anyone else", () => {
    const answer = codeForm(press(ASKER));
    expect(answer.type).toBe(4);
    expect(JSON.stringify(answer.data)).toMatch(/only the player who posted/i);
  });

  it.each(["en-US", "ru"])("keeps the form inside Discord's limits in %s", (locale) => {
    const { data } = codeForm({ ...press(), locale }) as { data: { title: string; components: { label: string; description?: string; component: { placeholder?: string } }[] } };
    expect(data.title.length).toBeLessThanOrEqual(45);
    for (const field of data.components) {
      expect(field.label.length).toBeLessThanOrEqual(45);
      expect((field.description ?? "").length).toBeLessThanOrEqual(100);
      expect((field.component.placeholder ?? "").length).toBeLessThanOrEqual(100);
    }
  });
});

describe("the code its player gives", () => {
  it("adds the look and puts the code where it was asked for", async () => {
    const answer = await saveCode(submit(`  ${CODE} `));
    expect(imported).toHaveLength(1);
    const [look] = imported;
    expect(look).toMatchObject({ code: CODE, discordId: PLAYER, title: "Frost knight" });
    expect(look.gallery).toHaveLength(2);
    expect(granted).toEqual([PLAYER]);
    expect(announced).toEqual([look.id]);
    // The request itself becomes the answer, with nothing left to press but the link.
    expect(answer.type).toBe(7);
    expect(answer.data.content).toContain(CODE);
    expect(answer.data.content).toContain(`${siteUrl}/community-gallery/${look.id}`);
    expect(JSON.stringify(answer.data.components)).not.toContain("code:add");
    expect(answer.data.allowed_mentions).toEqual({ parse: [] });
  });

  it("takes a title of the player's own", async () => {
    await saveCode(submit(CODE, "  Warden of the North "));
    expect(imported[0].title).toBe("Warden of the North");
    expect((await saveCode(submit(CODE, "ab"))).data.content).toMatch(/at least 3/i);
    expect(imported).toHaveLength(1);
  });

  it("is refused, privately and with nothing written, when it is not a code", async () => {
    for (const text of ["soon", "ECA1:AAAA", "ECW1:AAAA"]) {
      const answer = await saveCode(submit(text));
      expect(answer.type).toBe(4);
      expect(answer.data.flags).toBe(64);
      expect(answer.data.content).toMatch(/not an Eclipse loadout code/i);
    }
    expect(imported).toEqual([]);
  });

  it("is refused from anyone but the post's player or a moderator", async () => {
    expect((await saveCode(submit(CODE, "", ASKER))).data.content).toMatch(/only the player who posted/i);
    await saveCode(submit(CODE, "", ASKER, { member: who(ASKER, MANAGE_MESSAGES) }));
    expect(imported.map((l) => l.discordId)).toEqual([PLAYER]);
  });

  it("is refused when the post is gone, or is not that player's", async () => {
    current = null;
    expect((await saveCode(submit(CODE))).data.content).toMatch(/gone/i);
    current = post({ author: { id: ASKER, username: "x", global_name: null } });
    expect((await saveCode(submit(CODE))).data.content).toMatch(/gone/i);
    expect(imported).toEqual([]);
  });

  it("settles on the look already there when the same code was published before", async () => {
    racedTo = "22222222-2222-4222-8222-222222222222";
    const answer = await saveCode(submit(CODE));
    expect(answer.type).toBe(7);
    expect(answer.data.content).toContain(`/community-gallery/${racedTo}`);
    expect(removed.length).toBeGreaterThan(0);
    expect(announced).toEqual([]);
  });
});
