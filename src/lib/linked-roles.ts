import "server-only";
import {
  adminConfigured, discordLinkForget, discordLinks, discordLinkTokens, type LinkStats,
} from "@/lib/data/admin";
import { bot, botConfigured } from "@/lib/discord-bot";
import { siteUrl } from "@/lib/site";

// Discord Linked Roles. A player connects once (/api/discord/linked-roles), and the
// server can grant roles from what this site recorded: how many public looks they
// have, and how many upvotes those earned. The numbers are pushed to Discord at the
// connection and again every day (/api/cron/linked-roles). Discord itself decides who
// meets a role's bar; the site only reports the numbers.

const API = "https://discord.com/api/v10";

/** Needs the app's OAuth secret beside the bot token and the database key. */
export const linkedRolesConfigured = () =>
  Boolean(process.env.DISCORD_CLIENT_SECRET && botConfigured() && adminConfigured());

/** Must be listed among the app's OAuth2 redirects in Discord's developer portal. */
export const REDIRECT_URI = `${siteUrl}/api/discord/linked-roles/callback`;

/** The state cookie that ties Discord's answer to the browser that asked. */
export const STATE_COOKIE = "eclipse-link-state";

/**
 * What a server's Linked Roles can ask about: looks and upvotes, each "at least" a number
 * the server picks. tools/register-discord-linked-roles.mjs sends it to Discord.
 */
export { default as METADATA } from "./discord-linked-roles.json";

let appId: string | null = null;

/** The app's id, which is its OAuth client id. Asked of Discord once, with the bot token. */
export async function applicationId(): Promise<string> {
  if (appId) return appId;
  const res = await bot("/applications/@me");
  if (!res.ok) throw new Error(`Discord would not say the app's id: ${res.status}`);
  appId = ((await res.json()) as { id: string }).id;
  return appId;
}

export function authorizeUrl(app: string, state: string): string {
  const query = new URLSearchParams({
    client_id: app,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "role_connections.write identify",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

export interface Tokens {
  access: string;
  refresh: string;
  /** ISO time the access token stops working. */
  expires: string;
}

/** Discord's token endpoint. Null when Discord refuses: a bad code, or a revoked refresh. */
async function token(app: string, grant: Record<string, string>): Promise<Tokens | null> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app, client_secret: process.env.DISCORD_CLIENT_SECRET ?? "", ...grant }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access: body.access_token,
    refresh: body.refresh_token,
    expires: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
}

export const exchangeCode = (app: string, code: string) =>
  token(app, { grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });

const refreshTokens = (app: string, refresh: string) => token(app, { grant_type: "refresh_token", refresh_token: refresh });

/** The Discord account the token belongs to. */
export async function discordUserId(access: string): Promise<string | null> {
  const res = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access}` } });
  return res.ok ? ((await res.json()) as { id: string }).id : null;
}

/** Tells Discord the player's numbers. False when Discord refuses the token. */
export async function pushRoleData(app: string, access: string, stats: LinkStats): Promise<boolean> {
  const res = await fetch(`${API}/users/@me/applications/${app}/role-connection`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      platform_name: "Eclipse",
      ...(stats.name ? { platform_username: stats.name.slice(0, 100) } : {}),
      metadata: { looks: String(stats.looks), upvotes: String(stats.upvotes) },
    }),
  });
  if (!res.ok) console.error("Discord refused a player's role data:", res.status, await res.text());
  return res.ok;
}

/** A token this close to its end is renewed before use. */
const RENEW_MS = 24 * 60 * 60 * 1000;

/**
 * The daily run: every connected player's current numbers, to Discord. A token near
 * its end is renewed first; one Discord no longer honours is forgotten, since the
 * player removed the connection there.
 */
export async function syncLinkedRoles(now = Date.now()): Promise<{ pushed: number; forgotten: number }> {
  if (!linkedRolesConfigured()) return { pushed: 0, forgotten: 0 };
  const app = await applicationId();
  let pushed = 0;
  let forgotten = 0;
  for (const link of await discordLinks()) {
    let access = link.access_token;
    if (Date.parse(link.expires_at) - now < RENEW_MS) {
      const renewed = await refreshTokens(app, link.refresh_token);
      if (!renewed) {
        await discordLinkForget(link.discord_id);
        forgotten++;
        continue;
      }
      await discordLinkTokens(link.discord_id, renewed.access, renewed.refresh, renewed.expires);
      access = renewed.access;
    }
    if (await pushRoleData(app, access, link.stats)) pushed++;
  }
  return { pushed, forgotten };
}
