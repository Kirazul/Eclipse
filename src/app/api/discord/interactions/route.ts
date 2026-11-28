import { after } from "next/server";
import { codeForm, isCodeForm, opensCodeForm, saveCode } from "./ask-code";
import { EPHEMERAL, answer, isQuiet, quickReply, suggest, timing, type Interaction, type Reply } from "./commands";
import { isLookButton, lookButton } from "./look-buttons";
import { isModeration, moderate, opensMessage } from "./moderate";
import { MESSAGE, type ClickAnswer } from "./reply";
import { translator } from "./t";
import { verifyDiscord } from "./verify";

// Discord's Interactions Endpoint URL for the Eclipse app. Discord POSTs each command,
// right-click and keystroke of an autocomplete here, signed with the app's key, and waits
// three seconds for an answer. An answer ready in time goes straight back. A slower one
// answers "thinking" at once, then edits that message.

const PING = 1;
const COMMAND = 2;
const CLICK = 3;
const AUTOCOMPLETE = 4;
const SUBMIT = 5;
const PONG = 1;
const DEFERRED = 5;
const DEFERRED_UPDATE = 6;
const CHOICES = 8;

const EDIT_TRIES = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Edits the "thinking" message into the answer. Flags cannot change on an edit. An edit
 * can reach Discord before the thinking message exists, which it calls an unknown
 * webhook (404), so a 404 is tried again a few times.
 */
async function finish(interaction: Interaction, reply: Reply) {
  const message: Reply = { ...reply };
  delete message.flags;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) },
    );
    if (res.ok) return;
    if (res.status !== 404 || attempt >= EDIT_TRIES) {
      console.error("Discord refused a command answer:", res.status, await res.text());
      return;
    }
    await sleep(timing.retryMs * attempt);
  }
}

/** The answer when something broke, in the asker's language. */
const failed = (interaction: Interaction): Reply =>
  ({ content: translator(interaction.locale)("bot.failed"), allowed_mentions: { parse: [] } });

/** A private message after the fact, for a slow click whose answer is not a change to its message. */
async function followUp(interaction: Interaction, reply: Reply) {
  const res = await fetch(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...reply, flags: EPHEMERAL }),
  });
  if (!res.ok) console.error("Discord refused a click's answer:", res.status, await res.text());
}

/** A clicked button, or a form it opened. Same three seconds, same "thinking" when slower. */
async function click(interaction: Interaction): Promise<Response> {
  const id = interaction.data?.custom_id ?? "";
  // A form is only ever a click's first answer.
  if (interaction.type === CLICK && opensCodeForm(id)) return Response.json(codeForm(interaction));
  const broke: ClickAnswer = { type: MESSAGE, data: { ...failed(interaction), flags: EPHEMERAL } };
  const act = interaction.type === SUBMIT
    ? (isCodeForm(id) ? saveCode : null)
    : isModeration(id) ? moderate : isLookButton(id) ? lookButton : null;
  const work = act
    ? act(interaction).catch((error) => {
      console.error("A Discord button failed:", error);
      return broke;
    })
    : Promise.resolve(broke);
  const inTime = await Promise.race([work, sleep(timing.inlineMs).then(() => null)]);
  if (inTime) return Response.json(inTime);

  const asks = opensMessage(id);
  after(async () => {
    const { type, data } = await work;
    // A change goes to the message clicked; anything else must not overwrite it.
    if (asks || type !== MESSAGE) await finish(interaction, data);
    else await followUp(interaction, data);
  });
  return Response.json(asks ? { type: DEFERRED, data: { flags: EPHEMERAL } } : { type: DEFERRED_UPDATE });
}

export async function POST(request: Request) {
  // The signature covers the raw body, so it is checked before anything parses it.
  const body = await request.text();
  const key = process.env.DISCORD_PUBLIC_KEY ?? "";
  const signed = await verifyDiscord(
    key,
    request.headers.get("x-signature-ed25519"),
    request.headers.get("x-signature-timestamp"),
    body,
  );
  if (!signed) return new Response("Bad signature", { status: 401 });

  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type === PING) return Response.json({ type: PONG });

  // Suggestions cannot wait for a "thinking" message: none in time is better than late.
  if (interaction.type === AUTOCOMPLETE && interaction.data) {
    const none = sleep(timing.inlineMs).then(() => []);
    const choices = await Promise.race([suggest(interaction.data, interaction.locale).catch(() => []), none]);
    return Response.json({ type: CHOICES, data: { choices } });
  }
  if ((interaction.type === CLICK || interaction.type === SUBMIT) && interaction.data?.custom_id) return click(interaction);
  if (interaction.type !== COMMAND || !interaction.data) return new Response(null, { status: 400 });

  const quick = quickReply(interaction);
  if (quick) return Response.json({ type: MESSAGE, data: quick });

  // A failure becomes the failed answer, so the work never rejects unhandled.
  const work = answer(interaction).catch((error) => {
    console.error("A Discord command failed:", error);
    return failed(interaction);
  });
  const inTime = await Promise.race([work, sleep(timing.inlineMs).then(() => null)]);
  if (inTime) return Response.json({ type: MESSAGE, data: inTime });

  after(async () => finish(interaction, await work));
  // Whether the answer is private is fixed now: an edit cannot change it.
  return Response.json(isQuiet(interaction.data) ? { type: DEFERRED, data: { flags: EPHEMERAL } } : { type: DEFERRED });
}
