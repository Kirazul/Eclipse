import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitPost, SearchEntry } from "@/lib/data/types";

vi.mock("server-only", () => ({}));

// after() needs a live request; here it runs the work and lets the test await it.
const pending: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (work: () => Promise<unknown>) => pending.push(work()) }));

let looks: OutfitPost[] = [];
let index: SearchEntry[] = [];
/** While set, the database takes this long to answer. */
let slowMs = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
vi.mock("@/lib/data", () => ({
  repository: {
    getOutfit: async (id: string) => (await wait(slowMs), looks.find((l) => l.id === id) ?? null),
    searchIndex: async () => (await wait(slowMs), index),
  },
}));

// Its own tests cover it; here it only answers, slowly while slowMs is set.
vi.mock("./add-to-wardrobe", () => ({
  addToWardrobe: async () => (await wait(slowMs), { content: "Added", flags: 64, allowed_mentions: { parse: [] } }),
}));

const { POST } = await import("./route");
const { lookId, timing } = await import("./commands");
const { siteUrl } = await import("@/lib/site");
const { emptyOutfit, encodeOutfit } = await import("@/lib/codec/outfit");
const { SLOT_NAMES } = await import("@/lib/domain");

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

let keys: CryptoKeyPair;
let publicHex = "";
const toHex = (bytes: ArrayBuffer) => Buffer.from(bytes).toString("hex");

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicHex = toHex(await crypto.subtle.exportKey("raw", keys.publicKey));
});

async function send(payload: unknown, sign: "good" | "bad" | "none" = "good") {
  const body = JSON.stringify(payload);
  const timestamp = "1762500000";
  const headers: Record<string, string> = { "x-signature-timestamp": timestamp };
  if (sign !== "none") {
    const sig = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body));
    headers["x-signature-ed25519"] = sign === "good" ? toHex(sig) : toHex(sig).replace(/^./, (c) => (c === "0" ? "1" : "0"));
  }
  return POST(new Request(`${siteUrl}/api/discord/interactions`, { method: "POST", headers, body }));
}

const command = (name: string, options: Record<string, string>) => ({
  type: 2,
  application_id: "app-1",
  token: "tok-1",
  data: { name, options: Object.entries(options).map(([n, value]) => ({ name: n, type: 3, value })) },
});

const edits: { url: string; method?: string; body: Record<string, unknown> }[] = [];
/** Discord's answers to each edit, in order; then 200. */
let editReplies: Response[] = [];

beforeEach(() => {
  looks = [post];
  index = [];
  edits.length = 0;
  pending.length = 0;
  slowMs = 0;
  editReplies = [];
  timing.inlineMs = 50;
  timing.retryMs = 1;
  timing.indexMs = 0;
  vi.stubEnv("DISCORD_PUBLIC_KEY", publicHex);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    edits.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
    return editReplies.shift() ?? new Response(null, { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Runs a command that answers at once, and returns its message. */
async function answered(payload: unknown) {
  const res = await send(payload);
  const body = await res.json();
  expect(body.type).toBe(4);
  expect(pending).toEqual([]);
  return body.data as Record<string, unknown>;
}

describe("Discord's signature", () => {
  it("answers Discord's PING when the signature is good", async () => {
    const res = await send({ type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("refuses a forged or missing signature before reading anything", async () => {
    expect((await send({ type: 1 }, "bad")).status).toBe(401);
    expect((await send({ type: 1 }, "none")).status).toBe(401);
  });

  it("refuses everything when no public key is set", async () => {
    vi.stubEnv("DISCORD_PUBLIC_KEY", "");
    expect((await send({ type: 1 })).status).toBe(401);
  });
});

describe("/look", () => {
  it("reads a look's id from its link or takes the id itself", () => {
    expect(lookId(`${siteUrl}/community-gallery/${post.id}`)).toBe(post.id);
    expect(lookId(`https://eclipsewow.vercel.app/community-gallery/${post.id}?from=discord`)).toBe(post.id);
    expect(lookId(` ${post.id} `)).toBe(post.id);
    expect(lookId("https://example.com/not a look")).toBeNull();
  });

  it("shows the look with its picture, code and a link, and pings nobody", async () => {
    const reply = await answered(command("look", { look: `${siteUrl}/community-gallery/${post.id}` }));
    expect(reply.allowed_mentions).toEqual({ parse: [] });
    expect(reply.flags).toBeUndefined();
    const [embed] = reply.embeds as Record<string, unknown>[];
    expect(embed.title).toBe(post.title);
    expect(embed.url).toBe(`${siteUrl}/community-gallery/${post.id}`);
    expect(embed.description).toContain("by Kira\\_\\*the\\*\\_Bold");
    expect(embed.description).toContain("9 upvotes");
    expect(embed.description).toContain(post.code);
    expect(embed.image).toEqual({ url: `${siteUrl}/community-gallery/${post.id}/cover` });
    expect(JSON.stringify(reply.components)).toContain(`${siteUrl}/community-gallery/${post.id}`);
  });

  it("says so, without the database, when the text is not a look's link", async () => {
    const res = await send(command("look", { look: "hello there" }));
    const body = await res.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(pending).toEqual([]);
  });

  it("says so when no look has that id", async () => {
    looks = [];
    const reply = await answered(command("look", { look: post.id }));
    expect(reply.content).toMatch(/no look/i);
    expect(reply.flags).toBe(64);
    expect(reply.embeds).toBeUndefined();
  });
});

describe("/community-gallery", () => {
  const entry = (n: number, title: string, author: string | null = "Kira"): SearchEntry => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title, author,
  });

  it("lists matching looks by title or creator, every word counting", async () => {
    index = [entry(1, "Frost in the Fens"), entry(2, "Ember Knight", "Frostbite"), entry(3, "Sunlit Robes")];
    const reply = await answered(command("gallery", { search: "frost" }));
    const [embed] = reply.embeds as Record<string, string>[];
    expect(embed.description).toContain("Frost in the Fens");
    expect(embed.description).toContain("Ember Knight");
    expect(embed.description).not.toContain("Sunlit");
  });

  it("shows five and links the rest to the Wardrobe's own search", async () => {
    index = Array.from({ length: 8 }, (_, i) => entry(i + 1, `Frost ${i + 1}`));
    const reply = await answered(command("gallery", { search: "frost" }));
    const [embed] = reply.embeds as Record<string, string>[];
    expect(embed.description.match(/\/community-gallery\/0000/g)).toHaveLength(5);
    expect(embed.description).toContain(`${siteUrl}/community-gallery?q=frost`);
    expect(embed.description).toContain("See all 8");
  });

  it("says so when nothing matches", async () => {
    index = [entry(1, "Sunlit Robes")];
    const reply = await answered(command("gallery", { search: "frost" }));
    expect(reply.content).toMatch(/no looks match/i);
  });

  it("still answers /wardrobe, the command's old name, until Discord forgets it", async () => {
    index = [entry(1, "Frost in the Fens")];
    const reply = await answered(command("wardrobe", { search: "frost" }));
    expect((reply.embeds as Record<string, string>[])[0].description).toContain("Frost in the Fens");
  });
});

describe("a slow answer", () => {
  const ORIGINAL = "https://discord.com/api/v10/webhooks/app-1/tok-1/messages/@original";

  it("shows Discord's thinking message, then edits the answer in", async () => {
    slowMs = 120;
    const res = await send(command("look", { look: post.id }));
    expect(await res.json()).toEqual({ type: 5 });
    await Promise.all(pending);
    expect(edits).toHaveLength(1);
    expect(edits[0].method).toBe("PATCH");
    expect(edits[0].url).toBe(ORIGINAL);
    expect((edits[0].body.embeds as Record<string, unknown>[])[0].title).toBe(post.title);
    expect(edits[0].body.flags).toBeUndefined();
  });

  it("tries the edit again while Discord has not made the thinking message yet", async () => {
    slowMs = 120;
    const unknown = () => Response.json({ message: "Unknown Webhook", code: 10015 }, { status: 404 });
    editReplies = [unknown(), unknown()];
    await send(command("look", { look: post.id }));
    await Promise.all(pending);
    expect(edits).toHaveLength(3);
    expect(edits.every((e) => e.url === ORIGINAL)).toBe(true);
  });

  it("gives up after a few tries rather than retrying forever", async () => {
    slowMs = 120;
    editReplies = Array.from({ length: 10 }, () => new Response("{}", { status: 404 }));
    await send(command("look", { look: post.id }));
    await Promise.all(pending);
    expect(edits.length).toBeLessThanOrEqual(4);
  });
});

const lookEntry = (n: number, title: string, author: string | null = "Kira"): SearchEntry => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title, author,
});

describe("/look's suggestions as you type", () => {
  const typing = (value: string) => ({
    type: 4,
    application_id: "app-1",
    token: "tok-1",
    data: { name: "look", type: 1, options: [{ name: "look", type: 3, value, focused: true }] },
  });

  it("offers the looks whose title or creator matches, each by its id", async () => {
    index = [lookEntry(1, "Frost in the Fens"), lookEntry(2, "Sunlit Robes"), lookEntry(3, "Ember", "Frostbite")];
    const res = await send(typing("fro"));
    expect(await res.json()).toEqual({
      type: 8,
      data: {
        choices: [
          { name: "Frost in the Fens by Kira", value: lookEntry(1, "").id },
          { name: "Ember by Frostbite", value: lookEntry(3, "").id },
        ],
      },
    });
  });

  it("keeps each choice inside Discord's limits", async () => {
    index = Array.from({ length: 40 }, (_, i) => lookEntry(i + 1, "x".repeat(150)));
    const { data } = await (await send(typing(""))).json();
    expect(data.choices).toHaveLength(25);
    expect(data.choices.every((c: { name: string }) => c.name.length <= 100)).toBe(true);
  });

  it("offers nothing rather than keep Discord waiting", async () => {
    index = [lookEntry(1, "Frost in the Fens")];
    slowMs = 120;
    expect(await (await send(typing("fro"))).json()).toEqual({ type: 8, data: { choices: [] } });
  });
});

describe("/decode", () => {
  const code = encodeOutfit({ ...emptyOutfit(), slots: { [SLOT_NAMES.indexOf("Main Hand")]: 420 } });

  it("lists what a code wears by name, for everyone to see, with a link to wear it", async () => {
    const reply = await answered(command("decode", { code }));
    expect(reply.flags).toBeUndefined();
    expect(reply.allowed_mentions).toEqual({ parse: [] });
    const [embed] = reply.embeds as Record<string, string>[];
    expect(embed.description).toContain("Main Hand");
    expect(embed.description).toContain("Simple Spear");
    expect(JSON.stringify(reply.components)).toContain(`${siteUrl}/loadouts?code=`);
  });

  it("says what is wrong when the text is not a code", async () => {
    const reply = await answered(command("decode", { code: "hello" }));
    expect(reply.flags).toBe(64);
    expect(reply.content).toMatch(/not an eclipse loadout code/i);
  });
});

describe("/item", () => {
  const typing = (value: string) => ({
    type: 4,
    application_id: "app-1",
    token: "tok-1",
    data: { name: "item", type: 1, options: [{ name: "name", type: 3, value, focused: true }] },
  });

  it("suggests pieces by name as you type, each with its slot and id, and sends the id", async () => {
    const { data } = await (await send(typing("dreadnaught chest"))).json();
    expect(data.choices).toContainEqual({ name: "Dreadnaught Chestguard · Chest · 1522416", value: "1522416" });
    expect(data.choices.every((c: { name: string }) => /dreadnaught/i.test(c.name) && /chest/i.test(c.name))).toBe(true);
  });

  it("keeps the suggestions inside Discord's limits, and offers nothing before anything is typed", async () => {
    const { data } = await (await send(typing("a"))).json();
    expect(data.choices).toHaveLength(25);
    expect(data.choices.every((c: { name: string }) => c.name.length <= 100)).toBe(true);
    expect((await (await send(typing("  "))).json()).data.choices).toEqual([]);
  });

  it("shows a picked piece for everyone: its slot, its quality, its icon and the id Eclipse's search finds it by", async () => {
    const reply = await answered(command("item", { name: "51008920" }));
    expect(reply.flags).toBeUndefined();
    expect(reply.allowed_mentions).toEqual({ parse: [] });
    const [embed] = reply.embeds as { title: string; description: string; thumbnail: { url: string } }[];
    expect(embed.title).toBe("Ascension Arrestor's Amice");
    expect(embed.description).toContain("Shoulders");
    expect(embed.description).toContain("Epic");
    expect(embed.description).toContain("51008920");
    expect(embed.thumbnail.url).toBe(`${siteUrl}/icons/inv_shoulder_cloth_earthendungeon_c_01.webp`);
  });

  it("draws a piece with no icon by its slot's own art, and leaves out a quality nobody recorded", async () => {
    const [embed] = (await answered(command("item", { name: "1522416" }))).embeds as { description: string; thumbnail: { url: string } }[];
    expect(embed.thumbnail.url).toBe(`${siteUrl}/wow/slots/chest.jpg`);
    expect(embed.description).not.toMatch(/quality/i);
  });

  it("finds a typed name without a pick when one piece has it", async () => {
    const [embed] = (await answered(command("item", { name: "simple spear" }))).embeds as { title: string; description: string }[];
    expect(embed.title).toBe("Simple Spear");
    expect(embed.description).toContain("Two-Hand");
    expect(embed.description).toContain("420");
  });

  it("lists the pieces a typed name fits, each with its id", async () => {
    const [embed] = (await answered(command("item", { name: "dreadnaught" }))).embeds as { description: string }[];
    expect(embed.description).toContain("Dreadnaught Chestguard");
    expect(embed.description).toContain("1522416");
    expect(embed.description).toContain("Dreadnaught Belt");
  });

  it("says so when no piece has that name or id", async () => {
    for (const name of ["zzqx no such thing", "999999999"]) {
      const reply = await answered(command("item", { name }));
      expect(reply.flags).toBe(64);
      expect(reply.content).toMatch(/no piece/i);
    }
  });
});

describe("/help", () => {
  it("answers the common problems for everyone, from the guide's own list, with a link to it", async () => {
    const { HELP } = await import("@/lib/help");
    const reply = await answered(command("help", {}));
    expect(reply.flags).toBeUndefined();
    expect(reply.allowed_mentions).toEqual({ parse: [] });
    const [embed] = reply.embeds as { description: string }[];
    for (const h of HELP) {
      expect(embed.description).toContain(h.question);
      expect(embed.description).toContain(h.answer);
    }
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(reply.components)).toContain(`${siteUrl}/guide#help`);
  });
});

describe("a message's right-click menu", () => {
  const message = (content: string) => ({
    id: "1400000000000000001",
    channel_id: "1554574140634046586",
    timestamp: "2026-11-10T12:00:00.000Z",
    content,
    author: { id: "354266414397390858", username: "shadow", global_name: "Shadow" },
    attachments: [],
  });
  const rightClick = (name: string, content: string) => ({
    type: 2,
    application_id: "app-1",
    token: "tok-1",
    data: { name, type: 3, target_id: "1400000000000000001", resolved: { messages: { "1400000000000000001": message(content) } } },
  });
  const code = encodeOutfit({ ...emptyOutfit(), slots: { [SLOT_NAMES.indexOf("Main Hand")]: 420 } });

  it("decodes the code in a message, for the asker alone", async () => {
    const reply = await answered(rightClick("Decode Eclipse code", `check this out ${code} :)`));
    expect(reply.flags).toBe(64);
    expect(JSON.stringify(reply.embeds)).toContain("Simple Spear");
  });

  it("says so when the message holds no code", async () => {
    const reply = await answered(rightClick("Decode Eclipse code", "no code here"));
    expect(reply.content).toMatch(/no eclipse code/i);
  });

  it("keeps a slow answer private while it thinks", async () => {
    slowMs = 120;
    const res = await send(rightClick("Add to Community Gallery", code));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    await Promise.all(pending);
    expect(edits[0].body.content).toBe("Added");
  });

  it("still runs the old \"Add to Wardrobe\" right-click until Discord forgets it", async () => {
    slowMs = 120;
    const res = await send(rightClick("Add to Wardrobe", code));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    await Promise.all(pending);
    expect(edits[0].body.content).toBe("Added");
  });
});

describe("answering in the asker's language", () => {
  const inRussian = (payload: ReturnType<typeof command>) => ({ ...payload, locale: "ru" });

  it("answers /help in Russian for a Russian Discord, from the same list", async () => {
    const reply = await answered(inRussian(command("help", {})));
    const [embed] = reply.embeds as { title: string; description: string }[];
    expect(embed.title).toBe("Частые проблемы");
    expect(embed.description).toContain("F2 ничего не делает");
    expect(embed.description).toContain("`dinput8.dll`");
  });

  it("names the slots in Russian, and keeps the piece's own name", async () => {
    const code = encodeOutfit({ ...emptyOutfit(), slots: { [SLOT_NAMES.indexOf("Main Hand")]: 420 } });
    const reply = await answered(inRussian(command("decode", { code })));
    const [embed] = reply.embeds as Record<string, string>[];
    expect(embed.description).toContain("Правая рука");
    expect(embed.description).toContain("Simple Spear");
  });

  it("falls back to English for a language the site does not have", async () => {
    const reply = await answered({ ...command("help", {}), locale: "de" });
    expect((reply.embeds as { title: string }[])[0].title).toBe("Common fixes");
  });
});
