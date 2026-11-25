import "server-only";
import {
  ARMOR_TYPES, CLASSES, LOOKS_PER_PAGE, RACE_LABEL, SEXES, type ArmorType, type Category, type ClassName,
} from "@/lib/domain";
import { hashSecret, newLinkCode } from "@/lib/game-sync/secrets";
import { COMMENTS_PER_PAGE } from "@/lib/limits";
import { cleanSetName } from "@/lib/game-sync/wire";
import { SCREENSHOT_BUCKET, screenshotFiles, screenshotUrl, smallOf, thumbOf } from "@/lib/screenshots";
import { createServerSupabase } from "@/lib/supabase/server";
import { compressScreenshot, SCREENSHOT_EXTENSION, SCREENSHOT_TYPE } from "./compress";
import type {
  CommentReportReason, CreatorEntry, FilterValues, GameLink, GameSet, LookComment, OutfitFilters, OutfitList, OutfitPost, ReportReason,
  Repository, WriteResult,
} from "./types";

// The same seam as builtin.ts, over supabase/migrations. RLS is what protects the
// rows: this file holds no rule the database does not enforce.

interface OutfitRow {
  id: string;
  title: string;
  code: string;
  class_name: ClassName | null;
  armor: ArmorType | null;
  race: string | null;
  categories: Category[];
  tags: string[];
  description: string | null;
  upvotes: number;
  copies: number;
  created_at: string;
  /** Null on a look from the Discord showcase until its player signs in. */
  author_id: string | null;
  discord_name: string | null;
  gallery: string[];
  profiles: { display_name: string | null; verified: boolean; avatar_url?: string | null } | null;
  is_private: boolean;
  remix?: { id: string; title: string; discord_name?: string | null; profiles: { display_name: string | null } | null } | null;
}

interface ReportedRow {
  outfit_id: string;
  title: string;
  reports: number;
  reasons: ReportReason[];
  last_report: string;
}

interface CommentRow {
  id: string;
  outfit_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles: { display_name: string | null; verified: boolean; avatar_url?: string | null } | null;
}

interface ReportedCommentRow {
  comment_id: string;
  outfit_id: string;
  title: string;
  body: string;
  author: string | null;
  reports: number;
  reasons: CommentReportReason[];
  last_report: string;
}

// outfit_comment_reports also joins comments to profiles, so the embed names its key.
const COMMENT_COLUMNS = "id,outfit_id,author_id,body,created_at,profiles!outfit_comments_author_id_fkey(display_name,verified,avatar_url)";

const toComment = (r: CommentRow): LookComment => ({
  id: r.id,
  outfitId: r.outfit_id,
  authorId: r.author_id,
  author: r.profiles?.display_name ?? null,
  authorVerified: r.profiles?.verified ?? false,
  authorAvatar: safeAvatar(r.profiles?.avatar_url),
  body: r.body,
  createdAt: r.created_at,
});

interface GameLinkRow {
  id: string;
  label: string;
  created_at: string;
  last_sync_at: string | null;
}

interface GameSetRow {
  id: string;
  name: string;
  code: string;
  updated_at: string;
  gallery: string[];
}

const toGameSet = (r: GameSetRow): GameSet => ({
  id: r.id,
  name: r.name,
  code: r.code,
  updatedAt: r.updated_at,
  gallery: r.gallery,
});

// The hint is required: outfit_votes, outfit_reports and outfit_bookmarks also join
// outfits to profiles, and PostgREST refuses a bare profiles(...) embed as ambiguous.
const OUTFIT_COLUMNS =
  "id,title,code,class_name,armor,race,categories,tags,description,upvotes,copies,created_at,author_id,discord_name,gallery,is_private,profiles!outfits_author_id_fkey(display_name,verified,avatar_url)," +
  // outfits refers to itself. Embedding through the column itself reaches the original (one
  // row, or null); `outfits!remixed_from` reached the other way, the remixes, as an array.
  "remix:remixed_from(id,title,discord_name,profiles!outfits_author_id_fkey(display_name))";

const toPost = (r: OutfitRow): OutfitPost => ({
  id: r.id,
  title: r.title,
  // Once claimed, the profile's name wins over the one the player had on Discord.
  author: r.profiles?.display_name ?? r.discord_name ?? null,
  authorId: r.author_id,
  authorVerified: r.profiles?.verified ?? false,
  sharedOnDiscord: r.author_id === null && Boolean(r.discord_name),
  authorAvatar: safeAvatar(r.profiles?.avatar_url),
  code: r.code,
  className: r.class_name,
  armor: r.armor,
  race: r.race,
  categories: r.categories,
  tags: r.tags,
  description: r.description,
  upvotes: r.upvotes,
  copies: r.copies,
  createdAt: r.created_at,
  gallery: r.gallery.map(screenshotUrl),
  remixedFrom: r.remix ? { id: r.remix.id, title: r.remix.title, author: r.remix.profiles?.display_name ?? r.remix.discord_name ?? null } : null,
  isPrivate: r.is_private,
});

// A search term goes into PostgREST's filter text, where , ( ) are syntax.
const safeTerm = (q: string) => q.replace(/[^\p{L}\p{N} '-]/gu, " ").trim();

// Postgres answers a malformed uuid with an error, so an id from a URL is checked
// first. A bad link should be a 404, not a 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The look id a refusal carries in its detail, if it is one. */
const lookId = (detail: string | null | undefined) => (detail && UUID.test(detail) ? detail : undefined);

// What PostgREST answers when the requested page starts past the last row.
const RANGE_NOT_SATISFIABLE = "PGRST103";
// The errcode set_outfit_vote raises for a signed-out caller.
const SIGNED_OUT = "28000";
// What Postgres answers when RLS refuses a row: here, an author with no name yet.
const REFUSED_BY_POLICY = "42501";
// The errcode limit_publishing raises (the names_and_limits migration).
const PUBLISHING_LIMIT = "EC001";
// The errcode limit_commenting raises (the look_comments migration).
const COMMENTING_LIMIT = "EC002";
// The errcode one_public_look_per_code raises, with the look already there in its detail.
const ALREADY_PUBLIC = "EC003";
const ALREADY_PUBLISHED = "This look is already in the Community Gallery.";
const UNIQUE_VIOLATION = "23505";
// A comment on a look deleted while it was being written.
const FOREIGN_KEY_VIOLATION = "23503";

// Storage reports a refused upload by message. Past the folder check, which the
// site's own path always passes, the policy's only reason to refuse is the limit.
const uploadError = (message: string): WriteResult<string> => ({
  ok: false,
  error: message.includes("row-level security")
    ? "You have 60 screenshots stored. Delete a look to free some up."
    : "That screenshot could not be stored. Try again.",
});
const SEARCH_INDEX_SIZE = 200;
/** Rows the sitemap reads per request: the most the database's API answers with at once. */
const SITEMAP_PAGE = 1000;
/** A sitemap holds 50,000 addresses; past that it would need splitting. */
const SITEMAP_MAX = 49_000;
/** How many public looks finding creators reads, the most upvoted first. Far more than exist today. */
const CREATOR_SCAN = 2000;

/** People can edit their own user metadata, so this is only a suggestion. */
const safeAvatar = (url: unknown) => (typeof url === "string" && url.startsWith("https://") ? url : null);

const outfitRows = (
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  f: OutfitFilters,
  columns: string,
  options: { count: "exact"; head?: boolean },
  savedBy: string | null,
) => {
  // An inner embed keeps only the outfits with a matching bookmark row.
  let query = savedBy
    ? db.from("outfits").select(`${columns},outfit_bookmarks!inner(user_id)`, options).eq("outfit_bookmarks.user_id", savedBy)
    : db.from("outfits").select(columns, options);
  // The rows say who may read a private look; a list says whether it wants them.
  if (!f.includePrivate) query = query.eq("is_private", false);
  if (f.captured) query = query.neq("gallery", "{}");
  if (f.authorId) query = query.eq("author_id", f.authorId);
  // IS DISTINCT FROM, not <>: a look from the Discord showcase has no author until its
  // player signs in, and `null <> id` is unknown, which would leave it out.
  if (f.excludeAuthorId) query = query.filter("author_id", "isdistinct", f.excludeAuthorId);
  if (f.className) query = query.eq("class_name", f.className);
  // race and sex are written by a trigger from the code (the look_body_from_code migration).
  if (f.race) query = query.eq("race", f.race);
  if (f.sex) query = query.eq("sex", f.sex);
  if (f.armor) query = query.eq("armor", f.armor);
  // categories is written by a trigger from the code (the look_categories migration).
  if (f.category) query = query.contains("categories", [f.category]);
  if (f.tag) query = query.contains("tags", [f.tag]);
  // items is written by a trigger from the code (the look_items migration).
  if (f.item) query = query.contains("items", [f.item]);
  const term = f.q ? safeTerm(f.q) : "";
  if (term) query = query.ilike("title", `%${term}%`);
  return query;
};

/** The looks players published, one page at a time. The game's own sets are not listed. */
async function listOutfits(f: OutfitFilters): Promise<OutfitList> {
  const db = await createServerSupabase();
  let savedBy: string | null = null;
  if (f.saved) {
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { posts: [], total: 0 };
    savedBy = auth.user.id;
  }
  const size = f.pageSize ?? LOOKS_PER_PAGE;
  const from = (Math.max(1, f.page ?? 1) - 1) * size;
  const page = outfitRows(db, f, OUTFIT_COLUMNS, { count: "exact" }, savedBy).range(from, from + size - 1);
  const ranked =
    f.sort === "newest" ? page : page.order(f.sort === "top" ? "upvotes" : "trending_score", { ascending: false });
  // Ties end at the id, so a look never shows on two pages or on none.
  const { data, error, count } = await ranked.order("created_at", { ascending: false }).order("id");
  if (error?.code === RANGE_NOT_SATISFIABLE) {
    // The refusal holds no count, and the caller pages on past the last row.
    const { count: rows, error: failed } = await outfitRows(db, f, "id", { count: "exact", head: true }, savedBy);
    if (failed) throw new Error(failed.message);
    return { posts: [], total: rows ?? 0 };
  }
  if (error) throw new Error(error.message);
  return { posts: (data as unknown as OutfitRow[]).map(toPost), total: count ?? 0 };
}

export const supabaseRepository: Repository = {
  live: true,
  listOutfits,
  async filterValues() {
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("gallery_filter_values");
    // A failure offers every choice, as before there were choices to read: the filters
    // still work, some only find nothing.
    if (error || !data) {
      console.error("Filter choices failed:", error?.message);
      return { classes: [...CLASSES], armor: [...ARMOR_TYPES], races: Object.keys(RACE_LABEL), sexes: [...SEXES] };
    }
    return data as FilterValues;
  },
  async getOutfit(id) {
    // Every published look has a uuid. The game's own sets (set-1074) are no longer looks here.
    if (!UUID.test(id)) return null;
    const db = await createServerSupabase();
    const { data, error } = await db.from("outfits").select(OUTFIT_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toPost(data as unknown as OutfitRow) : null;
  },
  async lookOfTheWeek() {
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("look_of_the_week");
    // An extra on the home page: a failure here leaves the section out, not the page.
    if (error) {
      console.error("Look of the week failed:", error.message);
      return null;
    }
    const pick = (data as { outfit_id: string; votes: number }[])[0];
    if (!pick) return null;
    const post = await supabaseRepository.getOutfit(pick.outfit_id);
    return post ? { post, votes: Number(pick.votes) } : null;
  },
  async getCreator(id) {
    if (!UUID.test(id)) return null;
    const db = await createServerSupabase();
    // RLS limits the looks to what this visitor can see, so a hidden look is not counted,
    // and only public ones count, so the owner sees the numbers everyone else does.
    const [profile, looks] = await Promise.all([
      db.from("profiles").select("display_name,verified,created_at,avatar_url").eq("id", id).maybeSingle(),
      db.from("outfits").select("upvotes,class_name").eq("author_id", id).eq("is_private", false),
    ]);
    if (profile.error) throw new Error(profile.error.message);
    if (looks.error) throw new Error(looks.error.message);
    if (!profile.data?.display_name) return null;
    const classes = new Map<ClassName, number>();
    for (const r of looks.data) {
      if (r.class_name) classes.set(r.class_name as ClassName, (classes.get(r.class_name as ClassName) ?? 0) + 1);
    }
    return {
      id,
      name: profile.data.display_name,
      verified: profile.data.verified,
      joinedAt: profile.data.created_at,
      avatar: safeAvatar(profile.data.avatar_url),
      looks: looks.data.length,
      upvotes: looks.data.reduce((sum, r) => sum + r.upvotes, 0),
      classes: [...classes].map(([className, n]) => ({ className, looks: n })).sort((a, b) => b.looks - a.looks),
    };
  },
  async listCreators({ q, limit }) {
    const db = await createServerSupabase();
    // Counted from the looks rather than the profiles, so nobody without a public look is listed.
    // The inner join drops looks whose author's name does not match the search.
    let query = db
      .from("outfits")
      .select("author_id,profiles!outfits_author_id_fkey!inner(display_name,verified,avatar_url)")
      .eq("is_private", false)
      .not("author_id", "is", null)
      .order("upvotes", { ascending: false })
      .limit(CREATOR_SCAN);
    const term = q ? safeTerm(q) : "";
    if (term) query = query.ilike("profiles.display_name", `%${term}%`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const found = new Map<string, CreatorEntry>();
    for (const r of data as unknown as { author_id: string; profiles: OutfitRow["profiles"] }[]) {
      const name = r.profiles?.display_name;
      if (!name) continue;
      const seen = found.get(r.author_id);
      if (seen) seen.looks += 1;
      else found.set(r.author_id, { id: r.author_id, name, verified: r.profiles?.verified ?? false, avatar: safeAvatar(r.profiles?.avatar_url), looks: 1 });
    }
    return [...found.values()].sort((a, b) => b.looks - a.looks || a.name.localeCompare(b.name)).slice(0, limit);
  },
  async searchIndex() {
    const { posts } = await listOutfits({ sort: "top", pageSize: SEARCH_INDEX_SIZE });
    return posts.map(({ id, title, author }) => ({ id, title, author }));
  },
  async sitemapEntries() {
    const db = await createServerSupabase();
    const looks: string[] = [];
    const creators = new Set<string>();
    // Oldest first, ending at the id, so a look published while this reads moves no page.
    for (let from = 0; from < SITEMAP_MAX; from += SITEMAP_PAGE) {
      const { data, error } = await db
        .from("outfits")
        .select("id,author_id,profiles!outfits_author_id_fkey(display_name)")
        .eq("is_private", false)
        .order("created_at")
        .order("id")
        .range(from, from + SITEMAP_PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data as unknown as { id: string; author_id: string | null; profiles: { display_name: string | null } | null }[];
      for (const r of rows) {
        looks.push(r.id);
        // A creator's page shows only for someone with a public name.
        if (r.author_id && r.profiles?.display_name) creators.add(r.author_id);
      }
      if (rows.length < SITEMAP_PAGE) break;
    }
    return { looks, creators: [...creators] };
  },
  async createOutfit(input) {
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to publish." };
    const { data, error } = await db
      .from("outfits")
      .insert({
        author_id: auth.user.id,
        title: input.title,
        code: input.code.trim(),
        class_name: input.className ?? null,
        armor: input.armor ?? null,
        race: input.race ?? null,
        tags: input.tags,
        description: input.description ?? null,
        gallery: input.gallery,
        remixed_from: input.remixedFrom ?? null,
      })
      .select(OUTFIT_COLUMNS)
      .single();
    if (error?.code === REFUSED_BY_POLICY) return { ok: false, error: "Choose a public name first, from the account button." };
    if (error?.code === PUBLISHING_LIMIT) return { ok: false, error: "That is 20 looks this hour. Try again later." };
    if (error?.code === ALREADY_PUBLIC) return { ok: false, error: ALREADY_PUBLISHED, existing: lookId(error.details) };
    if (error) return { ok: false, error: "That outfit could not be saved. Try again." };
    return { ok: true, value: toPost(data as unknown as OutfitRow) };
  },
  async vote(id, up) {
    if (!UUID.test(id)) return { ok: false, error: "That look cannot be voted on." };
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("set_outfit_vote", { target: id, up });
    // Only signed-in accounts may run the vote function, so a refusal means a signed-out visitor.
    if (error?.code === SIGNED_OUT || error?.code === REFUSED_BY_POLICY) return { ok: false, error: "Sign in to vote." };
    if (error) return { ok: false, error: "That vote could not be counted. Try again." };
    return { ok: true, value: data as number };
  },
  async votedOn(ids) {
    const looks = ids.filter((id) => UUID.test(id));
    if (!looks.length) return [];
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return [];
    const { data } = await db.from("outfit_votes").select("outfit_id").eq("user_id", auth.user.id).in("outfit_id", looks);
    return (data ?? []).map((r) => r.outfit_id as string);
  },
  async report(id, reason) {
    if (!UUID.test(id)) return { ok: false, error: "That look cannot be reported." };
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("report_outfit", { target: id, why: reason });
    if (error?.code === SIGNED_OUT) return { ok: false, error: "Sign in to report a look." };
    if (error) return { ok: false, error: "That report could not be sent. Try again." };
    return { ok: true, value: data === true };
  },
  async isBookmarked(id) {
    if (!UUID.test(id)) return false;
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return false;
    const { data } = await db
      .from("outfit_bookmarks")
      .select("outfit_id")
      .eq("user_id", auth.user.id)
      .eq("outfit_id", id)
      .maybeSingle();
    return Boolean(data);
  },
  async setBookmark(id, saved) {
    if (!UUID.test(id)) return { ok: false, error: "That look cannot be bookmarked." };
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to bookmark a look." };
    const { error } = saved
      ? await db.from("outfit_bookmarks").insert({ user_id: auth.user.id, outfit_id: id })
      : await db.from("outfit_bookmarks").delete().eq("user_id", auth.user.id).eq("outfit_id", id);
    // A double click lands the same bookmark twice; the first one already saved it.
    if (error && error.code !== UNIQUE_VIOLATION) return { ok: false, error: "That bookmark could not be saved. Try again." };
    return { ok: true, value: saved };
  },
  async listReports() {
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("moderation_queue");
    if (error?.code === REFUSED_BY_POLICY) return [];
    if (error) throw new Error(error.message);
    return (data as ReportedRow[]).map((r) => ({
      id: r.outfit_id,
      title: r.title,
      reports: Number(r.reports),
      reasons: r.reasons,
      lastReport: r.last_report,
    }));
  },
  async dismissReports(id) {
    if (!UUID.test(id)) return { ok: false, error: "That look has no reports to dismiss." };
    const db = await createServerSupabase();
    const { error } = await db.rpc("dismiss_reports", { target: id });
    if (error?.code === REFUSED_BY_POLICY) return { ok: false, error: "Only moderators can dismiss reports." };
    if (error) return { ok: false, error: "Those reports could not be dismissed. Try again." };
    return { ok: true, value: id };
  },
  async listComments(outfitId, page = 1) {
    if (!UUID.test(outfitId)) return { comments: [], total: 0 };
    const db = await createServerSupabase();
    // Read newest first, so a new comment is always on the first page, then shown in order.
    const from = (Math.max(1, page) - 1) * COMMENTS_PER_PAGE;
    const { data, error, count } = await db
      .from("outfit_comments")
      .select(COMMENT_COLUMNS, { count: "exact" })
      .eq("outfit_id", outfitId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + COMMENTS_PER_PAGE - 1);
    if (error?.code === RANGE_NOT_SATISFIABLE) {
      // A page past the oldest: the refusal holds no count.
      const { count: rows, error: failed } = await db
        .from("outfit_comments")
        .select("id", { count: "exact", head: true })
        .eq("outfit_id", outfitId);
      if (failed) throw new Error(failed.message);
      return { comments: [], total: rows ?? 0 };
    }
    if (error) throw new Error(error.message);
    const rows = data as unknown as CommentRow[];
    return { comments: rows.map(toComment).reverse(), total: count ?? rows.length };
  },
  async getComment(id) {
    if (!UUID.test(id)) return null;
    const db = await createServerSupabase();
    const { data } = await db.from("outfit_comments").select(COMMENT_COLUMNS).eq("id", id).maybeSingle();
    return data ? toComment(data as unknown as CommentRow) : null;
  },
  async addComment(outfitId, body) {
    if (!UUID.test(outfitId)) return { ok: false, error: "That look cannot be commented on." };
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to comment." };
    const { data, error } = await db
      .from("outfit_comments")
      .insert({ outfit_id: outfitId, author_id: auth.user.id, body })
      .select(COMMENT_COLUMNS)
      .single();
    if (error?.code === REFUSED_BY_POLICY) return { ok: false, error: "Choose a public name first, from the account button." };
    if (error?.code === COMMENTING_LIMIT) return { ok: false, error: "That is a lot of comments at once. Try again in a few minutes." };
    if (error?.code === FOREIGN_KEY_VIOLATION) return { ok: false, error: "That look is gone." };
    if (error) return { ok: false, error: "That comment could not be posted. Try again." };
    return { ok: true, value: toComment(data as unknown as CommentRow) };
  },
  async deleteComment(id) {
    if (!UUID.test(id)) return { ok: false, error: "That comment cannot be removed." };
    const db = await createServerSupabase();
    const { data, error } = await db.from("outfit_comments").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: "That comment could not be removed. Try again." };
    // RLS answers a delete it refuses with no rows, not with an error.
    if (!data.length) return { ok: false, error: "You can only remove your own comments, or those on your looks." };
    return { ok: true, value: id };
  },
  async reportComment(id, reason) {
    if (!UUID.test(id)) return { ok: false, error: "That comment cannot be reported." };
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("report_comment", { target: id, why: reason });
    if (error?.code === SIGNED_OUT) return { ok: false, error: "Sign in to report a comment." };
    if (error) return { ok: false, error: "That report could not be sent. Try again." };
    return { ok: true, value: data === true };
  },
  async listCommentReports() {
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("comment_moderation_queue");
    if (error?.code === REFUSED_BY_POLICY) return [];
    if (error) throw new Error(error.message);
    return (data as ReportedCommentRow[]).map((r) => ({
      id: r.comment_id,
      outfitId: r.outfit_id,
      title: r.title,
      body: r.body,
      author: r.author,
      reports: Number(r.reports),
      reasons: r.reasons,
      lastReport: r.last_report,
    }));
  },
  async dismissCommentReports(id) {
    if (!UUID.test(id)) return { ok: false, error: "That comment has no reports to dismiss." };
    const db = await createServerSupabase();
    const { error } = await db.rpc("dismiss_comment_reports", { target: id });
    if (error?.code === REFUSED_BY_POLICY) return { ok: false, error: "Only moderators can dismiss reports." };
    if (error) return { ok: false, error: "Those reports could not be dismissed. Try again." };
    return { ok: true, value: id };
  },
  async uploadScreenshot(file) {
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to upload." };
    const compressed = await compressScreenshot(Buffer.from(await file.arrayBuffer()));
    if (!compressed) return { ok: false, error: "That file could not be read as an image." };
    // The first folder is the owner: the bucket's RLS policy checks exactly this.
    const path = `${auth.user.id}/${crypto.randomUUID()}.${SCREENSHOT_EXTENSION}`;
    const files = db.storage.from(SCREENSHOT_BUCKET);
    // Keeps Storage's one-hour cache. The Free plan cannot purge the CDN, so a longer
    // one would keep serving an image a moderator had deleted.
    const store = (to: string, body: Buffer) => files.upload(to, body, { contentType: SCREENSHOT_TYPE });
    // The smaller copies first: a post can only name the full file, so a failure here
    // can never leave a post pointing at half a screenshot.
    const written: string[] = [];
    for (const [to, body] of [
      [thumbOf(path), compressed.thumb],
      [smallOf(path), compressed.small],
      [path, compressed.full],
    ] as const) {
      const stored = await store(to, body);
      if (stored.error) {
        if (written.length) await files.remove(written);
        return uploadError(stored.error.message);
      }
      written.push(to);
    }
    return { ok: true, value: path };
  },
  async removeScreenshot(path) {
    const db = await createServerSupabase();
    const { error } = await db.storage.from(SCREENSHOT_BUCKET).remove(screenshotFiles(path));
    if (error) return { ok: false, error: "That screenshot could not be removed." };
    return { ok: true, value: path };
  },
  async deleteOutfit(id) {
    if (!UUID.test(id)) return { ok: false, error: "That look cannot be deleted." };
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to delete a look." };
    const { data, error } = await db.from("outfits").delete().eq("id", id).select("gallery");
    if (error) return { ok: false, error: "That look could not be deleted. Try again." };
    // RLS answers a delete it refuses with no rows, not with an error.
    if (!data.length) return { ok: false, error: "You can only delete your own looks." };
    const paths = (data[0].gallery as string[]).flatMap(screenshotFiles);
    if (paths.length) await db.storage.from(SCREENSHOT_BUCKET).remove(paths);
    return { ok: true, value: id };
  },
  async setOutfitPrivate(id, isPrivate) {
    if (!UUID.test(id)) return { ok: false, error: "That look cannot be changed." };
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to change your look." };
    const { data, error } = await db.from("outfits").update({ is_private: isPrivate }).eq("id", id).select("id");
    if (error?.code === ALREADY_PUBLIC) {
      return { ok: false, error: "Another public look has the same code, so this one stays private.", existing: lookId(error.details) };
    }
    if (error) return { ok: false, error: "That look could not be changed. Try again." };
    // RLS answers an update it refuses with no rows, not with an error.
    if (!data.length) return { ok: false, error: "You can only change your own looks." };
    return { ok: true, value: isPrivate };
  },
  async getAccount() {
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return null;
    const { data } = await db
      .from("profiles")
      .select("display_name,moderators(user_id)")
      .eq("id", auth.user.id)
      .maybeSingle();
    return {
      id: auth.user.id,
      name: data?.display_name ?? null,
      avatar: safeAvatar(auth.user.user_metadata?.avatar_url),
      provider: auth.user.app_metadata?.provider ?? null,
      moderator: Boolean(data?.moderators),
    };
  },
  async setDisplayName(name) {
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to choose a name." };
    const { data, error } = await db
      .from("profiles")
      .update({ display_name: name })
      .eq("id", auth.user.id)
      .select("display_name")
      .single();
    if (error?.code === UNIQUE_VIOLATION) return { ok: false, error: "That name is taken. Try another." };
    if (error) return { ok: false, error: "That name could not be saved. Try again." };
    return { ok: true, value: data.display_name };
  },
  async listGameLinks() {
    const db = await createServerSupabase();
    const { data, error } = await db
      .from("game_links")
      .select("id,label,created_at,last_sync_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as GameLinkRow[]).map((r): GameLink => ({
      id: r.id,
      label: r.label,
      linkedAt: r.created_at,
      lastSyncAt: r.last_sync_at,
    }));
  },
  async listGameSets() {
    const db = await createServerSupabase();
    const { data, error } = await db
      .from("game_sets")
      .select("id,name,code,updated_at,gallery")
      .not("code", "is", null)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as GameSetRow[]).map(toGameSet);
  },
  async getGameSet(id) {
    if (!UUID.test(id)) return null;
    const db = await createServerSupabase();
    const { data, error } = await db
      .from("game_sets")
      .select("id,name,code,updated_at,gallery")
      .eq("id", id)
      .not("code", "is", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toGameSet(data as GameSetRow) : null;
  },
  async newGameLinkCode() {
    const db = await createServerSupabase();
    const code = newLinkCode();
    const { data, error } = await db.rpc("game_link_new", { p_code_hash: hashSecret(code) });
    if (error) return { ok: false, error: "Sign in to link your game." };
    return { ok: true, value: { code, expiresAt: data as string } };
  },
  async unlinkGame(id) {
    const db = await createServerSupabase();
    const { error } = await db.from("game_links").delete().eq("id", id);
    if (error) return { ok: false, error: "That game could not be unlinked. Try again." };
    return { ok: true, value: id };
  },
  async sendToGame(title, code) {
    const db = await createServerSupabase();
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, error: "Sign in to send looks to your game." };
    const { data, error } = await db.rpc("game_set_send", { p_name: cleanSetName(title), p_code: code });
    if (error) return { ok: false, error: "That look could not be sent. Try again." };
    if (!data) return { ok: false, error: "Your sets are full. Remove one to make room." };
    return { ok: true, value: data as { name: string; linked: boolean } };
  },
  async removeGameSet(id) {
    const db = await createServerSupabase();
    const { error } = await db.rpc("game_set_remove", { p_id: id });
    if (error) return { ok: false, error: "That set could not be removed. Try again." };
    await supabaseRepository.clearOrphanPictures();
    return { ok: true, value: id };
  },
  async removeSetPicture(setId, path) {
    if (!UUID.test(setId)) return { ok: false, error: "That picture could not be removed." };
    const db = await createServerSupabase();
    const { error } = await db.rpc("game_set_drop_shot", { p_set: setId, p_path: path });
    if (error) return { ok: false, error: "That picture could not be removed. Try again." };
    await supabaseRepository.clearOrphanPictures();
    return { ok: true, value: path };
  },
  async clearOrphanPictures() {
    // Best effort: an orphan left behind is tried again on the next visit to the sets.
    const db = await createServerSupabase();
    const { data, error } = await db.rpc("game_shot_orphans");
    const paths = (data as string[] | null) ?? [];
    if (error || !paths.length) return;
    const removed = await db.storage.from(SCREENSHOT_BUCKET).remove(paths.flatMap(screenshotFiles));
    if (removed.error) {
      console.error("Clearing old set pictures failed:", removed.error.message);
      return;
    }
    await db.rpc("game_shot_forget", { p_paths: paths });
  },
};
