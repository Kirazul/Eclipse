import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowcaseMessage } from "@/lib/showcase-post";
import type { Interaction } from "./reply";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The admin key, the bot and the image work are stubbed: what is proved here is who may
// add a post, what gets written, and that a failed or repeated add leaves nothing behind.
let configured = true;
let alreadyLook: string | null = null;
/** What import_discord_look hands back for a race, instead of the new id. */
let racedTo: string | null = null;
const stored: string[] = [];
const removed: string[] = [];
const imported: { id: string; gallery: string[]; discordId: string; title: string }[] = [];
vi.mock("@/lib/data/admin", () => ({
  adminConfigured: () => configured,
  lookOfMessage: async () => alreadyLook,
  storeScreenshot: async (path: string) => void stored.push(path),
  removeScreenshots: async (paths: string[]) => void removed.push(...paths),
  importDiscordLook: async (id: string, look: { discordId: string; title: string }, gallery: string[]) => {
    imported.push({ id, gallery, discordId: look.discordId, title: look.title });
    return racedTo ?? id;
  },
}));

let history: ShowcaseMessage[] = [];
let readable = true;
vi.mock("@/lib/discord-bot", () => ({
  botConfigured: () => configured,
  messagesBefore: async () => history,
  download: async () => (readable ? Buffer.from("png") : null),
}));
vi.mock("@/lib/data/compress", () => ({
  compressScreenshot: async () => ({ full: Buffer.from("full"), thumb: Buffer.from("thumb") }),
}));
const granted: string[] = [];
vi.mock("@/lib/discord-roles", () => ({ grantCreator: async (id: string) => void granted.push(id) }));
const announced: string[] = [];
vi.mock("@/lib/look-feed", () => ({ announceLook: async (post: { id: string }) => void announced.push(post.id) }));
vi.mock("@/lib/data", () => ({ repository: { getOutfit: async (id: string) => ({ id }) } }));

const { addToWardrobe } = await import("./add-to-wardrobe");
const { SHOWCASE_CHANNEL } = await import("@/lib/showcase-post");
const { siteUrl } = await import("@/lib/site");

const PLAYER = "354266414397390858";
const STRANGER = "708022303841058907";
const POST = "1400000000000000009";
const IMAGE = { url: "https://cdn.discordapp.com/attachments/1/2/shot.png", content_type: "image/png" };
// A real code: Simple Spear in the main hand.
const CODE = "ECA1:c2xvdCAxNSA0MjAK";

const post = (over: Partial<ShowcaseMessage> = {}): ShowcaseMessage => ({
  id: POST,
  channel_id: SHOWCASE_CHANNEL,
  timestamp: "2026-11-10T12:00:00.000Z",
  content: `Frost knight ${CODE}`,
  author: { id: PLAYER, username: "shadow", global_name: "Shadow" },
  attachments: [IMAGE, IMAGE],
  ...over,
});

const click = (message: ShowcaseMessage, asker = PLAYER, permissions = "0", channel = SHOWCASE_CHANNEL): Interaction => ({
  type: 2,
  application_id: "app-1",
  token: "tok-1",
  channel_id: channel,
  member: { user: { id: asker }, permissions },
  data: { name: "Add to Community Gallery", type: 3, target_id: message.id, resolved: { messages: { [message.id]: message } } },
});

beforeEach(() => {
  configured = true;
  alreadyLook = null;
  racedTo = null;
  history = [];
  readable = true;
  for (const list of [stored, removed, imported, granted, announced]) list.length = 0;
});

describe("Add to Community Gallery", () => {
  it("adds the post, its screenshots and caption, credits its player and announces it", async () => {
    const reply = await addToWardrobe(click(post()));
    expect(imported).toHaveLength(1);
    const [look] = imported;
    expect(look).toMatchObject({ discordId: PLAYER, title: "Frost knight" });
    expect(look.gallery).toHaveLength(2);
    expect(look.gallery.every((p) => p.startsWith(`discord/${look.id}/`) && p.endsWith(".avif"))).toBe(true);
    // Each screenshot's thumbnail goes up before it, as the site uploads.
    expect(stored).toHaveLength(4);
    expect(stored[0]).toMatch(/-thumb\.avif$/);
    expect(granted).toEqual([PLAYER]);
    expect(announced).toEqual([look.id]);
    expect(reply.flags).toBe(64);
    expect(reply.content).toContain(`${siteUrl}/community-gallery/${look.id}`);
  });

  it("lets a moderator add someone else's post", async () => {
    await addToWardrobe(click(post(), STRANGER, String(1 << 13)));
    expect(imported).toHaveLength(1);
  });

  it("refuses anyone else, and posts outside the showcase", async () => {
    const stranger = await addToWardrobe(click(post(), STRANGER));
    expect(stranger.content).toMatch(/only the player who posted/i);
    const elsewhere = await addToWardrobe(click(post(), PLAYER, "0", "1999999999999999999"));
    expect(elsewhere.content).toMatch(/only posts in/i);
    expect(imported).toEqual([]);
  });

  it("links the look a post already became, writing nothing", async () => {
    alreadyLook = "11111111-1111-4111-8111-111111111111";
    const reply = await addToWardrobe(click(post()));
    expect(reply.content).toContain(`/community-gallery/${alreadyLook}`);
    expect(stored).toEqual([]);
  });

  it("finds the player's picture the code was asked for", async () => {
    const picture = post({ id: "1400000000000000001", content: "Frost knight", timestamp: "2026-11-10T11:50:00.000Z" });
    history = [picture];
    await addToWardrobe(click(post({ content: CODE, attachments: [] })));
    expect(imported[0].title).toBe("Frost knight");
  });

  it("says why when the post has no code or no picture", async () => {
    expect((await addToWardrobe(click(post({ content: "nice" })))).content).toMatch(/no eclipse code/i);
    expect((await addToWardrobe(click(post({ attachments: [] })))).content).toMatch(/no screenshot/i);
    expect(imported).toEqual([]);
  });

  it("takes its screenshots back when one cannot be read, or another click added it first", async () => {
    readable = false;
    await addToWardrobe(click(post()));
    expect(imported).toEqual([]);

    readable = true;
    racedTo = "22222222-2222-4222-8222-222222222222";
    const reply = await addToWardrobe(click(post()));
    expect(removed.sort()).toEqual([...stored].sort());
    expect(reply.content).toContain(`/community-gallery/${racedTo}`);
    expect(announced).toEqual([]);
  });

  it("says it is not switched on without the keys it needs", async () => {
    configured = false;
    expect((await addToWardrobe(click(post()))).content).toMatch(/not switched on/i);
  });
});
