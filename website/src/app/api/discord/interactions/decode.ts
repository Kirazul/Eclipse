import "server-only";
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { AMBER, NO_MENTIONS, plain } from "@/lib/discord";
import { siteUrl } from "@/lib/site";
import { term } from "@/i18n/terms";
import { EPHEMERAL, say, type Reply } from "./reply";
import type { T } from "./t";

// /decode and "Decode Eclipse code": what a code wears, read by name from the catalogue,
// as the Loadouts page shows it. Nothing is drawn, so nothing is read from the pack host.

/** Discord refuses a link button's address past this. */
const MAX_LINK = 512;
const MAX_DESCRIPTION = 4000;

export function decodeReply(text: string, { quiet, t }: { quiet: boolean; t: T }): Reply {
  const decoded = decodeOutfit(text);
  if (!decoded.ok) return say(decoded.error);
  const r = resolveOutfit(decoded.outfit);

  const display = (id: number) => t("bot.decode.display", { id });
  const lines: string[] = [];
  const race = r.raceKey ? term(t, "race", r.raceKey, r.race ?? r.raceKey) : r.race;
  if (race) lines.push(`**${t("bot.decode.race")}** · ${race}${r.sex ? `, ${term(t, "sex", r.sex)}` : ""}`);
  if (r.morph) lines.push(`**${t("bot.decode.morph")}** · ${r.morphName ? plain(r.morphName) : display(r.morph)}`);
  for (const s of r.slots) {
    const worn = s.item === 0 ? t("bot.decode.hidden") : s.name ? plain(s.name) : t("bot.decode.item", { id: s.item });
    lines.push(`**${term(t, "slot", s.label)}** · ${worn}`);
  }
  for (const g of r.glows) {
    const enchant = t("bot.decode.enchant", { hand: term(t, "slot", g.hand) });
    lines.push(`**${enchant}** · ${g.name ? plain(g.name) : t("bot.decode.enchantId", { id: g.id })}`);
  }
  if (r.mount) lines.push(`**${t("bot.decode.mount")}** · ${r.mount.name ? plain(r.mount.name) : display(r.mount.id)}`);
  if (r.mountFly) {
    lines.push(`**${t("bot.decode.flyingMount")}** · ${r.mountFly.name ? plain(r.mountFly.name) : display(r.mountFly.id)}`);
  }
  const extras = [
    r.scale ? t("bot.decode.scale", { scale: r.scale }) : null,
    r.colours.length ? t("bot.decode.colours", { count: r.colours.length }) : null,
    r.tints ? t("bot.decode.tints", { count: r.tints }) : null,
    r.cosmetics ? t("bot.decode.cosmetics", { count: r.cosmetics }) : null,
  ].filter(Boolean);
  if (extras.length) lines.push(`**${t("bot.decode.also")}** · ${extras.join(", ")}`);

  let description = lines.join("\n") || t("bot.decode.nothing");
  if (description.length > MAX_DESCRIPTION) description = `${description.slice(0, MAX_DESCRIPTION)}…`;
  const open = `${siteUrl}/loadouts?code=${encodeURIComponent(text.trim())}`;
  return {
    embeds: [{ title: t("bot.decode.title"), description, color: AMBER, footer: { text: t("bot.wearIt") } }],
    ...(open.length <= MAX_LINK
      ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: t("bot.decode.open"), url: open }] }] }
      : {}),
    ...(quiet ? { flags: EPHEMERAL } : {}),
    allowed_mentions: NO_MENTIONS,
  };
}
