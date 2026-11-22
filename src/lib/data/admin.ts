import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SCREENSHOT_BUCKET, thumbOf, UPLOAD_PATH } from "@/lib/screenshots";
import type { ShowcaseLook } from "@/lib/showcase-post";
import { supabaseUrl } from "@/lib/supabase/config";
import { SCREENSHOT_TYPE } from "./compress";

// The one place the site acts with the database's secret key, which skips every row
// rule. It serves the Discord bot, where no visitor's session exists, and reaches only
// the functions in supabase/migrations/20261114090000_discord_bot_bridge.sql, the
// Discord showcase table and imported looks' own screenshot folders. One exception
// serves visitors: recordCopy, which can only add one copy per visitor to a public look's
// count (20261119090000_look_copies.sql). Moderators also act from Discord through the
// functions in 20261120120000_discord_moderation.sql, which check who clicked. The
// functions in 20261120150000_discord_linked_roles.sql keep connected players' Discord
// tokens for Linked Roles, and those in 20261122150000_game_picture_budget.sql let the
// daily sweep remove pictures nothing shows. Keep it that narrow: anything added here runs
// with full power over the database.

const secretKey = () => process.env.SUPABASE_SECRET_KEY ?? "";

export const adminConfigured = () => Boolean(supabaseUrl && secretKey());

let client: SupabaseClient | null = null;
function admin(): SupabaseClient {
  client ??= createClient(supabaseUrl, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** The Discord account behind a look, or null for one of the game's own sets. */
export const discordIdOfLook = (look: string) => call<string | null>("discord_id_of_look", { look });

export const discordHasLooks = (player: string) => call<boolean>("discord_has_looks", { player });

/** Every Discord account with a look on the Wardrobe. */
export const discordCreators = async () => (await call<string[] | null>("discord_creators")) ?? [];

/** Hands the role to its next holder, or to nobody, and says who held it before. */
export const swapRoleHolder = (which: "look_of_the_week", holder: string | null) =>
  call<string | null>("swap_discord_role_holder", { which, holder });

/**
 * Counts a visitor's copy of a look, once per visitor. `visitor` must come from the
 * request's own headers (visitorOf), never from anything the visitor sent.
 */
export const recordCopy = (look: string, visitor: string) => call<null>("record_copy", { look, visitor });

/** The look a showcase message already became, if it did. */
export async function lookOfMessage(message: string): Promise<string | null> {
  const { data, error } = await admin().from("discord_looks").select("outfit_id").eq("message_id", message).maybeSingle();
  if (error) throw new Error(`discord_looks: ${error.message}`);
  return (data?.outfit_id as string | undefined) ?? null;
}

/** Writes the look. The id returned is another look's when the message was added first. */
export const importDiscordLook = (id: string, look: ShowcaseLook, gallery: string[]) =>
  call<string>("import_discord_look", {
    look: id,
    player: look.discordId,
    message: look.messageId,
    player_name: look.name,
    look_title: look.title,
    look_code: look.code,
    look_race: look.race,
    look_tags: look.tags,
    caption: look.description,
    shots: gallery,
    shared_at: look.createdAt,
  });

/** An imported look's folder is discord/<look>: nothing else is written with this key. */
const IMPORTED = /^discord\/[0-9a-f-]{36}\/[0-9a-f-]{36}(-thumb)?\.avif$/;

export async function storeScreenshot(path: string, body: Buffer) {
  if (!IMPORTED.test(path)) throw new Error(`Not an imported look's screenshot: ${path}`);
  const { error } = await admin().storage.from(SCREENSHOT_BUCKET).upload(path, body, { contentType: SCREENSHOT_TYPE });
  if (error) throw new Error(`Upload ${path}: ${error.message}`);
}

export async function removeScreenshots(paths: string[]) {
  const ours = paths.filter((p) => IMPORTED.test(p));
  if (ours.length) await admin().storage.from(SCREENSHOT_BUCKET).remove(ours);
}

// Moderating from Discord's report alerts (20261120120000_discord_moderation.sql). The
// database itself checks that the clicking Discord account is a site moderator's.
export type Reported = "look" | "comment";

export const discordIsModerator = (player: string) => call<boolean>("discord_is_moderator", { player });

/** Keeps a reported look or comment. False when it is already gone. */
export const discordKeepReported = (player: string, kind: Reported, target: string) =>
  call<boolean>("discord_keep_reported", { player, kind, target });

/** Deletes it, and a look's screenshots with it. False when it is already gone. */
export async function discordDeleteReported(player: string, kind: Reported, target: string): Promise<boolean> {
  const shots = await call<string[] | null>("discord_delete_reported", { player, kind, target });
  if (!shots) return false;
  // The paths come from the deleted row itself, never from what Discord sent.
  const paths = shots.flatMap((path) => [path, thumbOf(path)]);
  if (paths.length) {
    const { error } = await admin().storage.from(SCREENSHOT_BUCKET).remove(paths);
    if (error) console.error("A deleted look's screenshots stayed in storage:", error.message);
  }
  return true;
}

// Discord Linked Roles (20261120150000_discord_linked_roles.sql): a player's Discord token
// for this app, kept to update the numbers their server roles are judged on.
export interface LinkStats {
  looks: number;
  upvotes: number;
  name: string | null;
}

export interface DiscordLink {
  discord_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  stats: LinkStats;
}

/** Keeps the connection. Null when no site account signs in with that Discord account. */
export const discordLinkSave = (player: string, access: string, refresh: string, expires: string) =>
  call<LinkStats | null>("discord_link_save", { player, access, refresh, expires });

export const discordLinks = async () => (await call<DiscordLink[] | null>("discord_links")) ?? [];

export const discordLinkTokens = (player: string, access: string, refresh: string, expires: string) =>
  call<null>("discord_link_tokens", { player, access, refresh, expires });

export const discordLinkForget = (player: string) => call<null>("discord_link_forget", { player });

/** More batches than a day should ever leave, so a fault cannot keep this going. */
const SWEEP_BATCHES = 20;

/**
 * Removes the files of game pictures no set or look shows any more, and says how many.
 * The paths are the database's own, and a picture is forgotten only once its file is gone.
 */
export async function sweepGamePictures(): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < SWEEP_BATCHES; batch++) {
    const paths = (await call<string[] | null>("game_shot_sweep")) ?? [];
    if (!paths.length) break;
    const odd = paths.find((path) => !UPLOAD_PATH.test(path));
    if (odd) throw new Error(`Not a game picture: ${odd}`);
    const { error } = await admin().storage.from(SCREENSHOT_BUCKET).remove(paths.flatMap((path) => [path, thumbOf(path)]));
    if (error) throw new Error(`Sweeping pictures: ${error.message}`);
    await call<null>("game_shot_swept", { p_paths: paths });
    removed += paths.length;
  }
  return removed;
}
