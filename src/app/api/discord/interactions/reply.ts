import { NO_MENTIONS, type Embed } from "@/lib/discord";
import type { ShowcaseMessage } from "@/lib/showcase-post";

// What Discord sends the bot, and what the bot answers.

export interface CommandData {
  name: string;
  /** 1 a slash command, 3 a message's right-click menu. */
  type?: number;
  options?: { name: string; value: unknown; focused?: boolean }[];
  /** A right-clicked message, with the message itself under resolved. */
  target_id?: string;
  resolved?: { messages?: Record<string, ShowcaseMessage> };
  /** A clicked button's id, or a sent form's. Neither sends a name. */
  custom_id?: string;
  /** A sent form's fields, each in its label. */
  components?: { type: number; component?: { type: number; custom_id?: string; value?: string } }[];
}

export interface Interaction {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id?: string;
  /** The asker's Discord language, such as "en-US" or "ru". */
  locale?: string;
  /** The server's own language, for what everyone in it reads. */
  guild_locale?: string;
  /** In a server: who asked, with their permissions there. Signed by Discord, so trusted. */
  member?: { user: { id: string; username?: string; global_name?: string | null }; permissions?: string };
  /** For a click, or a form a click opened: the message the button is on. */
  message?: { id: string; flags?: number };
  data?: CommandData;
}

export const MESSAGE_COMMAND = 3;

/** Message flag: only the person who asked sees it. */
export const EPHEMERAL = 64;

export interface Reply {
  content?: string;
  embeds?: Embed[];
  components?: unknown[];
  flags?: number;
  allowed_mentions: typeof NO_MENTIONS;
}

/** Answers to a click or a sent form: a new message, or a change to the one the button is on. */
export const MESSAGE = 4;
export const UPDATE = 7;
export interface ClickAnswer {
  type: typeof MESSAGE | typeof UPDATE;
  data: Reply;
}

/** A form opened by a click. Discord takes one only as the click's immediate answer. */
export const FORM = 9;
export interface Form {
  custom_id: string;
  title: string;
  components: unknown[];
}

/** A short answer only the asker sees. */
export const say = (content: string): Reply => ({ content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS });
