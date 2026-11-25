import "server-only";
import { repository } from "@/lib/data";
import {
  COMMENT_REPORT_REASONS, REPORT_REASONS, type CommentReportReason, type ReportReason,
} from "@/lib/data/types";
import type { Reported } from "@/lib/data/admin";
import { AMBER, NO_MENTIONS, plain, postWebhook, type Embed } from "@/lib/discord";
import { bot, botConfigured, isSnowflake } from "@/lib/discord-bot";
import { siteUrl } from "@/lib/site";

/**
 * The buttons a report alert carries. src/app/api/discord/interactions/moderate.ts
 * answers them, and only for a site moderator.
 */
export function reportButtons(kind: Reported, id: string) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: kind === "look" ? "Keep look" : "Keep comment", custom_id: `mod:keep:${kind}:${id}` },
      { type: 2, style: 4, label: "Delete…", custom_id: `mod:ask:${kind}:${id}` },
      { type: 2, style: 5, label: "Open moderation", url: `${siteUrl}/moderation` },
    ],
  }];
}

let modChannel: { hook: string; id: string } | null = null;

/** The webhook's channel, which Discord tells anyone holding the webhook's address. */
async function channelOf(hook: string): Promise<string | null> {
  if (modChannel?.hook === hook) return modChannel.id;
  const res = await fetch(hook).catch(() => null);
  if (!res?.ok) return null;
  const { channel_id: id } = (await res.json()) as { channel_id?: string };
  if (!id || !isSnowflake(id)) return null;
  modChannel = { hook, id };
  return id;
}

/**
 * Only a message the bot posts can carry buttons that answer, so the bot posts the alert
 * in the webhook's channel. When it cannot post there, the webhook posts it without them.
 */
async function postAlert(hook: string, embed: Embed, kind: Reported, id: string) {
  const channel = botConfigured() ? await channelOf(hook) : null;
  if (channel) {
    const res = await bot(`/channels/${channel}/messages`, {
      method: "POST",
      body: JSON.stringify({ allowed_mentions: NO_MENTIONS, embeds: [embed], components: reportButtons(kind, id) }),
    });
    if (res.ok) return;
    console.error("The bot could not post a report alert, so it went without buttons:", res.status, await res.text());
  }
  await postWebhook(hook, [embed]);
}

// Tells the moderators' Discord channel (DISCORD_MOD_WEBHOOK_URL) that a look was
// reported. Only a person's first report of a look gets here. It names the look and
// the reason, never who reported it: that stays on the site, for moderators.
export async function alertModerators(id: string, reason: ReportReason) {
  const hook = process.env.DISCORD_MOD_WEBHOOK_URL;
  if (!hook) return;
  const post = await repository.getOutfit(id);
  if (!post) return;

  const url = `${siteUrl}/community-gallery/${post.id}`;
  const by = post.author ? ` by ${plain(post.author)}` : "";
  await postAlert(hook, {
    // Shown as typed, as the weekly post shows it. Mentions are off, so nothing pings.
    title: `Reported: ${post.title}`.slice(0, 256),
    url,
    description: `A look${by} was reported for **${REPORT_REASONS[reason]}**.\n[Review it in moderation](${siteUrl}/moderation)`,
    color: AMBER,
    ...(post.gallery.length ? { thumbnail: { url: `${url}/cover` } } : {}),
    footer: { text: "Report" },
  }, "look", post.id);
}

// The same channel, for a comment. The comment is quoted as typed, so moderators can
// judge it from Discord; mentions stay off, so nothing in it pings anyone.
export async function alertCommentReport(id: string, reason: CommentReportReason) {
  const hook = process.env.DISCORD_MOD_WEBHOOK_URL;
  if (!hook) return;
  const comment = await repository.getComment(id);
  if (!comment) return;
  const post = await repository.getOutfit(comment.outfitId);
  if (!post) return;

  const by = comment.author ? ` by ${plain(comment.author)}` : "";
  const quote = plain(comment.body.slice(0, 1000)).replace(/^/gm, "> ");
  await postAlert(hook, {
    title: `Reported comment on ${post.title}`.slice(0, 256),
    url: `${siteUrl}/community-gallery/${post.id}#comment-${comment.id}`,
    description:
      `A comment${by} was reported for **${COMMENT_REPORT_REASONS[reason]}**.\n${quote}\n` +
      `[Review it in moderation](${siteUrl}/moderation)`,
    color: AMBER,
    footer: { text: "Report" },
  }, "comment", comment.id);
}
