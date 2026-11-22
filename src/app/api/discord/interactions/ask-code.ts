import "server-only";
import { adminConfigured, askCode, lookOfMessage, unaskCode } from "@/lib/data/admin";
import { NO_MENTIONS, codeBlock, plain } from "@/lib/discord";
import { botConfigured, messageOf, messagesAfter, replyTo } from "@/lib/discord-bot";
import { SHOWCASE_CHANNEL, codeAfter, codeIn, images, lookWithCode, type ShowcaseMessage } from "@/lib/showcase-post";
import { siteUrl } from "@/lib/site";
import { EPHEMERAL, FORM, MESSAGE, UPDATE, say, type ClickAnswer, type Form, type Interaction, type Reply } from "./reply";
import { addShowcaseLook, moderates } from "./showcase-look";
import { translator, type T } from "./t";

// "Ask for the code" on a #showcase picture that came without one. The bot replies under the
// post, which tells its player, with a button only they (or a moderator) can use. It opens a
// form for the code, and sending it adds the look to the Community Gallery with the post's
// screenshots and puts the code where it was asked for. A person starts it every time.

const ADD = /^code:add:([0-9]{17,20}):([0-9]{17,20})$/;
const SAVE = /^code:save:([0-9]{17,20}):([0-9]{17,20})$/;

/** Discord's limits: a whole code, as the overlay writes one, is about a thousand letters. */
const MAX_CODE = 4000;
const MIN_TITLE = 3;
const MAX_TITLE = 80;

const LABEL = 18;
const TEXT = 4;
const SHORT = 1;
const PARAGRAPH = 2;

export const opensCodeForm = (customId: string) => customId.startsWith("code:add:");
export const isCodeForm = (customId: string) => customId.startsWith("code:save:");

const lookUrl = (id: string) => `${siteUrl}/community-gallery/${id}`;
const messageUrl = (guild: string | undefined, id: string) => `https://discord.com/channels/${guild ?? "@me"}/${SHOWCASE_CHANNEL}/${id}`;
const nameOf = (user: { id: string; username?: string; global_name?: string | null }) => plain(user.global_name || user.username || user.id);

const addButton = (post: ShowcaseMessage, t: T) =>
  [{ type: 1, components: [{ type: 2, style: 1, label: t("bot.ask.add"), custom_id: `code:add:${post.id}:${post.author.id}` }] }];

/** Only the player who posted a look has its code; a moderator may enter one they were given. */
const mayAdd = (interaction: Interaction, player: string) =>
  interaction.member?.user.id === player || moderates(interaction.member?.permissions);

export async function askForCode(interaction: Interaction, t: T = translator(interaction.locale)): Promise<Reply> {
  if (!adminConfigured() || !botConfigured()) return say(t("bot.ask.off"));
  const data = interaction.data;
  const post = data?.target_id ? data.resolved?.messages?.[data.target_id] : undefined;
  const asker = interaction.member?.user;
  if (!post || !asker) return say(t("bot.add.noPost"));
  if ((interaction.channel_id ?? post.channel_id) !== SHOWCASE_CHANNEL) {
    return say(t("bot.ask.wrongChannel", { channel: `<#${SHOWCASE_CHANNEL}>` }));
  }
  if (post.author.bot || !images(post).length) return say(t("bot.ask.noPicture"));

  // Nobody is asked for a code that is already there.
  const given = codeIn(post.content) ? post : codeAfter(post, await messagesAfter(SHOWCASE_CHANNEL, post.id));
  if (given) return say(t("bot.ask.given", { url: messageUrl(interaction.guild_id, given.id) }));
  const existing = await lookOfMessage(post.id);
  if (existing) return say(t("bot.add.already", { url: lookUrl(existing) }));

  if (asker.id === post.author.id) return { ...say(t("bot.ask.own")), components: addButton(post, t) };

  const turn = await askCode(post.id, asker.id);
  if (turn !== "ok") return say(t(turn === "slow" ? "bot.ask.slow" : "bot.ask.already"));
  // Everyone in the channel reads the request, so it is in the server's language.
  const inServer = translator(interaction.guild_locale);
  const sent = await replyTo(SHOWCASE_CHANNEL, post.id, {
    content: inServer("bot.ask.request", { name: nameOf(asker) }),
    components: addButton(post, inServer),
  });
  if (!sent) {
    await unaskCode(post.id);
    return say(t("bot.ask.cannotPost"));
  }
  return say(t("bot.ask.done", { name: nameOf(post.author) }));
}

/** The button's answer. It must be the click's first, so nothing here waits on anything. */
export function codeForm(interaction: Interaction): { type: typeof FORM; data: Form } | ClickAnswer {
  const t = translator(interaction.locale);
  const button = ADD.exec(interaction.data?.custom_id ?? "");
  if (!button) return { type: MESSAGE, data: say(t("bot.gone")) };
  const [, post, player] = button;
  if (!mayAdd(interaction, player)) return { type: MESSAGE, data: say(t("bot.ask.notYours")) };
  return {
    type: FORM,
    data: {
      custom_id: `code:save:${post}:${player}`,
      title: t("bot.ask.formTitle"),
      components: [
        {
          type: LABEL, label: t("bot.ask.codeLabel"), description: t("bot.ask.codeHint"),
          component: { type: TEXT, custom_id: "code", style: PARAGRAPH, min_length: 6, max_length: MAX_CODE, placeholder: "ECA1:", required: true },
        },
        {
          type: LABEL, label: t("bot.ask.titleLabel"), description: t("bot.ask.titleHint"),
          component: { type: TEXT, custom_id: "title", style: SHORT, max_length: MAX_TITLE, required: false },
        },
      ],
    },
  };
}

const field = (interaction: Interaction, id: string) =>
  interaction.data?.components?.find((c) => c.component?.custom_id === id)?.component?.value ?? "";

/** The form, sent. The request becomes its answer; a refusal is the sender's alone. */
export async function saveCode(interaction: Interaction): Promise<ClickAnswer> {
  const t = translator(interaction.locale);
  const privately = (text: string): ClickAnswer => ({ type: MESSAGE, data: say(text) });
  const form = SAVE.exec(interaction.data?.custom_id ?? "");
  if (!form) return privately(t("bot.gone"));
  if (!adminConfigured() || !botConfigured()) return privately(t("bot.ask.off"));
  const [, postId, player] = form;
  if (!mayAdd(interaction, player)) return privately(t("bot.ask.notYours"));
  const title = field(interaction, "title").trim().slice(0, MAX_TITLE);
  if (title && title.length < MIN_TITLE) return privately(t("bot.ask.shortTitle"));

  // The post itself says whose it is and what it shows, as it is now.
  const post = await messageOf(SHOWCASE_CHANNEL, postId);
  if (!post || post.author.id !== player) return privately(t("bot.ask.postGone"));
  const made = lookWithCode(post, field(interaction, "code"), title || null, new Date().toISOString());
  if (!made.ok) return privately(t(made.why === "code" ? "bot.ask.badCode" : "bot.ask.noPicture"));

  const added = await addShowcaseLook(made.look);
  if (added.status === "badShot") return privately(t("bot.add.badShot"));

  // A request is for everyone; the button shown to the player alone is not.
  const alone = ((interaction.message?.flags ?? 0) & EPHEMERAL) !== 0;
  const tm = alone ? t : translator(interaction.guild_locale);
  const url = lookUrl(added.id);
  const text = added.status === "added"
    ? tm("bot.ask.added", { title: plain(made.look.title), url })
    : tm("bot.add.already", { url });
  return {
    type: UPDATE,
    data: {
      content: [text, codeBlock(made.look.code)].filter(Boolean).join("\n"),
      components: [{ type: 1, components: [{ type: 2, style: 5, label: tm("bot.look.open"), url }] }],
      allowed_mentions: NO_MENTIONS,
    },
  };
}
