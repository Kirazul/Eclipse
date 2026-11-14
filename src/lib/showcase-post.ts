import "server-only";
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { RACE_LABEL } from "@/lib/domain";

// How a post in the Discord showcase becomes a Wardrobe look. Shared by the bulk
// import (tools/import-discord-showcase.mts) and the bot's "Add to Community Gallery" right-click,
// so both read a post the same way.

/** The community server's #showcase channel. */
export const SHOWCASE_CHANNEL = "1554574140634046586";
export const MAX_SCREENSHOTS = 6;

export interface ShowcaseAttachment { url: string; content_type?: string }
export interface ShowcaseMessage {
  id: string;
  channel_id?: string;
  timestamp: string;
  content: string;
  author: { id: string; username: string; global_name: string | null; bot?: boolean };
  attachments: ShowcaseAttachment[];
  message_reference?: { message_id?: string };
}

const CODE = /ECA1:[A-Za-z0-9+/=]+/;

/** The message's code, whitespace and all removed: Discord wraps long ones. */
export const codeIn = (content: string) => content.replace(/\s+/g, "").match(CODE)?.[0] ?? null;

export const images = (m: ShowcaseMessage) => m.attachments.filter((a) => a.content_type?.startsWith("image/"));

/** What the player wrote, without the code, mentions or custom emoji. */
export function said(m: ShowcaseMessage): string {
  return m.content
    .replace(/ECA1:\S+/g, "")
    .replace(/<a?:\w+:\d+>|<[@#][!&]?\d+>/g, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\r]/g, "")
    .trim();
}

const HOUR = 60 * 60 * 1000;

/**
 * The code's own pictures, or the player's picture the code was asked for: through the
 * replies, or when someone asked without replying, the player's last picture in the
 * hour before the code.
 */
export function pictureFor(code: ShowcaseMessage, byId: Map<string, ShowcaseMessage>, messages: ShowcaseMessage[]): ShowcaseMessage | null {
  if (images(code).length) return code;
  for (let ref = code.message_reference?.message_id, hops = 0; ref && hops < 4; hops++) {
    const m = byId.get(ref);
    if (!m) break;
    if (m.author.id === code.author.id && images(m).length) return m;
    ref = m.message_reference?.message_id;
  }
  const at = Date.parse(code.timestamp);
  return messages.findLast((m) =>
    m.author.id === code.author.id && images(m).length > 0 && Date.parse(m.timestamp) <= at && at - Date.parse(m.timestamp) < HOUR,
  ) ?? null;
}

/** "Blood Elf transmog" from the code itself: a Discord post has no title. */
export function titleOf(race: string | null, caption: string): string {
  if (caption.length >= 3 && caption.length <= 40 && !/[.!?,]/.test(caption)) return caption;
  return race ? `${RACE_LABEL[race]} transmog` : "Transmog";
}

/** As the publish action adds them: the Wardrobe's Mounts and Enchants filters, read from the code. */
function codeTags(outfit: { mount: number; mountFly: number; glow: unknown[] }): string[] {
  return [...(outfit.mount || outfit.mountFly ? ["mount"] : []), ...(outfit.glow.some(Boolean) ? ["enchant"] : [])];
}

export interface ShowcaseLook {
  messageId: string;
  discordId: string;
  name: string;
  title: string;
  description: string | null;
  code: string;
  race: string | null;
  tags: string[];
  createdAt: string;
  /** The Discord addresses of its screenshots, to download. */
  pictures: string[];
}

/** The look a code message makes, or why it makes none. */
export function showcaseLook(
  m: ShowcaseMessage, byId: Map<string, ShowcaseMessage>, messages: ShowcaseMessage[],
): { ok: true; look: ShowcaseLook } | { ok: false; reason: string } {
  const code = codeIn(m.content);
  if (!code || m.author.bot) return { ok: false, reason: "it holds no Eclipse code" };
  const decoded = decodeOutfit(code);
  if (!decoded.ok) return { ok: false, reason: `the code does not decode (${decoded.error})` };
  const picture = pictureFor(m, byId, messages);
  if (!picture) return { ok: false, reason: "it has no screenshot of the player's own" };
  const caption = [said(picture), picture === m ? "" : said(m)].filter(Boolean).join("\n").slice(0, 500).trim();
  const race = resolveOutfit(decoded.outfit).raceKey;
  const title = titleOf(race, caption);
  return {
    ok: true,
    look: {
      messageId: m.id,
      discordId: m.author.id,
      name: (m.author.global_name ?? m.author.username).slice(0, 40),
      title,
      description: caption && caption !== title ? caption : null,
      code,
      race: race && RACE_LABEL[race] ? race : null,
      tags: codeTags(decoded.outfit),
      createdAt: picture.timestamp,
      pictures: images(picture).slice(0, MAX_SCREENSHOTS).map((a) => a.url),
    },
  };
}
