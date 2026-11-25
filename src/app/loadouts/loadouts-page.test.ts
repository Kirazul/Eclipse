import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, GameLink, GameSet, OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/loadouts",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions", () => ({
  createGameLinkCode: vi.fn(),
  inspectCode: vi.fn(async () => ({ kind: "error", error: "" })),
  publishOutfit: vi.fn(),
  removeGameSet: vi.fn(),
  removeScreenshot: vi.fn(),
  removeSetPicture: vi.fn(),
  unlinkGame: vi.fn(),
  uploadScreenshot: vi.fn(),
  voteOutfit: vi.fn(),
  votedLooks: vi.fn(),
}));

// The signed-in page cannot be reached with a test session while email login is off,
// so it is rendered here with the data layer stubbed and everything else real.
const data = vi.hoisted(() => ({
  account: null as Account | null,
  links: [] as GameLink[],
  sets: [] as GameSet[],
  set: null as GameSet | null,
  published: { posts: [] as OutfitPost[], total: 0 },
  live: true,
  clear: vi.fn(async () => {}),
  listOutfits: vi.fn(),
}));

vi.mock("@/lib/data", () => ({
  repository: {
    get live() {
      return data.live;
    },
    getAccount: async () => data.account,
    listGameLinks: async () => data.links,
    listGameSets: async () => data.sets,
    getGameSet: async () => data.set,
    listOutfits: async (filters: unknown) => {
      data.listOutfits(filters);
      return data.published;
    },
    clearOrphanPictures: data.clear,
  },
}));

// Clearing old pictures runs after the response, which only a real request has.
const later = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: later }));

const { default: SetsPage } = await import("./page");
const { default: SetPage } = await import("../sets/[id]/page");

const ME: Account = { id: "me", name: "seolyam", avatar: null, provider: "discord", moderator: false };
const CODE = `ECA1:${Buffer.from("slot 0 259306\nslot 4 1001735\n").toString("base64")}`;
const SET: GameSet = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Raid night",
  code: CODE,
  updatedAt: new Date().toISOString(),
  gallery: [],
  className: null,
  race: null,
};
const PICTURE = "00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000aa.avif";
const LOOK: OutfitPost = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Frost knight",
  author: "seolyam",
  authorId: "me",
  authorVerified: false,
  code: CODE,
  className: null,
  armor: null,
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 3,
  createdAt: "2026-11-10T00:00:00.000Z",
  gallery: [],
};

const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);

beforeEach(() => {
  Object.assign(data, { account: ME, links: [], sets: [], set: null, live: true, published: { posts: [], total: 0 } });
  later.mockReset();
  data.clear.mockClear();
  data.listOutfits.mockClear();
});

describe("Loadouts", () => {
  it("offers a visitor sign-in, and no sets", async () => {
    data.account = null;
    const page = await html(SetsPage({}));
    expect(page).toContain("Continue with Discord");
    expect(page).not.toContain("Link a game");
  });

  it("lets anyone import a code, signed in or not", async () => {
    data.account = null;
    expect(await html(SetsPage({}))).toContain('id="import-heading"');
    data.account = ME;
    expect(await html(SetsPage({}))).toContain('id="import-heading"');
  });

  it("puts Import first and the loadouts below it", async () => {
    data.sets = [SET];
    const page = await html(SetsPage({}));
    expect(page.indexOf("import-heading")).toBeGreaterThan(-1);
    expect(page.indexOf("import-heading")).toBeLessThan(page.indexOf("Raid night"));
  });

  it("leaves the Dressing room's pills to the Dressing room, its own section now", async () => {
    const page = await html(SetsPage({}));
    expect(page).not.toContain('aria-label="Dressing room views"');
    expect(page).not.toContain('href="/dressing-room"');
  });

  it("opens Import on a linked code", async () => {
    const page = await html(SetsPage({ searchParams: Promise.resolve({ code: CODE }) }));
    expect(page).toContain(CODE);
  });

  it("says so when there is no database to sign in to", async () => {
    Object.assign(data, { account: null, live: false });
    const page = await html(SetsPage({}));
    expect(page).toContain("not connected");
    expect(page).not.toContain("Continue with Discord");
  });

  it("explains itself to an account with nothing linked", async () => {
    const page = await html(SetsPage({}));
    expect(page).toContain("Link a game");
    expect(page).toContain("Nothing here yet");
    expect(page).toMatch(/Your loadouts <span[^>]*>0<\/span>/);
  });

  it("lists a set with its pieces, a way in and a menu to publish or remove it", async () => {
    data.sets = [SET];
    const page = await html(SetsPage({}));
    expect(page).toContain("Raid night");
    expect(page).toContain(`href="/sets/${SET.id}"`);
    expect(page).toMatch(/Your loadouts <span[^>]*>1<\/span>/);
    // Publish and Remove sit in the card's ⋯ menu, drawn when it opens.
    expect(page).toContain("More options for Raid night");
    expect(page).toContain("<img");
  });

  it("says how many pictures the game sent with a set", async () => {
    data.sets = [{ ...SET, gallery: [PICTURE, PICTURE.replace("aa.avif", "bb.avif")] }];
    expect(await html(SetsPage({}))).toContain("2 pictures from your game");
    data.sets = [SET];
    expect(await html(SetsPage({}))).not.toContain("from your game");
  });

  it("puts what the game sent up top, with the picture and a way to publish it", async () => {
    const SENT = { ...SET, id: "22222222-2222-4222-8222-222222222222", name: "Nightmare", gallery: [PICTURE] };
    data.sets = [SET, SENT];
    const page = await html(SetsPage({}));
    const ready = page.slice(page.indexOf("Ready to publish"), page.indexOf("<h1"));
    expect(ready).toContain("Nightmare");
    expect(ready).not.toContain("Raid night");
    expect(ready).toContain(PICTURE.replace(".avif", "-thumb.avif"));
    expect(ready).toMatch(new RegExp(`href="/sets/${SENT.id}"[^>]*>Publish<`));
  });

  it("leads with what the game sent, above the page's title", async () => {
    data.sets = [{ ...SET, gallery: [PICTURE] }];
    const page = await html(SetsPage({}));
    expect(page.indexOf("Ready to publish")).toBeGreaterThan(-1);
    expect(page.indexOf("Ready to publish")).toBeLessThan(page.indexOf("<h1"));
  });

  it("shows your published looks between your linked games and your loadouts", async () => {
    data.sets = [SET];
    data.published = { posts: [LOOK], total: 1 };
    const page = await html(SetsPage({}));
    const games = page.indexOf('id="games-heading"');
    const published = page.indexOf('id="published-heading"');
    expect(games).toBeGreaterThan(-1);
    expect(published).toBeGreaterThan(games);
    expect(page.indexOf('id="sets-heading"')).toBeGreaterThan(published);
    expect(page.slice(published, page.indexOf('id="sets-heading"'))).toContain("Frost knight");
    expect(data.listOutfits).toHaveBeenCalledWith(expect.objectContaining({ authorId: ME.id, sort: "newest", pageSize: 3 }));
  });

  it("links to all your looks once there are more than fit in a row", async () => {
    data.published = { posts: [LOOK], total: 1 };
    expect(await html(SetsPage({}))).not.toContain("See all");
    data.published = { posts: [LOOK, { ...LOOK, id: "a" }, { ...LOOK, id: "b" }], total: 7 };
    expect(await html(SetsPage({}))).toMatch(new RegExp(`href="/creators/${ME.id}"[^>]*>See all 7<`));
  });

  it("says how to publish when you have published nothing", async () => {
    expect(await html(SetsPage({}))).toContain("You haven&#x27;t published a look yet.");
  });

  it("shows the game's picture on its set's card", async () => {
    data.sets = [{ ...SET, gallery: [PICTURE] }];
    const page = await html(SetsPage({}));
    const card = page.slice(page.indexOf('id="sets-heading"'));
    expect(card).toContain(PICTURE.replace(".avif", "-thumb.avif"));
  });

  it("has no call to publish when the game sent nothing", async () => {
    data.sets = [SET];
    expect(await html(SetsPage({}))).not.toContain("Ready to publish");
  });

  it("clears old set pictures past the response, and only for a signed-in owner", async () => {
    await html(SetsPage({}));
    // after() gets the running cleanup, not a callback: a callback could not read cookies.
    expect(later).toHaveBeenCalledTimes(1);
    expect(later.mock.calls[0][0]).toBeInstanceOf(Promise);
    expect(data.clear).toHaveBeenCalledTimes(1);
    later.mockReset();
    data.account = null;
    await html(SetsPage({}));
    expect(later).not.toHaveBeenCalled();
  });

  it("does not fall over on a code this site cannot read", async () => {
    data.sets = [{ ...SET, code: "ECA1:!!!" }];
    expect(await html(SetsPage({}))).toContain("Raid night");
  });

  it("names a linked game by the character that last synced", async () => {
    data.links = [{ id: "l", label: "Lee - Icecrown", linkedAt: SET.updatedAt, lastSyncAt: SET.updatedAt }];
    const page = await html(SetsPage({}));
    expect(page).toContain("Lee - Icecrown");
    expect(page).toContain("Synced just now");
    expect(page).toContain("Unlink");
  });

  it("does not invent a name for a game that has never synced", async () => {
    data.links = [{ id: "l", label: "", linkedAt: SET.updatedAt, lastSyncAt: null }];
    expect(await html(SetsPage({}))).toContain("Waiting for its first sync");
  });
});

describe("one set", () => {
  const open = (id: string) => SetPage({ params: Promise.resolve({ id }) });

  it("opens in the inspector, with the way to publish it", async () => {
    data.set = SET;
    const page = await html(open(SET.id));
    expect(page).toContain("Raid night");
    expect(page).toContain("Only you can see this set");
    expect(page).toContain("Remove Raid night");
  });

  it("shows what the game sent first, and points to the form that publishes it", async () => {
    data.set = { ...SET, gallery: [PICTURE] };
    const page = await html(open(SET.id));
    expect(page).toContain("Your game sent 1 picture of this look");
    expect(page).toContain(PICTURE.replace(".avif", "-thumb.avif"));
    expect(page).toContain('href="#publish"');
    data.set = SET;
    expect(await html(open(SET.id))).not.toContain("Your game sent");
  });

  it("asks a signed-out visitor to sign in instead of reading the set", async () => {
    data.account = null;
    data.set = SET;
    const page = await html(open(SET.id));
    expect(page).toContain("Continue with Discord");
    expect(page).not.toContain("Raid night");
  });

  it("does not exist for anyone it does not belong to", async () => {
    await expect(html(open(SET.id))).rejects.toThrow("NOT_FOUND");
  });
});
