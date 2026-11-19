import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Creator, OutfitFilters, OutfitPost } from "@/lib/data/types";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/creators",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions", () => ({ upvoteOutfit: vi.fn() }));

// A visitor's view and the owner's differ only by who is signed in, which no test
// session can be while email login is off: the data layer is stubbed instead.
const data = vi.hoisted(() => ({
  creator: null as Creator | null,
  account: null as Account | null,
  looks: [] as OutfitPost[],
  week: null as { post: OutfitPost; votes: number } | null,
  calls: [] as OutfitFilters[],
}));

vi.mock("@/lib/data", () => ({
  repository: {
    live: true,
    getCreator: async () => data.creator,
    getAccount: async () => data.account,
    lookOfTheWeek: async () => data.week,
    listOutfits: async (filters: OutfitFilters) => {
      data.calls.push(filters);
      const posts = data.looks.filter((p) => !filters.className || p.className === filters.className);
      return { posts: filters.pageSize === 1 ? posts.slice(0, 1) : posts, total: posts.length };
    },
  },
}));

const { default: CreatorPage } = await import("./page");

const ID = "44444444-4444-4444-8444-444444444444";
const EDVIN: Creator = {
  id: ID,
  name: "Edvin",
  verified: true,
  joinedAt: "2026-05-02T00:00:00.000Z",
  avatar: "https://cdn.discordapp.com/avatars/1/abc.png",
  looks: 3,
  upvotes: 12,
  classes: [{ className: "Paladin", looks: 2 }, { className: "Mage", looks: 1 }],
};
const look = (n: number, className: OutfitPost["className"], extra: Partial<OutfitPost> = {}): OutfitPost => ({
  id: `55555555-5555-4555-8555-55555555555${n}`,
  title: `Look ${n}`,
  author: "Edvin",
  authorId: ID,
  authorVerified: true,
  code: "ECA1:",
  className,
  armor: null,
  race: null,
  categories: [],
  tags: [],
  upvotes: 10 - n,
  createdAt: "2026-11-10T00:00:00.000Z",
  gallery: [],
  ...extra,
});

const render = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(
    (await CreatorPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(query) })) as ReactElement,
  );

beforeEach(() => {
  data.creator = EDVIN;
  data.account = null;
  data.week = null;
  data.calls = [];
  data.looks = [look(1, "Paladin"), look(2, "Paladin"), look(3, "Mage")];
});

describe("a creator's profile", () => {
  it("shows who they are and what they have made", async () => {
    const page = await render();
    expect(page).toContain("Edvin");
    expect(page).toContain("abc.png?size=256");
    expect(page).toContain("Joined May 2026");
    expect(page).toMatch(/>3<\/b> looks/);
    expect(page).toMatch(/>12<\/b> upvotes/);
    expect(page).toMatch(/>2<\/b> classes/);
  });

  it("pins their most upvoted look once they have a few", async () => {
    expect(await render()).toContain("Top look");
    data.creator = { ...EDVIN, looks: 2 };
    expect(await render()).not.toContain("Top look");
  });

  it("filters by a class from its chip, and the chip clears it again", async () => {
    expect(await render()).toContain(`href="/creators/${ID}?class=Paladin&amp;sort=newest"`);
    data.calls = [];
    const page = await render({ class: "Mage" });
    expect(data.calls[0]).toMatchObject({ authorId: ID, className: "Mage" });
    expect(page).toContain(`aria-current="page" href="/creators/${ID}?sort=newest"`);
    expect(page).toContain("Mage looks");
    // The pinned look is of every class, so a filtered list leaves it out.
    expect(page).not.toContain("Top look");
  });

  it("lists newest first unless asked for the most upvoted", async () => {
    await render();
    expect(data.calls[0].sort).toBe("newest");
    data.calls = [];
    await render({ sort: "top" });
    expect(data.calls[0].sort).toBe("top");
  });

  it("offers a visitor its link, and the owner a way to publish", async () => {
    const visitor = await render();
    expect(visitor).toContain("Copy profile link");
    expect(visitor).not.toContain("Publish a look");
    data.account = { id: ID, name: "Edvin", avatar: null, provider: "discord", moderator: false };
    const owner = await render();
    expect(owner).toContain("Publish a look");
    expect(owner).not.toContain("Copy profile link");
  });

  it("tells the owner that their private looks are theirs alone", async () => {
    data.looks = [look(1, "Paladin", { isPrivate: true })];
    data.account = { id: ID, name: "Edvin", avatar: null, provider: "discord", moderator: false };
    expect(await render()).toContain("Only you see your private looks here.");
  });

  it("celebrates the Look of the Week only while it is theirs", async () => {
    data.week = { post: look(1, "Paladin"), votes: 6 };
    expect(await render()).toContain("is this week&#x27;s Look of the Week.");
    data.week = { post: look(1, "Paladin", { authorId: "someone-else" }), votes: 6 };
    expect(await render()).not.toContain("Look of the Week");
  });

  it("is a 404 for someone with no public name", async () => {
    data.creator = null;
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });
});
