import "server-only";
import { findWearable, wearableItem, type WearableItem } from "@/lib/catalog";
import { AMBER, NO_MENTIONS, plain } from "@/lib/discord";
import { SLOT_NAMES } from "@/lib/domain";
import { siteUrl } from "@/lib/site";
import { QUALITY_NAME, iconSources, qualityColour } from "@/lib/wow-assets";
import { term } from "@/i18n/terms";
import { say, type Reply } from "./reply";
import type { T } from "./t";

// /item: whether a piece is in Eclipse, and how to find it there. The overlay's wardrobe
// labels some pieces by their model file until the server names them, but its search
// also matches an item's id (Appearances.cpp), so the id is the answer that always works.
// Everything here is read from the catalogue: no database, no pack host.

/** Inventory types that name a hand better than the slot they first fit. */
const HANDS: Record<number, string> = { 13: "One-Hand", 17: "Two-Hand" };
const slotLabel = (item: WearableItem, t: T) => term(t, "slot", HANDS[item.invType] ?? SLOT_NAMES[item.slot]);

const CHOICES = 25;
const MAX_CHOICE = 100;
/** How many of a typed name's matches a reply lists. */
const LISTED = 10;
/** Enough matches to spot an exact name among names that only contain it. */
const SCAN = 500;

/** /item's suggestions: the piece's name, slot and id shown, its id sent. */
export function suggestItems(typed: string, t: T): { name: string; value: string }[] {
  return findWearable(typed, CHOICES).map((item) => {
    const tail = ` · ${slotLabel(item, t)} · ${item.id}`;
    const room = MAX_CHOICE - tail.length;
    const name = item.name.length > room ? `${item.name.slice(0, room - 1)}…` : item.name;
    return { name: name + tail, value: String(item.id) };
  });
}

function itemReply(item: WearableItem, t: T): Reply {
  const lines = [
    `**${t("bot.item.slot")}** · ${slotLabel(item, t)}`,
    item.quality != null ? `**${t("bot.item.quality")}** · ${term(t, "quality", QUALITY_NAME[item.quality])}` : null,
    `**${t("bot.item.inEclipse")}** · ${t("bot.item.searchFor", { id: item.id })}`,
  ].filter(Boolean);
  return {
    embeds: [{
      title: item.name.slice(0, 256),
      description: lines.join("\n"),
      color: item.quality != null ? parseInt(qualityColour(item.quality).slice(1), 16) : AMBER,
      thumbnail: { url: `${siteUrl}${iconSources(item.icon, item.slot)[0]}` },
      footer: { text: t("bot.wearIt") },
    }],
    allowed_mentions: NO_MENTIONS,
  };
}

export function itemAnswer(text: string, t: T): Reply {
  const typed = text.trim();
  if (!typed) return say(t("bot.item.empty"));
  if (/^\d{1,10}$/.test(typed)) {
    const item = wearableItem(Number(typed));
    return item ? itemReply(item, t) : say(t("bot.item.noId", { id: typed }));
  }
  const hits = findWearable(typed, SCAN);
  const exact = hits.filter((h) => h.name.toLowerCase() === typed.toLowerCase());
  if (exact.length === 1) return itemReply(exact[0], t);
  if (hits.length === 1) return itemReply(hits[0], t);
  if (!hits.length) return say(t("bot.item.noName", { name: typed.slice(0, 100) }));
  const shown = exact.length > 1 ? exact : hits;
  const lines = shown.slice(0, LISTED).map((h) => `${plain(h.name)} · ${slotLabel(h, t)} · \`${h.id}\``);
  const more = shown.length <= LISTED
    ? ""
    : `\n${shown.length >= SCAN ? t("bot.item.many") : t("bot.item.more", { count: shown.length - LISTED })}`;
  return {
    embeds: [{
      title: t("bot.item.matching", { name: typed.slice(0, 100) }),
      description: `${lines.join("\n")}${more}\n\n${t("bot.item.howTo")}`,
      color: AMBER,
    }],
    allowed_mentions: NO_MENTIONS,
  };
}
