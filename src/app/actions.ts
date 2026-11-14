"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { resolveOutfit, resolveWorld, type ResolvedOutfit, type ResolvedWorldPlace } from "@/lib/catalog";
import { decodeOutfit, OUTFIT_TAG, type Outfit } from "@/lib/codec/outfit";
import {
  displayNameSchema, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES, submitOutfitSchema, type SubmitOutfit,
} from "@/lib/codec/schema";
import { decodeWorld, OUTFIT_WORLD_TAG } from "@/lib/codec/world";
import { repository } from "@/lib/data";
import {
  COMMENT_REPORT_REASONS, REPORT_REASONS, type CommentReportReason, type ReportReason,
} from "@/lib/data/types";
import { commentSchema } from "@/lib/comments";
import { creatorOf, grantCreatorOfLook, recheckCreator } from "@/lib/discord-roles";
import { announceLook } from "@/lib/look-feed";
import { alertCommentReport, alertModerators } from "@/lib/moderation-alert";
import { UPLOAD_PATH } from "@/lib/screenshots";

export type InspectResult =
  | { kind: "outfit"; outfit: Outfit; resolved: ResolvedOutfit; warnings: string[] }
  | { kind: "world"; places: ResolvedWorldPlace[] }
  | { kind: "error"; error: string };

/** What a pasted code holds, with the names the code itself does not carry. */
export async function inspectCode(text: string): Promise<InspectResult> {
  const head = text.trimStart().slice(0, 5).toUpperCase();
  if (head === OUTFIT_WORLD_TAG) {
    const r = decodeWorld(text);
    return r.ok ? { kind: "world", places: resolveWorld(r.places) } : { kind: "error", error: r.error };
  }
  const r = decodeOutfit(text);
  if (!r.ok) {
    return {
      kind: "error",
      error: head === OUTFIT_TAG || !text.trim() ? r.error : "That is not an Eclipse code. Codes start with ECA1: or ECW1:.",
    };
  }
  return { kind: "outfit", outfit: r.outfit, resolved: resolveOutfit(r.outfit), warnings: r.warnings };
}

export async function publishOutfit(
  input: SubmitOutfit,
): Promise<{ ok: true; id: string } | { ok: false; error: string; existing?: string }> {
  const parsed = submitOutfitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const r = await repository.createOutfit({ ...parsed.data, tags: withCodeTags(parsed.data) });
  if (!r.ok) return r;
  revalidateHub();
  const post = r.value;
  after(() => announceLook(post));
  after(() => grantCreatorOfLook(post.id));
  return { ok: true, id: post.id };
}

/** The Wardrobe's Mounts and Enchants filters, read from the code and not typed. */
function withCodeTags({ code, tags }: { code: string; tags: string[] }): string[] {
  const decoded = decodeOutfit(code);
  if (!decoded.ok) return tags;
  const { mount, mountFly, glow } = decoded.outfit;
  const found = [...(mount || mountFly ? ["mount"] : []), ...(glow.some(Boolean) ? ["enchant"] : [])];
  return [...new Set([...found, ...tags])].slice(0, 6);
}

function revalidateHub() {
  revalidatePath("/community-gallery");
  revalidatePath("/");
}

export async function uploadScreenshot(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "Choose a screenshot first." };
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false as const, error: "Screenshots can be PNG, JPEG or WebP." };
  }
  if (file.size > MAX_SCREENSHOT_BYTES) return { ok: false as const, error: "Keep each screenshot under 4 MB." };
  return repository.uploadScreenshot(file);
}

/** A screenshot taken back off the form before publishing. Its slot is freed too. */
export async function removeScreenshot(path: string) {
  if (!UPLOAD_PATH.test(path)) return { ok: false as const, error: "That is not an uploaded screenshot." };
  return repository.removeScreenshot(path);
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
  return r;
}

/**
 * The author's own look out of the Community Gallery, or back in. It keeps its date and
 * votes, so a look shown again stands where it stood, not on top. Gallery Creator
 * follows: a player whose looks are all private has none that others can see.
 */
export async function setLookPrivate(id: string, isPrivate: boolean) {
  if (typeof isPrivate !== "boolean") return { ok: false as const, error: "That look could not be changed." };
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
  return r;
}

export async function saveDisplayName(name: string) {
  const parsed = displayNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const r = await repository.setDisplayName(parsed.data);
  // Published looks show this name.
  if (r.ok) revalidateHub();
  return r;
}

// A published code may be an old one, carrying a picture. A set holds the look alone.
const MAX_SET_CODE = 32768;

export async function sendLookToGame(id: string) {
  const post = await repository.getOutfit(id);
  if (!post) return { ok: false as const, error: "That look is gone." };
  if (post.code.length > MAX_SET_CODE) {
    return { ok: false as const, error: "This look is too large to send. Copy its code instead." };
  }
  const r = await repository.sendToGame(post.title, post.code);
  if (r.ok) revalidatePath("/loadouts");
  return r;
}

export async function createGameLinkCode() {
  return repository.newGameLinkCode();
}

export async function unlinkGame(id: string) {
  const r = await repository.unlinkGame(id);
  if (r.ok) revalidatePath("/loadouts");
  return r;
}

export async function removeGameSet(id: string) {
  const r = await repository.removeGameSet(id);
  if (r.ok) revalidatePath("/loadouts");
  return r;
}

/** One of the game's pictures taken off a set, from the set's publish form. */
export async function removeSetPicture(setId: string, path: string) {
  if (!UPLOAD_PATH.test(path)) return { ok: false as const, error: "That is not one of the set's pictures." };
  const r = await repository.removeSetPicture(setId, path);
  if (r.ok) revalidatePath(`/sets/${setId}`);
  return r;
}

export async function upvoteOutfit(id: string) {
  const r = await repository.upvote(id);
  if (r.ok) revalidateHub();
  return r;
}

export async function reportLook(id: string, reason: string) {
  if (!Object.hasOwn(REPORT_REASONS, reason)) return { ok: false as const, error: "Choose a reason first." };
  const r = await repository.report(id, reason as ReportReason);
  if (r.ok) revalidatePath("/moderation");
  // Moderators hear about each person's first report, after the reporter has their answer.
  if (r.ok && r.value) after(() => alertModerators(id, reason as ReportReason));
  return r;
}

export async function bookmarkLook(id: string, saved: boolean) {
  const r = await repository.setBookmark(id, saved);
  if (r.ok) revalidatePath("/community-gallery");
  return r;
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
  return r;
}

export async function postComment(outfitId: string, body: string) {
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const r = await repository.addComment(outfitId, parsed.data);
  if (r.ok) revalidatePath(`/community-gallery/${outfitId}`);
  return r;
}

export async function removeComment(id: string, outfitId: string) {
  const r = await repository.deleteComment(id);
  if (r.ok) {
    revalidatePath(`/community-gallery/${outfitId}`);
    revalidatePath("/moderation");
  }
  return r;
}

export async function reportComment(id: string, reason: string) {
  if (!Object.hasOwn(COMMENT_REPORT_REASONS, reason)) return { ok: false as const, error: "Choose a reason first." };
  const r = await repository.reportComment(id, reason as CommentReportReason);
  if (r.ok) revalidatePath("/moderation");
  if (r.ok && r.value) after(() => alertCommentReport(id, reason as CommentReportReason));
  return r;
}

export async function dismissCommentReports(id: string) {
  const r = await repository.dismissCommentReports(id);
  if (r.ok) revalidatePath("/moderation");
  return r;
}
