import "server-only";
import { repository } from "@/lib/data";
import { adminConfigured, discordSendToGame, discordVote } from "@/lib/data/admin";
import { plain } from "@/lib/discord";
import { cleanSetName } from "@/lib/game-sync/wire";
import { siteUrl } from "@/lib/site";
import { MESSAGE, say, type ClickAnswer, type Interaction } from "./reply";
import { translator, type T } from "./t";

// Upvote and Send to game under the bot's look replies (/look). Each acts as the site
// account the clicking Discord account signed in with, through the same database rules
// as the site's own buttons (20261128120000_discord_look_buttons.sql). The answer is
// private to the person who clicked.

const BUTTON = /^look:(up|down|send):([0-9a-f-]{36})$/;

export const isLookButton = (customId: string) => customId.startsWith("look:");

const SECONDARY = 2;

/** The two buttons beside a look reply's link. */
export const lookButtons = (id: string, t: T) => [
  { type: 2, style: SECONDARY, label: t("bot.look.upvote"), custom_id: `look:up:${id}` },
  { type: 2, style: SECONDARY, label: t("bot.look.send"), custom_id: `look:send:${id}` },
];

const privately = (content: string, components?: unknown[]): ClickAnswer =>
  ({ type: MESSAGE, data: { ...say(content), ...(components ? { components } : {}) } });

export async function lookButton(interaction: Interaction): Promise<ClickAnswer> {
  const t = translator(interaction.locale);
  const click = BUTTON.exec(interaction.data?.custom_id ?? "");
  if (!click) return privately(t("bot.gone"));
  // Discord signs who clicked; in a server that is the member.
  const who = interaction.member?.user;
  if (!who || !adminConfigured()) return privately(t("bot.look.serverOnly"));
  const [, verb, id] = click;

  // Only what a visitor can see: a public look.
  const post = await repository.getOutfit(id);
  if (!post) return privately(t("bot.look.notFound"));
  const needAccount = t("bot.look.needAccount", { site: siteUrl });

  if (verb === "send") {
    const result = await discordSendToGame(who.id, cleanSetName(post.title), post.code);
    if (!result.account) return privately(needAccount);
    if (!result.sent) return privately(t("bot.look.full"));
    const name = plain(result.sent.name);
    return privately(result.sent.linked ? t("bot.look.sent", { name }) : t("bot.look.sentNoGame", { name }));
  }

  const up = verb === "up";
  const count = await discordVote(who.id, id, up);
  if (count === null) return privately(needAccount);
  if (!up) return privately(t("bot.look.unvoted", { count }));
  return privately(t("bot.look.upvoted", { count }), [
    { type: 1, components: [{ type: 2, style: SECONDARY, label: t("bot.look.undo"), custom_id: `look:down:${id}` }] },
  ]);
}
