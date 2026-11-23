import "server-only";
import { adminConfigured, lookOfMessage } from "@/lib/data/admin";
import { botConfigured, messagesBefore } from "@/lib/discord-bot";
import { SHOWCASE_CHANNEL, codeIn, images, showcaseLook } from "@/lib/showcase-post";
import { siteUrl } from "@/lib/site";
import { say, type Interaction, type Reply } from "./reply";
import { addShowcaseLook, moderates } from "./showcase-look";
import { translator, type T } from "./t";

// "Add to Community Gallery" on a #showcase post's right-click menu: what
// tools/import-discord-showcase.mts does for the whole channel, for one post, at once.
// Its player, or a moderator, can add it; the look is credited to the player either way.

// The post itself, or the same code published on the site or from another post: the
// database answers one public look per code with the look already there.
export async function addToWardrobe(interaction: Interaction, t: T = translator(interaction.locale)): Promise<Reply> {
  const already = (look: string) => say(t("bot.add.already", { url: `${siteUrl}/community-gallery/${look}` }));
  if (!adminConfigured() || !botConfigured()) return say(t("bot.add.off"));
  const data = interaction.data;
  const target = data?.target_id ? data.resolved?.messages?.[data.target_id] : undefined;
  if (!target) return say(t("bot.add.noPost"));
  if ((interaction.channel_id ?? target.channel_id) !== SHOWCASE_CHANNEL) {
    return say(t("bot.add.wrongChannel", { channel: `<#${SHOWCASE_CHANNEL}>` }));
  }
  if (interaction.member?.user.id !== target.author.id && !moderates(interaction.member?.permissions)) {
    return say(t("bot.add.notYours"));
  }
  if (!codeIn(target.content)) return say(t("bot.add.noCode"));
  const existing = await lookOfMessage(target.id);
  if (existing) return already(existing);

  // The picture may be an earlier post the code answers, so read what came before.
  const history = images(target).length ? [] : await messagesBefore(SHOWCASE_CHANNEL, target.id);
  const made = showcaseLook(target, new Map([...history, target].map((m) => [m.id, m])), history);
  if (!made.ok) return say(t("bot.add.cannot", { reason: made.reason }));

  const added = await addShowcaseLook(made.look);
  if (added.status === "badShot") return say(t("bot.add.badShot"));
  if (added.status === "already") return already(added.id);
  return say(t("bot.add.added", { url: `${siteUrl}/community-gallery/${added.id}` }));
}
