"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { resolveOutfit, resolveWorld, type ResolvedOutfit, type ResolvedWorldPlace } from "@/lib/catalog";
import { decodeOutfit, OUTFIT_TAG, type Outfit } from "@/lib/codec/outfit";
import { CODE_TOO_LONG, displayNameSchema, submitOutfitSchema, type SubmitOutfit } from "@/lib/codec/schema";
import { decodeWorld, OUTFIT_WORLD_TAG } from "@/lib/codec/world";
import { repository } from "@/lib/data";
import { adminConfigured, recordCopy } from "@/lib/data/admin";
import {
  COMMENT_REPORT_REASONS, REPORT_REASONS, type CommentReportReason, type ReportReason,
} from "@/lib/data/types";
import { commentSchema } from "@/lib/comments";
import { creatorOf, grantCreatorOfLook, recheckCreator } from "@/lib/discord-roles";
import { CODE_MAX, GAME_PICTURES_MAX, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES } from "@/lib/limits";
import { announceLook } from "@/lib/look-feed";
import { alertCommentReport, alertModerators } from "@/lib/moderation-alert";
import { publishSetsInTurn, type Published, type PublishedSets } from "@/lib/publish-sets";
import { UPLOAD_PATH } from "@/lib/screenshots";
import { visitorOf } from "@/lib/visitor";
import { errorIn } from "@/i18n/errors";
import { isLocale } from "@/i18n/locales";

export type InspectResult =
  | { kind: "outfit"; outfit: Outfit; resolved: ResolvedOutfit; warnings: string[] }
  | { kind: "world"; places: ResolvedWorldPlace[] }
  | { kind: "error"; error: string };

/** An action's answer with its error, if any, in the reader's language. Not exported: a "use server" file may export only actions. */
async function said<T>(answer: T | Promise<T>): Promise<T> {
  const r = await answer;
  if (!r || typeof r !== "object" || !("error" in r) || typeof r.error !== "string") return r;
  const locale = await getLocale();
  return { ...r, error: errorIn(isLocale(locale) ? locale : "en", r.error) };
}

/** What a pasted code holds, with the names the code itself does not carry. */
export async function inspectCode(text: string): Promise<InspectResult> {
  const head = text.trimStart().slice(0, 5).toUpperCase();
  // A world code keeps the game's own limit, which decodeWorld checks first.
  if (head === OUTFIT_WORLD_TAG) {
    const r = decodeWorld(text);
    return said(r.ok ? { kind: "world", places: resolveWorld(r.places) } : { kind: "error", error: r.error });
  }
  // Anyone may call this, so a long look code is refused before it costs a decode.
  if (text.length > CODE_MAX) return said({ kind: "error", error: CODE_TOO_LONG });
  const r = decodeOutfit(text);
  if (!r.ok) {
    return said({
      kind: "error",
      error: head === OUTFIT_TAG || !text.trim() ? r.error : "That is not an Eclipse code. Codes start with ECA1: or ECW1:.",
    });
  }
  return { kind: "outfit", outfit: r.outfit, resolved: resolveOutfit(r.outfit), warnings: r.warnings };
}

export async function publishOutfit(input: SubmitOutfit): Promise<Published> {
  return said(publish(input));
}

/**
 * The one way a look is published, from the form or a ready set: the schema, then the
 * database (sign-in, public name, the hourly limit, one public look per code, and the
 * trigger that takes the set's pictures), then the Discord feed and the Creator role.
 */
async function publish(input: SubmitOutfit): Promise<Published> {
  const parsed = submitOutfitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const r = await repository.createOutfit(parsed.data);
  if (!r.ok) return r;
  revalidateHub();
  const post = r.value;
  after(() => announceLook(post));
  after(() => grantCreatorOfLook(post.id));
  return { ok: true, id: post.id };
}

// No more sets can hold pictures than pictures can wait on them.
const setIdsSchema = z.array(z.uuid()).min(1).max(GAME_PICTURES_MAX);

/**
 * Ready sets published as they are, with what the form would have filled in, one at a time
 * down the form's own path. Each answer says what became of every set, and when the hourly
 * limit stopped the batch, how many were never tried and why.
 */
export async function publishGameSets(ids: string[]): Promise<{ ok: true; value: PublishedSets } | { ok: false; error: string }> {
  const parsed = setIdsSchema.safeParse(ids);
  if (!parsed.success) return said({ ok: false as const, error: "Choose the loadouts to publish." });
  if (!(await repository.getAccount())) return said({ ok: false as const, error: "Sign in to publish." });
  const done = await publishSetsInTurn(parsed.data, { getSet: (id) => repository.getGameSet(id), publish });
  if (done.outcomes.some((o) => o.ok)) revalidatePath("/loadouts");
  const locale = await getLocale();
  const tell = (error: string) => errorIn(isLocale(locale) ? locale : "en", error);
  return {
    ok: true,
    value: {
      ...done,
      outcomes: done.outcomes.map((o) => (o.ok ? o : { ...o, error: tell(o.error) })),
      stoppedBy: done.stoppedBy && tell(done.stoppedBy),
    },
  };
}

function revalidateHub() {
  revalidatePath("/community-gallery");
  revalidatePath("/");
}

export async function uploadScreenshot(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) return said({ ok: false as const, error: "Choose a screenshot first." });
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) {
    return said({ ok: false as const, error: "Screenshots can be PNG, JPEG or WebP." });
  }
  if (file.size > MAX_SCREENSHOT_BYTES) return said({ ok: false as const, error: "Keep each screenshot under 4 MB." });
  return said(repository.uploadScreenshot(file));
}

/** A screenshot taken back off the form before publishing. Its slot is freed too. */
export async function removeScreenshot(path: string) {
  if (!UPLOAD_PATH.test(path)) return said({ ok: false as const, error: "That is not an uploaded screenshot." });
  return said(repository.removeScreenshot(path));
}

export async function deleteLook(id: string) {
  // Read before the look goes: afterwards nothing says whose it was.
  const player = await creatorOf(id).catch(() => null);
  const r = await repository.deleteOutfit(id);
  if (r.ok) {
    revalidateHub();
    revalidatePath(`/community-gallery/${id}`);
    after(() => recheckCreator(player));
  }
  return said(r);
}

/**
 * The author's own look out of the Community Gallery, or back in. It keeps its date and
 * votes, so a look shown again stands where it stood, not on top. Gallery Creator
 * follows: a player whose looks are all private has none that others can see.
 */
export async function setLookPrivate(id: string, isPrivate: boolean) {
  if (typeof isPrivate !== "boolean") return said({ ok: false as const, error: "That look could not be changed." });
  const r = await repository.setOutfitPrivate(id, isPrivate);
  if (r.ok) {
    revalidateHub();
    revalidatePath(`/community-gallery/${id}`);
    revalidatePath("/loadouts");
    after(async () => {
      if (isPrivate) await recheckCreator(await creatorOf(id).catch(() => null));
      else await grantCreatorOfLook(id);
    });
  }
  return said(r);
}

export async function saveDisplayName(name: string) {
  const parsed = displayNameSchema.safeParse(name);
  if (!parsed.success) return said({ ok: false as const, error: parsed.error.issues[0].message });
  const r = await repository.setDisplayName(parsed.data);
  // Published looks show this name.
  if (r.ok) revalidateHub();
  return said(r);
}

export async function sendLookToGame(id: string) {
  const post = await repository.getOutfit(id);
  if (!post) return said({ ok: false as const, error: "That look is gone." });
  // A look published before CODE_MAX may be an old code carrying a picture. A set holds the look alone.
  if (post.code.length > CODE_MAX) {
    return said({ ok: false as const, error: "This look is too large to send. Copy its code instead." });
  }
  const r = await repository.sendToGame(post.title, post.code);
  if (r.ok) revalidatePath("/loadouts");
  return said(r);
}

export async function createGameLinkCode() {
  return said(repository.newGameLinkCode());
}

export async function unlinkGame(id: string) {
  const r = await repository.unlinkGame(id);
  if (r.ok) revalidatePath("/loadouts");
  return said(r);
}

export async function removeGameSet(id: string) {
  const r = await repository.removeGameSet(id);
  if (r.ok) revalidatePath("/loadouts");
  return said(r);
}

/** One of the game's pictures taken off a set, from the set's publish form. */
export async function removeSetPicture(setId: string, path: string) {
  if (!UPLOAD_PATH.test(path)) return said({ ok: false as const, error: "That is not one of the set's pictures." });
  const r = await repository.removeSetPicture(setId, path);
  if (r.ok) revalidatePath(`/sets/${setId}`);
  return said(r);
}

/**
 * Sets the visitor's vote on a look, on or off. A second click takes the vote back.
 * Nothing is revalidated: a revalidating action re-renders the page it was called from,
 * and a Trending or Top list would reshuffle under the visitor's cursor. The button shows
 * the new count itself, and every page reads the session cookie, so each load is fresh
 * and the new order shows on the next one.
 */
export async function voteOutfit(id: string, up: boolean) {
  return said(repository.vote(id, up === true));
}

/** Which of the looks on a page the visitor voted for, so their buttons show it. */
export async function votedLooks(ids: string[]) {
  if (!Array.isArray(ids)) return [];
  return repository.votedOn(ids.filter((id) => typeof id === "string").slice(0, 100));
}

/**
 * A visitor copied a look's code. Counted once per visitor, who is read from the request's
 * own headers, never from anything sent with it. Never an error: copying already worked.
 */
export async function copiedLook(id: string) {
  if (!z.uuid().safeParse(id).success || !adminConfigured()) return;
  const visitor = visitorOf(await headers());
  if (!visitor) return;
  // A fresh count shows at the page's next render; no page is rebuilt for one copy.
  after(() => recordCopy(id, visitor).catch((e: unknown) => console.error("copiedLook", e)));
}

export async function reportLook(id: string, reason: string) {
  if (!Object.hasOwn(REPORT_REASONS, reason)) return said({ ok: false as const, error: "Choose a reason first." });
  const r = await repository.report(id, reason as ReportReason);
  if (r.ok) revalidatePath("/moderation");
  // Moderators hear about each person's first report, after the reporter has their answer.
  if (r.ok && r.value) after(() => alertModerators(id, reason as ReportReason));
  return said(r);
}

export async function bookmarkLook(id: string, saved: boolean) {
  const r = await repository.setBookmark(id, saved);
  if (r.ok) revalidatePath("/community-gallery");
  return said(r);
}

/** A look's unread reports, for a moderator looking at it. Null for anyone else. */
export async function openReportsFor(id: string) {
  const account = await repository.getAccount();
  if (!account?.moderator) return null;
  return (await repository.listReports()).find((r) => r.id === id) ?? null;
}

export async function dismissLookReports(id: string) {
  const r = await repository.dismissReports(id);
  if (r.ok) revalidatePath("/moderation");
  return said(r);
}

export async function postComment(outfitId: string, body: string) {
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return said({ ok: false as const, error: parsed.error.issues[0].message });
  const r = await repository.addComment(outfitId, parsed.data);
  if (r.ok) revalidatePath(`/community-gallery/${outfitId}`);
  return said(r);
}

export async function removeComment(id: string, outfitId: string) {
  const r = await repository.deleteComment(id);
  if (r.ok) {
    revalidatePath(`/community-gallery/${outfitId}`);
    revalidatePath("/moderation");
  }
  return said(r);
}

export async function reportComment(id: string, reason: string) {
  if (!Object.hasOwn(COMMENT_REPORT_REASONS, reason)) return said({ ok: false as const, error: "Choose a reason first." });
  const r = await repository.reportComment(id, reason as CommentReportReason);
  if (r.ok) revalidatePath("/moderation");
  if (r.ok && r.value) after(() => alertCommentReport(id, reason as CommentReportReason));
  return said(r);
}

export async function dismissCommentReports(id: string) {
  const r = await repository.dismissCommentReports(id);
  if (r.ok) revalidatePath("/moderation");
  return said(r);
}
