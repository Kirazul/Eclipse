import "server-only";
import type { ShowcaseMessage } from "@/lib/showcase-post";

// The bot acting in the community server as itself, with DISCORD_BOT_TOKEN: handing out
// roles and reading the showcase around a post. Answers to slash commands need no token
// (they reply through the interaction), so without one only these do nothing.

const API = "https://discord.com/api/v10";
const token = () => process.env.DISCORD_BOT_TOKEN ?? "";
export const botConfigured = () => Boolean(token());

/** A Discord id, before it goes into a path. */
export const isSnowflake = (id: string) => /^[0-9]{17,20}$/.test(id);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TRIES = 4;

/** A request as the bot. Waits out Discord's rate limit a few times, then gives up. */
export async function bot(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bot ${token()}`, "Content-Type": "application/json", ...init.headers },
    });
    if (res.status !== 429 || attempt >= TRIES) return res;
    const { retry_after } = (await res.json().catch(() => ({}))) as { retry_after?: number };
    await sleep(Math.min(10, retry_after ?? 1) * 1000 + 100);
  }
}

/** Up to 50 messages before this one in its channel, oldest first. Empty when Discord refuses. */
export async function messagesBefore(channel: string, message: string): Promise<ShowcaseMessage[]> {
  if (!isSnowflake(channel) || !isSnowflake(message)) return [];
  const res = await bot(`/channels/${channel}/messages?before=${message}&limit=50`);
  if (!res.ok) {
    console.error("Discord refused the showcase history:", res.status, await res.text());
    return [];
  }
  return ((await res.json()) as ShowcaseMessage[]).reverse();
}

/** Up to 100 messages after this one in its channel, oldest first. Empty when Discord refuses. */
export async function messagesAfter(channel: string, message: string): Promise<ShowcaseMessage[]> {
  if (!isSnowflake(channel) || !isSnowflake(message)) return [];
  const res = await bot(`/channels/${channel}/messages?after=${message}&limit=100`);
  if (!res.ok) {
    console.error("Discord refused what follows a showcase post:", res.status, await res.text());
    return [];
  }
  return ((await res.json()) as ShowcaseMessage[]).reverse();
}

/** One message as it is now, or null when it is gone or Discord refuses. */
export async function messageOf(channel: string, message: string): Promise<ShowcaseMessage | null> {
  if (!isSnowflake(channel) || !isSnowflake(message)) return null;
  const res = await bot(`/channels/${channel}/messages/${message}`);
  return res.ok ? ((await res.json()) as ShowcaseMessage) : null;
}

/**
 * Replies under a message as the bot. It tells whoever wrote the message, as a reply does,
 * and pings nobody else whatever the text says. False when Discord refuses.
 */
export async function replyTo(channel: string, message: string, body: { content: string; components: unknown[] }): Promise<boolean> {
  if (!isSnowflake(channel) || !isSnowflake(message)) return false;
  const res = await bot(`/channels/${channel}/messages`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      message_reference: { message_id: message, fail_if_not_exists: true },
      allowed_mentions: { parse: [], replied_user: true },
    }),
  });
  if (!res.ok) console.error("Discord refused a reply under a post:", res.status, await res.text());
  return res.ok;
}

/** Biggest attachment worth fetching: a phone screenshot is a few MB. */
const MAX_DOWNLOAD = 25 * 1024 * 1024;

/** A file a player attached on Discord, or null when it cannot be fetched or is too big. */
export async function download(url: string): Promise<Buffer | null> {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "https:" || !/(^|\.)(discordapp\.(com|net))$/.test(hostname)) return null;
  const res = await fetch(url);
  if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD) return null;
  const body = Buffer.from(await res.arrayBuffer());
  return body.length > MAX_DOWNLOAD ? null : body;
}

/** Gives or takes a role. A member who left the server (404) is nobody to give it to. */
export async function setRole(guild: string, member: string, role: string, on: boolean, reason: string) {
  if (![guild, member, role].every(isSnowflake)) return;
  const res = await bot(`/guilds/${guild}/members/${member}/roles/${role}`, {
    method: on ? "PUT" : "DELETE",
    headers: { "X-Audit-Log-Reason": reason },
  });
  if (!res.ok && res.status !== 404) console.error("Discord refused a role change:", res.status, await res.text());
}
