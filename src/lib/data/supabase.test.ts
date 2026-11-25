import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOOKS_PER_PAGE } from "@/lib/domain";
import { COMMENTS_PER_PAGE } from "@/lib/limits";

vi.mock("server-only", () => ({}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");

// The real client over a stubbed network, so these read what really goes to
// PostgREST, without needing a live project.
const requests: URL[] = [];
const removed: string[] = [];
let reply: (url: URL, init?: RequestInit) => Response = () => Response.json([]);

const stubFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(url);
  if (init?.method === "DELETE" && url.pathname.startsWith("/storage/")) {
    removed.push(...(JSON.parse(String(init.body)) as { prefixes: string[] }).prefixes);
  }
  return reply(url, init);
};

let user: {
  id: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
} | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => {
    const client = createClient("https://stub.supabase.co", "stub-key", { global: { fetch: stubFetch } });
    client.auth.getUser = (async () => ({ data: { user }, error: null })) as never;
    return client;
  },
}));

const { supabaseRepository: repo } = await import("./supabase");
const { builtinRepository } = await import("./builtin");

const SHOT = "33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.avif";
const THUMB = SHOT.replace(".avif", "-thumb.avif");
const SMALL = SHOT.replace(".avif", "-small.avif");

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "A real post",
  code: "ECA1:c2xvdCAwIDEK",
  class_name: "Mage",
  armor: "cloth",
  race: null,
  categories: ["Armor"],
  tags: [],
  upvotes: 3,
  created_at: "2026-11-01T00:00:00.000Z",
  author_id: "33333333-3333-4333-8333-333333333333",
  gallery: [SHOT],
  profiles: { display_name: "Kira", verified: true },
};

beforeEach(() => {
  requests.length = 0;
  removed.length = 0;
  reply = () => Response.json([]);
  user = null;
});

const failWith = (code: string, status: number) => () => Response.json({ code, message: "refused" }, { status });
const input = { title: "A look", code: "ECA1:c2xvdCAwIDEK", tags: [], gallery: [] };

describe("the signed-in account", () => {
  it("is nobody without a session, and asks the database nothing", async () => {
    expect(await repo.getAccount()).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("reads the public name", async () => {
    user = { id: row.id };
    reply = () => Response.json([{ display_name: "Kira", moderators: null }]);
    expect(await repo.getAccount()).toEqual({ id: row.id, name: "Kira", avatar: null, provider: null, moderator: false });
    expect(requests[0].searchParams.get("id")).toBe(`eq.${row.id}`);
  });

  it("has no name until one is chosen", async () => {
    user = { id: row.id };
    reply = () => Response.json([{ display_name: null, moderators: null }]);
    expect(await repo.getAccount()).toEqual({ id: row.id, name: null, avatar: null, provider: null, moderator: false });
  });

  it("carries the picture and provider from the sign-in", async () => {
    user = {
      id: row.id,
      user_metadata: { avatar_url: "https://cdn.discordapp.com/avatars/1/a.png" },
      app_metadata: { provider: "discord" },
    };
    reply = () => Response.json([{ display_name: "Kira", moderators: null }]);
    expect(await repo.getAccount()).toMatchObject({
      avatar: "https://cdn.discordapp.com/avatars/1/a.png",
      provider: "discord",
    });
  });

  it("ignores a picture that is not an https address", async () => {
    // Anyone can write their own user metadata, so this value is not the provider's word.
    user = { id: row.id, user_metadata: { avatar_url: "http://example.test/a.png" } };
    reply = () => Response.json([{ display_name: "Kira", moderators: null }]);
    expect(await repo.getAccount()).toMatchObject({ avatar: null });
  });

  it("knows a moderator", async () => {
    user = { id: row.id };
    reply = () => Response.json([{ display_name: "Kira", moderators: { user_id: row.id } }]);
    expect(await repo.getAccount()).toMatchObject({ id: row.id, name: "Kira", moderator: true });
  });

  it("saves a name to the signed-in profile only", async () => {
    user = { id: row.id };
    reply = () => Response.json({ display_name: "Kira" });
    expect(await repo.setDisplayName("Kira")).toEqual({ ok: true, value: "Kira" });
    expect(requests[0].searchParams.get("id")).toBe(`eq.${row.id}`);
  });

  it("needs a session to save a name", async () => {
    expect((await repo.setDisplayName("Kira")).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("says when a name is taken", async () => {
    user = { id: row.id };
    reply = failWith("23505", 409);
    expect(await repo.setDisplayName("Kira")).toEqual({ ok: false, error: "That name is taken. Try another." });
  });
});

describe("a post from the database", () => {
  it("links its screenshots and names its author", async () => {
    reply = () => Response.json(row);
    const post = await repo.getOutfit(row.id);
    expect(post?.gallery).toEqual([`https://stub.supabase.co/storage/v1/object/public/showcase/${SHOT}`]);
    expect(post?.authorId).toBe(row.author_id);
    expect(post?.sharedOnDiscord).toBe(false);
  });

  it("credits a look from the Discord showcase to its player until they claim it", async () => {
    reply = () => Response.json({ ...row, author_id: null, profiles: null, discord_name: "Shadow" });
    const post = await repo.getOutfit(row.id);
    expect(post).toMatchObject({ author: "Shadow", authorId: null, authorVerified: false, sharedOnDiscord: true });
  });

  it("names a claimed look by its author's profile, not their old Discord name", async () => {
    reply = () => Response.json({ ...row, discord_name: "Shadow" });
    const post = await repo.getOutfit(row.id);
    expect(post).toMatchObject({ author: "Kira", authorId: row.author_id, sharedOnDiscord: false });
  });
});

describe("screenshots", () => {
  const stored = () => Response.json({ Key: "showcase/x", Id: "x" });
  const refused = (message: string) => Response.json({ statusCode: "403", error: "Unauthorized", message }, { status: 400 });
  const screenshot = async () => {
    const png = await sharp({ create: { width: 64, height: 36, channels: 3, background: "#403020" } }).png().toBuffer();
    return new File([new Uint8Array(png)], "capture.png", { type: "image/png" });
  };

  it("stores a full file, its thumbnail and its small copy in the person's folder", async () => {
    user = { id: row.author_id };
    reply = stored;
    const result = await repo.uploadScreenshot(await screenshot());
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toMatch(new RegExp(`^${row.author_id}/[0-9a-f-]{36}\\.avif$`));
    expect(requests.map((r) => r.pathname)).toEqual([
      `/storage/v1/object/showcase/${result.value.replace(".avif", "-thumb.avif")}`,
      `/storage/v1/object/showcase/${result.value.replace(".avif", "-small.avif")}`,
      `/storage/v1/object/showcase/${result.value}`,
    ]);
  });

  it("needs a session, and does no work without one", async () => {
    expect(await repo.uploadScreenshot(await screenshot())).toEqual({ ok: false, error: "Sign in to upload." });
    expect(requests).toHaveLength(0);
  });

  it("says so when the file is not an image", async () => {
    user = { id: row.author_id };
    const result = await repo.uploadScreenshot(new File(["not an image"], "a.png", { type: "image/png" }));
    expect(result).toEqual({ ok: false, error: "That file could not be read as an image." });
    expect(requests).toHaveLength(0);
  });

  it("explains the limit when the database refuses another", async () => {
    user = { id: row.author_id };
    reply = () => refused("new row violates row-level security policy");
    expect(await repo.uploadScreenshot(await screenshot())).toEqual({
      ok: false,
      error: "You have 60 screenshots stored. Delete a look to free some up.",
    });
  });

  it("leaves no smaller copy behind when the full file is refused", async () => {
    user = { id: row.author_id };
    let uploads = 0;
    reply = (url) => {
      if (!url.pathname.includes(row.author_id)) return Response.json([]);
      return ++uploads <= 2 ? stored() : refused("new row violates row-level security policy");
    };
    const result = await repo.uploadScreenshot(await screenshot());
    expect(result.ok).toBe(false);
    expect(removed).toHaveLength(2);
    expect(removed[0]).toMatch(/-thumb\.avif$/);
    expect(removed[1]).toMatch(/-small\.avif$/);
  });

  it("leaves no thumbnail behind when the small copy is refused", async () => {
    user = { id: row.author_id };
    let uploads = 0;
    reply = (url) => {
      if (!url.pathname.includes(row.author_id)) return Response.json([]);
      return ++uploads === 1 ? stored() : refused("new row violates row-level security policy");
    };
    const result = await repo.uploadScreenshot(await screenshot());
    expect(result).toEqual({ ok: false, error: "You have 60 screenshots stored. Delete a look to free some up." });
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/-thumb\.avif$/);
  });

  it("removes a file and its smaller copies together", async () => {
    user = { id: row.author_id };
    expect(await repo.removeScreenshot(SHOT)).toEqual({ ok: true, value: SHOT });
    expect(removed).toEqual([SHOT, THUMB, SMALL]);
  });
});

describe("deleting a look", () => {
  it("removes the look and every file it held", async () => {
    user = { id: row.author_id };
    reply = (url) => Response.json(url.pathname.startsWith("/rest/") ? [{ gallery: [SHOT] }] : []);
    expect(await repo.deleteOutfit(row.id)).toEqual({ ok: true, value: row.id });
    expect(requests[0].searchParams.get("id")).toBe(`eq.${row.id}`);
    expect(removed).toEqual([SHOT, THUMB, SMALL]);
  });

  // RLS answers a refused delete with no rows, not an error.
  it("says so when the database deleted nothing, and keeps the files", async () => {
    user = { id: "55555555-5555-4555-8555-555555555555" };
    expect(await repo.deleteOutfit(row.id)).toEqual({ ok: false, error: "You can only delete your own looks." });
    expect(removed).toEqual([]);
  });

  it("needs a session", async () => {
    expect((await repo.deleteOutfit(row.id)).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("cannot delete a built-in set", async () => {
    user = { id: row.author_id };
    expect((await repo.deleteOutfit("set-1074")).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("setting a look private", () => {
  it("asks for the author's own look, and says what it became", async () => {
    user = { id: row.author_id };
    let sent: unknown = null;
    reply = (_, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json([{ id: row.id }]);
    };
    expect(await repo.setOutfitPrivate(row.id, true)).toEqual({ ok: true, value: true });
    expect(requests[0].pathname).toBe("/rest/v1/outfits");
    expect(requests[0].searchParams.get("id")).toBe(`eq.${row.id}`);
    expect(sent).toEqual({ is_private: true });
    expect(await repo.setOutfitPrivate(row.id, false)).toEqual({ ok: true, value: false });
    expect(sent).toEqual({ is_private: false });
  });

  // RLS answers a refused update with no rows, not an error.
  it("says so when the look is someone else's", async () => {
    user = { id: "55555555-5555-4555-8555-555555555555" };
    expect(await repo.setOutfitPrivate(row.id, true)).toEqual({ ok: false, error: "You can only change your own looks." });
  });

  it("needs a session and a real look", async () => {
    expect((await repo.setOutfitPrivate(row.id, true)).ok).toBe(false);
    user = { id: row.author_id };
    expect((await repo.setOutfitPrivate("set-1074", true)).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("is refused by the built-in data, which has no authors", async () => {
    expect((await builtinRepository.setOutfitPrivate(row.id, true)).ok).toBe(false);
  });

  it("is read back on the look", async () => {
    reply = () => Response.json({ ...row, is_private: true });
    expect((await repo.getOutfit(row.id))?.isPrivate).toBe(true);
    expect(requests[0].searchParams.get("select")).toMatch(/(^|,)is_private(,|$)/);
  });

  it("stays out of every list unless the list asks for its account's own", async () => {
    await repo.listOutfits({ sort: "top" });
    expect(requests[0].searchParams.get("is_private")).toBe("eq.false");
    requests.length = 0;
    await repo.listOutfits({ sort: "newest", authorId: row.author_id, includePrivate: true });
    expect(requests[0].searchParams.has("is_private")).toBe(false);
  });
});

describe("publishing", () => {
  it("asks for a name when the database refuses a nameless author", async () => {
    user = { id: row.id };
    reply = failWith("42501", 403);
    expect(await repo.createOutfit(input)).toEqual({ ok: false, error: "Choose a public name first, from the account button." });
  });

  it("stores the description, or none, and reads it back", async () => {
    user = { id: row.author_id };
    const sent: Record<string, unknown>[] = [];
    reply = (_, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ...row, description: "A caption" }, { status: 201 });
    };
    const r = await repo.createOutfit({ ...input, description: "A caption" });
    await repo.createOutfit(input);
    expect(sent.map((b) => b.description)).toEqual(["A caption", null]);
    expect(r.ok && r.value.description).toBe("A caption");
    expect(requests[0].searchParams.get("select")).toContain("description");
  });

  it("explains the hourly limit", async () => {
    user = { id: row.id };
    reply = failWith("EC001", 400);
    expect(await repo.createOutfit(input)).toEqual({ ok: false, error: "That is 20 looks this hour. Try again later." });
  });
});

describe("remix credit", () => {
  const original = "22222222-2222-4222-8222-222222222222";

  it("names the original when publishing a remix", async () => {
    user = { id: row.author_id };
    let sent: Record<string, unknown> = {};
    reply = (_, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(row);
    };
    await repo.createOutfit({ ...input, remixedFrom: original });
    expect(sent.remixed_from).toBe(original);
  });

  it("credits nothing on an ordinary look", async () => {
    user = { id: row.author_id };
    let sent: Record<string, unknown> = {};
    reply = (_, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(row);
    };
    await repo.createOutfit(input);
    expect(sent.remixed_from).toBeNull();
  });

  it("shows the original and its author", async () => {
    reply = () => Response.json({ ...row, remix: { id: original, title: "The original", profiles: { display_name: "Ana" } } });
    expect((await repo.getOutfit(row.id))?.remixedFrom).toEqual({ id: original, title: "The original", author: "Ana" });
    // Through the column itself: `outfits!remixed_from` reaches the remixes, as an array, not the original.
    expect(requests[0].searchParams.get("select")).toContain("remix:remixed_from(");
  });

  it("shows nothing once the original is gone or hidden", async () => {
    reply = () => Response.json({ ...row, remix: null });
    expect((await repo.getOutfit(row.id))?.remixedFrom).toBeNull();
  });
});

describe("the look of the week", () => {
  it("is the database's pick, with how many votes it got this week", async () => {
    reply = (url) => url.pathname.endsWith("/rpc/look_of_the_week")
      ? Response.json([{ outfit_id: row.id, votes: 5 }])
      : Response.json(row);
    expect(await repo.lookOfTheWeek()).toMatchObject({ votes: 5, post: { id: row.id, title: "A real post" } });
  });

  it("is nothing in a quiet week", async () => {
    reply = () => Response.json([]);
    expect(await repo.lookOfTheWeek()).toBeNull();
  });

  it("never takes the home page down with it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reply = failWith("XX000", 500);
    expect(await repo.lookOfTheWeek()).toBeNull();
  });
});

describe("a creator's page", () => {
  it("counts the looks and upvotes visitors can see", async () => {
    reply = (url) => url.pathname.endsWith("/profiles")
      ? Response.json({ display_name: "Kira", verified: true, created_at: row.created_at, avatar_url: null })
      : Response.json([{ upvotes: 3, class_name: null }, { upvotes: 4, class_name: null }]);
    expect(await repo.getCreator(row.author_id)).toEqual({
      id: row.author_id, name: "Kira", verified: true, joinedAt: row.created_at, avatar: null, looks: 2, upvotes: 7, classes: [],
    });
  });

  it("counts only public looks, so the owner sees the same numbers as everyone else", async () => {
    reply = (url) => url.pathname.endsWith("/profiles")
      ? Response.json({ display_name: "Kira", verified: false, created_at: row.created_at, avatar_url: null })
      : Response.json([]);
    await repo.getCreator(row.author_id);
    const looks = requests.find((r) => r.pathname.endsWith("/outfits"));
    expect(looks?.searchParams.get("is_private")).toBe("eq.false");
  });

  it("shows their Discord picture and the classes they dress, most dressed first", async () => {
    const avatar = "https://cdn.discordapp.com/avatars/1/abc.png";
    reply = (url) => url.pathname.endsWith("/profiles")
      ? Response.json({ display_name: "Kira", verified: false, created_at: row.created_at, avatar_url: avatar })
      : Response.json([
        { upvotes: 1, class_name: "Mage" },
        { upvotes: 1, class_name: "Paladin" },
        { upvotes: 1, class_name: "Paladin" },
        { upvotes: 1, class_name: null },
      ]);
    const creator = await repo.getCreator(row.author_id);
    expect(creator?.avatar).toBe(avatar);
    expect(creator?.classes).toEqual([{ className: "Paladin", looks: 2 }, { className: "Mage", looks: 1 }]);
  });

  it("has no page for someone with no public name", async () => {
    reply = (url) => url.pathname.endsWith("/profiles")
      ? Response.json({ display_name: null, verified: false, created_at: row.created_at })
      : Response.json([]);
    expect(await repo.getCreator(row.author_id)).toBeNull();
  });

  it("is a 404, not a crash, for a malformed id", async () => {
    expect(await repo.getCreator("not-a-uuid")).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("finding creators", () => {
  const kira = "11111111-1111-4111-8111-111111111111";
  const ana = "22222222-2222-4222-8222-222222222222";
  const look = (author: string, name: string | null) => ({
    author_id: author, profiles: { display_name: name, verified: author === kira, avatar_url: null },
  });

  it("lists people with public looks, the most prolific first", async () => {
    reply = () => Response.json([look(ana, "Ana"), look(kira, "Kira"), look(kira, "Kira")]);
    expect(await repo.listCreators({ limit: 10 })).toEqual([
      { id: kira, name: "Kira", verified: true, avatar: null, looks: 2 },
      { id: ana, name: "Ana", verified: false, avatar: null, looks: 1 },
    ]);
    // Public looks only: the list is cached for everyone, whoever asked first.
    expect(requests[0].searchParams.get("is_private")).toBe("eq.false");
  });

  it("matches a name, through the profile", async () => {
    reply = () => Response.json([]);
    await repo.listCreators({ q: "ki%", limit: 6 });
    expect(requests[0].searchParams.get("profiles.display_name")).toBe("ilike.%ki%");
    expect(requests[0].searchParams.get("select")).toContain("!inner(");
  });

  it("stops at the limit and leaves out anyone with no public name", async () => {
    reply = () => Response.json([look(kira, "Kira"), look(ana, null)]);
    expect((await repo.listCreators({ limit: 1 })).map((c) => c.name)).toEqual(["Kira"]);
  });
});

describe("votes", () => {
  it("sets the vote the visitor wants, on or off, and answers the new count", async () => {
    user = { id: row.author_id };
    let sent: unknown = null;
    reply = (_, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(0);
    };
    expect(await repo.vote(row.id, false)).toEqual({ ok: true, value: 0 });
    expect(requests[0].pathname).toBe("/rest/v1/rpc/set_outfit_vote");
    expect(sent).toEqual({ target: row.id, up: false });
  });

  it("asks a signed-out visitor to sign in", async () => {
    reply = failWith("28000", 401);
    expect(await repo.vote(row.id, true)).toEqual({ ok: false, error: "Sign in to vote." });
  });

  // The vote function is not granted to anon, so a signed-out vote never reaches its own check.
  it("asks a signed-out visitor to sign in when the database refuses them the vote", async () => {
    reply = failWith("42501", 401);
    expect(await repo.vote(row.id, true)).toEqual({ ok: false, error: "Sign in to vote." });
  });

  it("reads which of the given looks the account voted for", async () => {
    user = { id: row.author_id };
    reply = () => Response.json([{ outfit_id: row.id }]);
    expect(await repo.votedOn([row.id, "not-a-uuid"])).toEqual([row.id]);
    expect(requests[0].pathname).toBe("/rest/v1/outfit_votes");
    expect(requests[0].searchParams.get("user_id")).toBe(`eq.${row.author_id}`);
    expect(requests[0].searchParams.get("outfit_id")).toBe(`in.(${row.id})`);
  });

  it("has voted for nothing as a visitor, and asks the database nothing", async () => {
    expect(await repo.votedOn([row.id])).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe("reports", () => {
  it("files the reason through report_outfit, and says when the report is new", async () => {
    user = { id: row.author_id };
    reply = () => Response.json(true);
    expect(await repo.report(row.id, "spam")).toEqual({ ok: true, value: true });
    expect(requests[0].pathname).toBe("/rest/v1/rpc/report_outfit");
  });

  it("counts a repeat report as nothing new, so nobody is alerted twice", async () => {
    reply = () => Response.json(false);
    expect(await repo.report(row.id, "spam")).toEqual({ ok: true, value: false });
  });

  it("asks a visitor to sign in", async () => {
    reply = failWith("28000", 401);
    expect(await repo.report(row.id, "spam")).toEqual({ ok: false, error: "Sign in to report a look." });
  });

  it("cannot report a game set, which has no author to answer for it", async () => {
    expect((await repo.report("set-1", "spam")).ok).toBe(false);
    expect(requests).toEqual([]);
  });

  it("lists the moderation queue for a moderator", async () => {
    reply = () => Response.json([
      { outfit_id: row.id, title: "A real post", reports: 3, reasons: ["spam"], last_report: row.created_at },
    ]);
    expect(await repo.listReports()).toEqual([
      { id: row.id, title: "A real post", reports: 3, reasons: ["spam"], lastReport: row.created_at },
    ]);
  });

  it("gives anyone else an empty queue instead of an error page", async () => {
    reply = failWith("42501", 403);
    expect(await repo.listReports()).toEqual([]);
  });

  it("dismisses a look's reports through dismiss_reports", async () => {
    reply = () => new Response(null, { status: 204 });
    expect(await repo.dismissReports(row.id)).toEqual({ ok: true, value: row.id });
    expect(requests[0].pathname).toBe("/rest/v1/rpc/dismiss_reports");
  });

  it("refuses a dismissal from someone who is not a moderator", async () => {
    reply = failWith("42501", 403);
    expect(await repo.dismissReports(row.id)).toEqual({ ok: false, error: "Only moderators can dismiss reports." });
  });

  it("never asks for a hidden flag: reports do not hide looks", async () => {
    await repo.getOutfit(row.id);
    expect(requests[0].searchParams.get("select")).not.toMatch(/(^|,)hidden(,|$)/);
  });
});

describe("bookmarks", () => {
  it("is never bookmarked for a visitor, and asks the database nothing", async () => {
    expect(await repo.isBookmarked(row.id)).toBe(false);
    expect(requests).toEqual([]);
  });

  it("reads the signed-in account's own bookmark", async () => {
    user = { id: row.author_id };
    reply = () => Response.json([{ outfit_id: row.id }]);
    expect(await repo.isBookmarked(row.id)).toBe(true);
    expect(requests[0].searchParams.get("user_id")).toBe(`eq.${row.author_id}`);
  });

  it("adds a bookmark as the signed-in account", async () => {
    user = { id: row.author_id };
    reply = () => new Response(null, { status: 201 });
    expect(await repo.setBookmark(row.id, true)).toEqual({ ok: true, value: true });
    expect(requests[0].pathname).toBe("/rest/v1/outfit_bookmarks");
  });

  it("treats a second add as already saved", async () => {
    user = { id: row.author_id };
    reply = failWith("23505", 409);
    expect(await repo.setBookmark(row.id, true)).toEqual({ ok: true, value: true });
  });

  it("removes only the account's own bookmark", async () => {
    user = { id: row.author_id };
    reply = () => new Response(null, { status: 204 });
    expect(await repo.setBookmark(row.id, false)).toEqual({ ok: true, value: false });
    expect(requests[0].searchParams.get("user_id")).toBe(`eq.${row.author_id}`);
    expect(requests[0].searchParams.get("outfit_id")).toBe(`eq.${row.id}`);
  });

  it("asks a visitor to sign in", async () => {
    expect(await repo.setBookmark(row.id, true)).toEqual({ ok: false, error: "Sign in to bookmark a look." });
  });

  it("lists only bookmarked looks, without the game's sets", async () => {
    user = { id: row.author_id };
    reply = () => Response.json([row], { headers: { "Content-Range": `0-0/1` } });
    const r = await repo.listOutfits({ sort: "newest", saved: true });
    expect(r).toMatchObject({ total: 1, posts: [{ id: row.id }] });
    expect(requests[0].searchParams.get("select")).toContain("outfit_bookmarks!inner(");
    expect(requests[0].searchParams.get("outfit_bookmarks.user_id")).toBe(`eq.${row.author_id}`);
  });

  it("has no bookmarks to list for a visitor", async () => {
    expect(await repo.listOutfits({ sort: "newest", saved: true })).toEqual({ posts: [], total: 0 });
    expect(requests).toEqual([]);
  });
});

describe("the Supabase adapter", () => {
  // outfit_votes is a second path from outfits to profiles, and a bare
  // profiles(...) embed makes PostgREST refuse the query as ambiguous.
  it("names the author relationship when it embeds a profile", async () => {
    await repo.listOutfits({ sort: "top" });
    await repo.getOutfit(row.id);
    for (const request of requests) {
      expect(request.searchParams.get("select")).toContain("profiles!outfits_author_id_fkey(");
    }
    expect(requests).toHaveLength(2);
  });

  it("asks for one page and reports the whole count", async () => {
    reply = () => Response.json([row], { headers: { "Content-Range": `24-24/25` } });
    // Captured, so the count is the database's alone: a game set has no capture.
    const r = await repo.listOutfits({ sort: "top", page: 2, captured: true });
    expect(r.total).toBe(25);
    expect(r.posts.map((p) => p.title)).toEqual(["A real post"]);
    expect(requests[0].searchParams.get("offset")).toBe(String(LOOKS_PER_PAGE));
    expect(requests[0].searchParams.get("limit")).toBe(String(LOOKS_PER_PAGE));
  });

  // Most looks have no votes: without a last word on ties, a look shows on two pages or on none.
  it.each([
    ["newest", "created_at.desc,id.asc"],
    ["top", "upvotes.desc,created_at.desc,id.asc"],
    ["trending", "trending_score.desc,created_at.desc,id.asc"],
  ] as const)("puts %s looks in one order, ties and all", async (sort, order) => {
    await repo.listOutfits({ sort });
    expect(requests[0].searchParams.get("order")).toBe(order);
  });

  // The game's own sets were taken off the site: it lists what players publish, nothing else.
  it("lists only the published looks", async () => {
    reply = () => Response.json([row], { headers: { "Content-Range": `0-0/1` } });
    const r = await repo.listOutfits({ sort: "top" });
    expect(r.total).toBe(1);
    expect(r.posts.map((p) => p.title)).toEqual(["A real post"]);
  });

  it("lists nothing when nothing is published", async () => {
    reply = () => Response.json([], { headers: { "Content-Range": `*/0` } });
    expect(await repo.listOutfits({ sort: "top", armor: "plate" })).toEqual({ posts: [], total: 0 });
  });

  it("indexes only the published looks, for search, the sitemap and the bot", async () => {
    reply = () => Response.json([row], { headers: { "Content-Range": `0-0/1` } });
    const index = await repo.searchIndex();
    expect(index.map((e) => e.title)).toEqual(["A real post"]);
  });

  it("lists every public look for the sitemap, a page of rows at a time, with their named creators", async () => {
    const PAGE = 1000;
    const author = (i: number) => `33333333-3333-4333-8333-${String(i % 3).padStart(12, "0")}`;
    const rows = Array.from({ length: PAGE + 5 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      author_id: i === 7 ? null : author(i),
      profiles: i === 7 ? null : { display_name: i % 3 === 2 ? null : "Kira" },
    }));
    reply = (url) => {
      const from = Number(url.searchParams.get("offset") ?? 0);
      return Response.json(rows.slice(from, from + Number(url.searchParams.get("limit"))));
    };
    const { looks, creators } = await repo.sitemapEntries();
    expect(looks).toHaveLength(PAGE + 5);
    expect(new Set(looks).size).toBe(PAGE + 5);
    // A look from the Discord showcase has no creator page; nor has someone with no public name.
    expect(creators.sort()).toEqual([author(0), author(1)]);
    expect(requests).toHaveLength(2);
    for (const r of requests) {
      expect(r.searchParams.get("is_private")).toBe("eq.false");
      expect(r.searchParams.get("order")).toBe("created_at.asc,id.asc");
    }
  });

  it("filters the Showcase to posts with a capture", async () => {
    await repo.listOutfits({ sort: "top", captured: true });
    expect(requests[0].searchParams.get("gallery")).toBe("neq.{}");
  });

  it("filters to looks wearing one item, read from their codes by the database", async () => {
    await repo.listOutfits({ sort: "top", item: 1339122 });
    expect(requests[0].searchParams.get("items")).toBe("cs.{1339122}");
  });

  it("filters by what the code changes, as the database read it", async () => {
    await repo.listOutfits({ sort: "top", category: "Creature morph" });
    expect(requests[0].searchParams.get("categories")).toBe("cs.{Creature morph}");
  });

  it("filters by race and body, as the database read them from the code", async () => {
    await repo.listOutfits({ sort: "top", race: "bloodelf", sex: "female" });
    expect(requests[0].searchParams.get("race")).toBe("eq.bloodelf");
    expect(requests[0].searchParams.get("sex")).toBe("eq.female");
  });

  it("offers the filter choices some public look has", async () => {
    const values = { classes: ["Mage"], armor: ["cloth"], races: ["bloodelf"], sexes: ["female"] };
    reply = (url) => (url.pathname.endsWith("/rpc/gallery_filter_values") ? Response.json(values) : Response.json([]));
    expect(await repo.filterValues()).toEqual(values);
  });

  it("offers every choice rather than none when the choices cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reply = failWith("XX000", 500);
    const values = await repo.filterValues();
    expect(values.classes).toHaveLength(10);
    expect(values.armor).toEqual(["cloth", "leather", "mail", "plate"]);
    expect(values.races.length).toBeGreaterThan(20);
    expect(values.sexes).toEqual(["male", "female"]);
  });

  it("filters to one author", async () => {
    await repo.listOutfits({ sort: "top", authorId: row.id });
    expect(requests[0].searchParams.get("author_id")).toBe(`eq.${row.id}`);
  });

  it("leaves out one author's looks, for the community list beside your own", async () => {
    await repo.listOutfits({ sort: "top", excludeAuthorId: row.id });
    // Not neq: a look from the Discord showcase has no author yet, and `null <> id` is
    // unknown, which would drop it from every signed-in visitor's Wardrobe.
    expect(requests[0].searchParams.get("author_id")).toBe(`isdistinct.${row.id}`);
  });

  it("treats a page past the end as empty, not as a crash", async () => {
    reply = (_, init) => init?.method === "HEAD"
      ? new Response(null, { headers: { "Content-Range": `*/3` } })
      : Response.json({ code: "PGRST103", message: "Requested range not satisfiable" }, { status: 416 });
    await expect(repo.listOutfits({ sort: "top", page: 99 })).resolves.toEqual({ posts: [], total: 3 });
  });

  it("does not swallow a failed count behind a refused page", async () => {
    reply = (_, init) => init?.method === "HEAD"
      ? new Response(null, { status: 500 })
      : Response.json({ code: "PGRST103", message: "Requested range not satisfiable" }, { status: 416 });
    await expect(repo.listOutfits({ sort: "top", page: 99 })).rejects.toThrow();
  });

  it("never sends a non-uuid id to Postgres", async () => {
    await expect(repo.getOutfit("not-a-uuid")).resolves.toBeNull();
    const vote = await repo.vote("not-a-uuid", true);
    expect(vote.ok).toBe(false);
    expect(requests).toEqual([]);
  });

  it("opens no game set by its old link once the database is on", async () => {
    const { posts } = await builtinRepository.listOutfits({ sort: "top", armor: "plate", pageSize: 1 });
    expect(posts[0].id).toMatch(/^set-/);
    expect(await repo.getOutfit(posts[0].id)).toBeNull();
    expect(await repo.getOutfit("crystal-scholar")).toBeNull();
    expect(requests).toEqual([]);
  });
});

const PICTURE = "https://cdn.discordapp.com/avatars/123456789/0123abcdef.png";

describe("comments", () => {
  const comment = {
    id: "55555555-5555-4555-8555-555555555555",
    outfit_id: row.id,
    author_id: row.author_id,
    body: "Love the cape.",
    created_at: row.created_at,
    profiles: { display_name: "Kira", verified: true, avatar_url: PICTURE },
  };
  const said = {
    id: comment.id, outfitId: row.id, authorId: row.author_id, author: "Kira", authorVerified: true,
    authorAvatar: PICTURE, body: "Love the cape.", createdAt: row.created_at,
  };

  it("lists a look's comments oldest first, with the writer's public name", async () => {
    reply = () => Response.json([comment]);
    expect(await repo.listComments(row.id)).toEqual({ comments: [said], total: 1 });
    const q = requests[0].searchParams;
    expect(q.get("outfit_id")).toBe(`eq.${row.id}`);
    // Names the key: the reports table also joins comments to profiles.
    expect(q.get("select")).toContain("profiles!outfit_comments_author_id_fkey(display_name,verified,avatar_url)");
  });

  it("reads the newest page, so a new comment always shows, and says how many there are", async () => {
    const newer = { ...comment, id: "66666666-6666-4666-8666-666666666666", body: "Newer", created_at: "2026-11-02T00:00:00.000Z" };
    reply = () => Response.json([newer, comment], { headers: { "Content-Range": "0-1/450" } });
    const { comments, total } = await repo.listComments(row.id);
    expect(comments.map((c) => c.body)).toEqual(["Love the cape.", "Newer"]);
    expect(total).toBe(450);
    const q = requests[0].searchParams;
    expect(q.get("order")).toBe("created_at.desc,id.desc");
    expect(q.get("offset")).toBe("0");
    expect(q.get("limit")).toBe(String(COMMENTS_PER_PAGE));
  });

  it("reads older comments a page at a time, as far back as they go", async () => {
    reply = () => Response.json([comment], { headers: { "Content-Range": "400-400/401" } });
    expect(await repo.listComments(row.id, 3)).toEqual({ comments: [said], total: 401 });
    expect(requests[0].searchParams.get("offset")).toBe(String(2 * COMMENTS_PER_PAGE));
  });

  it("answers a page past the oldest with none, and still how many there are", async () => {
    reply = (_, init) => init?.method === "HEAD"
      ? new Response(null, { headers: { "Content-Range": "*/12" } })
      : Response.json({ code: "PGRST103", message: "Requested range not satisfiable" }, { status: 416 });
    expect(await repo.listComments(row.id, 9)).toEqual({ comments: [], total: 12 });
  });

  it("shows a writer with no picture by their initial", async () => {
    reply = () => Response.json([{ ...comment, profiles: { display_name: "Kira", verified: true, avatar_url: null } }]);
    expect((await repo.listComments(row.id)).comments).toEqual([{ ...said, authorAvatar: null }]);
  });

  it("has no comments for a built-in set, and asks the database nothing", async () => {
    expect(await repo.listComments("set-1074")).toEqual({ comments: [], total: 0 });
    expect(requests).toEqual([]);
  });

  it("posts as the signed-in account", async () => {
    user = { id: row.author_id };
    let sent: unknown;
    reply = (_, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(comment, { status: 201 });
    };
    expect(await repo.addComment(row.id, "Love the cape.")).toEqual({ ok: true, value: said });
    expect(sent).toEqual({ outfit_id: row.id, author_id: row.author_id, body: "Love the cape." });
  });

  it("asks a visitor to sign in, and asks the database nothing", async () => {
    expect(await repo.addComment(row.id, "hi")).toEqual({ ok: false, error: "Sign in to comment." });
    expect(requests).toEqual([]);
  });

  it("asks for a name, and explains the limit, when the database refuses", async () => {
    user = { id: row.author_id };
    reply = failWith("42501", 403);
    expect(await repo.addComment(row.id, "hi")).toEqual({ ok: false, error: "Choose a public name first, from the account button." });
    reply = failWith("EC002", 400);
    expect((await repo.addComment(row.id, "hi")).ok).toBe(false);
  });

  it("says when a removal was refused, which RLS answers with no rows", async () => {
    reply = () => Response.json([]);
    expect(await repo.deleteComment(comment.id)).toEqual({
      ok: false, error: "You can only remove your own comments, or those on your looks.",
    });
    reply = () => Response.json([{ id: comment.id }]);
    expect(await repo.deleteComment(comment.id)).toEqual({ ok: true, value: comment.id });
  });

  it("files a report through report_comment, and says when it is new", async () => {
    reply = () => Response.json(true);
    expect(await repo.reportComment(comment.id, "spam")).toEqual({ ok: true, value: true });
    expect(requests[0].pathname).toBe("/rest/v1/rpc/report_comment");
  });

  it("lists reported comments for a moderator and nothing for anyone else", async () => {
    reply = () => Response.json([{
      comment_id: comment.id, outfit_id: row.id, title: "A real post", body: "spam", author: "Kira",
      reports: 2, reasons: ["spam"], last_report: row.created_at,
    }]);
    expect(await repo.listCommentReports()).toEqual([{
      id: comment.id, outfitId: row.id, title: "A real post", body: "spam", author: "Kira",
      reports: 2, reasons: ["spam"], lastReport: row.created_at,
    }]);
    reply = failWith("42501", 403);
    expect(await repo.listCommentReports()).toEqual([]);
  });
});
