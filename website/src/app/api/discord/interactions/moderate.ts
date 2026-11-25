import "server-only";
import {
  adminConfigured, discordDeleteReported, discordIsModerator, discordKeepReported, type Reported,
} from "@/lib/data/admin";
import { NO_MENTIONS, plain } from "@/lib/discord";
import { bot, botConfigured, isSnowflake } from "@/lib/discord-bot";
import { EPHEMERAL, MESSAGE, UPDATE, say, type ClickAnswer, type Interaction, type Reply } from "./reply";

// The Keep and Delete… buttons on report alerts in the moderators' channel
// (src/lib/moderation-alert.ts). Delete asks first, in a message only the moderator
// sees. The database checks that the clicking Discord account is a site moderator's.

/**
 * keep and ask sit on the alert (reportButtons in src/lib/moderation-alert.ts); delete
 * sits on the private question, and names the alert.
 */
const BUTTON = /^mod:(keep|ask|delete):(look|comment):([0-9a-f-]{36})(?::([0-9]{17,20}))?$/;

interface Click {
  verb: "keep" | "ask" | "delete";
  kind: Reported;
  id: string;
  alert?: string;
}

function read(customId: string): Click | null {
  const m = BUTTON.exec(customId);
  return m ? { verb: m[1] as Click["verb"], kind: m[2] as Reported, id: m[3], alert: m[4] } : null;
}

export const isModeration = (customId: string) => customId.startsWith("mod:");

/** Only ask opens a new message; the rest change the message clicked. */
export const opensMessage = (customId: string) => read(customId)?.verb === "ask";

const privately = (content: string): ClickAnswer => ({ type: MESSAGE, data: say(content) });

/** The alert, settled: its note above the report, and no buttons left to click. */
const settled = (note: string): Reply => ({ content: note, components: [], allowed_mentions: NO_MENTIONS });

/** Settles the alert from the private question, where the click has no hold on it. */
async function settleAlert(channel: string | undefined, alert: string, note: string) {
  if (!channel || !isSnowflake(channel) || !botConfigured()) return;
  const res = await bot(`/channels/${channel}/messages/${alert}`, { method: "PATCH", body: JSON.stringify(settled(note)) });
  if (!res.ok) console.error("Discord refused to settle a report alert:", res.status, await res.text());
}

export async function moderate(interaction: Interaction): Promise<ClickAnswer> {
  const click = read(interaction.data?.custom_id ?? "");
  if (!click) return privately("That button is not part of Eclipse anymore.");
  const who = interaction.member?.user;
  if (!who || !adminConfigured()) return privately("Moderating works only in the Eclipse server.");
  if (!(await discordIsModerator(who.id))) return privately("Only Community Gallery moderators can do that.");

  const name = plain(who.global_name || who.username || "a moderator");
  const thing = click.kind;

  if (click.verb === "ask") {
    const alert = interaction.message?.id ?? "";
    return {
      type: MESSAGE,
      data: {
        content: `Delete this ${thing} from the Community Gallery? This cannot be undone.`,
        flags: EPHEMERAL,
        allowed_mentions: NO_MENTIONS,
        components: [{
          type: 1,
          components: [{ type: 2, style: 4, label: `Delete ${thing}`, custom_id: `mod:delete:${thing}:${click.id}:${alert}` }],
        }],
      },
    };
  }

  if (click.verb === "keep") {
    const kept = await discordKeepReported(who.id, click.kind, click.id);
    return { type: UPDATE, data: settled(kept ? `Kept by ${name}.` : `This ${thing} was already deleted.`) };
  }

  const deleted = await discordDeleteReported(who.id, click.kind, click.id);
  if (click.alert) {
    await settleAlert(interaction.channel_id, click.alert, deleted ? `Deleted by ${name}.` : `This ${thing} was already deleted.`);
  }
  return {
    type: UPDATE,
    data: { content: deleted ? `Deleted the ${thing}.` : `That ${thing} was already gone.`, components: [], allowed_mentions: NO_MENTIONS },
  };
}
