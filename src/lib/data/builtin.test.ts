import { describe, expect, it, vi } from "vitest";
import setsJson from "@/data/catalog/sets.json";
import { decodeOutfit } from "@/lib/codec/outfit";
import { submitOutfitSchema } from "@/lib/codec/schema";
import { LOOKS_PER_PAGE } from "@/lib/domain";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));

const { builtinRepository: repo } = await import("./builtin");
const { resolveOutfit } = await import("@/lib/catalog");

type SetRow = { id: number; name: string; pieces: Record<string, number> };
const everything = async () => (await repo.listOutfits({ sort: "top", pageSize: 10_000 })).posts;

describe("the built-in looks", () => {
  it("says it is not a live community", () => {
    expect(repo.live).toBe(false);
  });

  it("lists only codes the game can read, dressing real items", async () => {
    const posts = await everything();
    expect(posts.length).toBeGreaterThan(600);
    for (const post of posts) {
      const r = decodeOutfit(post.code);
      expect(r.ok, post.title).toBe(true);
      if (!r.ok) continue;
      const resolved = resolveOutfit(r.outfit);
      expect(resolved.slots.length, post.title).toBeGreaterThanOrEqual(5);
      for (const slot of resolved.slots) expect(slot.name, `${post.title} ${slot.label}`).not.toBeNull();
    }
  });

  it("holds exactly a set's own pieces, with nothing added to dress it up", async () => {
    const posts = await everything();
    const sets = posts.filter((p) => p.id.startsWith("set-"));
    expect(sets.length).toBeGreaterThan(600);
    for (const post of sets) {
      const source = (setsJson as unknown as SetRow[]).find((s) => `set-${s.id}` === post.id);
      expect(source?.name, post.id).toBe(post.title);
      const r = decodeOutfit(post.code);
      if (!r.ok) throw new Error(post.id);
      expect(r.outfit.slots, post.title).toEqual(Object.fromEntries(Object.entries(source!.pieces).map(([k, v]) => [Number(k), v])));
      expect(r.outfit.mount, post.title).toBeFalsy();
      expect(r.outfit.look, post.title).toBeFalsy();
      expect(r.outfit.glow.some(Boolean), post.title).toBe(false);
    }
  });

  it("spells every name properly, with no mis-encoded text from the source", async () => {
    const posts = await everything();
    expect(posts.filter((p) => /[-]|â/.test(p.title)).map((p) => p.title)).toEqual([]);
    const { posts: found } = await repo.listOutfits({ q: "Junkwalker's", sort: "top" });
    expect(found.length).toBeGreaterThan(0);
  });

  it("has no looks by any account", async () => {
    const { posts: found } = await repo.listOutfits({ sort: "top", authorId: "00000000-0000-4000-8000-000000000000" });
    expect(found).toEqual([]);
  });

  it("keeps every look when leaving out one account's, since none has an author", async () => {
    const all = (await everything()).length;
    const { total } = await repo.listOutfits({ sort: "top", excludeAuthorId: "00000000-0000-4000-8000-000000000000" });
    expect(total).toBe(all);
  });

  it("carries no invented person, vote or date", async () => {
    for (const post of await everything()) {
      expect(post.upvotes, post.title).toBeNull();
      expect(post.createdAt, post.title).toBeNull();
      expect(post.authorVerified, post.title).toBe(false);
      expect(post.race, post.title).toBeNull();
      expect(post.className, post.title).toBeNull();
      expect(post.gallery, post.title).toEqual([]);
      if (post.id !== "crystal-scholar") expect(post.author, post.title).toBeNull();
    }
  });

  it("keeps the one real saved look, from Eclipse/profiles/morph.cfg", async () => {
    const saved = await repo.getOutfit("crystal-scholar");
    expect(saved?.author).toBe("Eclipse");
    const r = decodeOutfit(saved!.code);
    expect(r.ok && r.outfit.mount).toBe(134653);
  });

  it("finds every look wearing an item, and only those", async () => {
    const all = await everything();
    const wears = (code: string, item: number) => {
      const r = decodeOutfit(code);
      return r.ok && Object.values(r.outfit.slots).includes(item);
    };
    const item = 259306; // The Crystal Scholar's head.
    const hits = (await repo.listOutfits({ sort: "top", item, pageSize: 10_000 })).posts;
    expect(hits.map((p) => p.id)).toContain("crystal-scholar");
    expect(hits.map((p) => p.id)).toEqual(all.filter((p) => wears(p.code, item)).map((p) => p.id));
    expect((await repo.listOutfits({ sort: "top", item: 999_999_999 })).total).toBe(0);
  });

  it("filters by armor, and by class through the armor it wears", async () => {
    const { posts: plate } = await repo.listOutfits({ armor: "plate", sort: "top" });
    expect(plate.length).toBeGreaterThan(0);
    expect(plate.every((o) => o.armor === "plate")).toBe(true);
    const { posts: mage } = await repo.listOutfits({ className: "Mage", sort: "top" });
    expect(mage.length).toBeGreaterThan(0);
    expect(mage.every((o) => o.armor === "cloth")).toBe(true);
    const { posts: none } = await repo.listOutfits({ q: "no such outfit at all", sort: "newest" });
    expect(none).toEqual([]);
  });

  it("derives its tags from the set and never makes one up", async () => {
    const { posts: pvp } = await repo.listOutfits({ tag: "pvp", sort: "top" });
    expect(pvp.length).toBeGreaterThan(0);
    expect(pvp.every((o) => /gladiator/i.test(o.title))).toBe(true);
    const { total: enchanted } = await repo.listOutfits({ tag: "enchant", sort: "top" });
    expect(enchanted).toBe(0);
  });

  it("pages through the whole list and reports its size", async () => {
    const first = await repo.listOutfits({ sort: "top" });
    const second = await repo.listOutfits({ sort: "top", page: 2 });
    expect(first.posts).toHaveLength(LOOKS_PER_PAGE);
    expect(first.total).toBeGreaterThan(600);
    expect(second.total).toBe(first.total);
    expect(second.posts[0].id).not.toBe(first.posts[0].id);
    expect((await repo.listOutfits({ sort: "top", page: 9999 })).posts).toEqual([]);
  });

  it("has no capture to show, because none exists yet", async () => {
    expect(await repo.listOutfits({ sort: "top", captured: true })).toEqual({ posts: [], total: 0 });
  });

  it("indexes every look for search, without names it does not have", async () => {
    const index = await repo.searchIndex();
    expect(index).toHaveLength((await everything()).length);
    // The game's own sets have no creator pages.
    expect(await repo.sitemapEntries()).toEqual({ looks: index.map((e) => e.id), creators: [] });
    expect(index.filter((e) => e.author).map((e) => e.id)).toEqual(["crystal-scholar"]);
  });

  it("refuses every write instead of pretending to keep it", async () => {
    const before = (await repo.listOutfits({ sort: "top" })).total;
    const created = await repo.createOutfit({ title: "A look", code: "ECA1:c2xvdCAwIDEK", tags: [], gallery: [] });
    expect(created.ok).toBe(false);
    expect((await repo.vote("crystal-scholar", true)).ok).toBe(false);
    expect(await repo.votedOn(["crystal-scholar"])).toEqual([]);
    expect((await repo.uploadScreenshot(new File([], "a.png"))).ok).toBe(false);
    expect((await repo.report("crystal-scholar", "spam")).ok).toBe(false);
    expect((await repo.setBookmark("crystal-scholar", true)).ok).toBe(false);
    expect((await repo.dismissReports("crystal-scholar")).ok).toBe(false);
    expect(await repo.isBookmarked("crystal-scholar")).toBe(false);
    expect(await repo.listReports()).toEqual([]);
    expect(await repo.getCreator("33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(await repo.lookOfTheWeek()).toBeNull();
    expect((await repo.listOutfits({ sort: "top" })).total).toBe(before);
  });
});

describe("submissions", () => {
  it("refuses one the game could not wear", () => {
    const upload = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.avif";
    const base = { title: "A look", tags: [], gallery: [upload] };
    expect(submitOutfitSchema.safeParse({ ...base, code: "hello" }).success).toBe(false);
    expect(submitOutfitSchema.safeParse({ ...base, code: "ECA1:c2xvdCAwIDEK" }).success).toBe(true);
    expect(submitOutfitSchema.safeParse({ ...base, title: "a", code: "ECA1:c2xvdCAwIDEK" }).success).toBe(false);
    expect(
      submitOutfitSchema.safeParse({ ...base, code: "ECA1:c2xvdCAwIDEK", gallery: ["https://x.test/a.png"] }).success,
    ).toBe(false);
    expect(
      submitOutfitSchema.safeParse({ ...base, code: "ECA1:c2xvdCAwIDEK", gallery: Array(7).fill(upload) }).success,
    ).toBe(false);
    expect(
      submitOutfitSchema.safeParse({ ...base, code: "ECA1:c2xvdCAwIDEK", gallery: [upload] }).success,
    ).toBe(true);
  });

  it("needs at least one screenshot", () => {
    const look = { title: "A look", code: "ECA1:c2xvdCAwIDEK" };
    const missing = submitOutfitSchema.safeParse(look);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].message).toMatch(/screenshot/i);
    expect(submitOutfitSchema.safeParse({ ...look, gallery: [] }).success).toBe(false);
  });
});
