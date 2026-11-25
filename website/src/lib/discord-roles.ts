import "server-only";
import {
  adminConfigured, discordCreators, discordHasLooks, discordIdOfLook, swapRoleHolder,
} from "@/lib/data/admin";
import { botConfigured, setRole } from "@/lib/discord-bot";

// The community server's two earned roles. Gallery Creator: someone whose Discord
// account has a look on the Community Gallery. Look of the Week: the player behind this week's
// winner, one person at a time. Each needs its role id set, the server's id and the bot's
// token; with any missing, nothing is handed out.

const guild = () => process.env.DISCORD_GUILD_ID ?? "";
const creatorRole = () => process.env.DISCORD_CREATOR_ROLE_ID ?? "";
const weekRole = () => process.env.DISCORD_WEEK_ROLE_ID ?? "";

const ready = (role: string) => Boolean(role && guild() && botConfigured() && adminConfigured());

const CREATOR_REASON = "Has a look on the Eclipse Community Gallery";

/** For a player whose look was just added. */
export async function grantCreator(discordId: string) {
  if (ready(creatorRole())) await setRole(guild(), discordId, creatorRole(), true, CREATOR_REASON);
}

/** After a look is published, for whoever it belongs to. */
export async function grantCreatorOfLook(look: string) {
  if (!ready(creatorRole())) return;
  const discordId = await discordIdOfLook(look);
  if (discordId) await setRole(guild(), discordId, creatorRole(), true, CREATOR_REASON);
}

/** The player behind a look, read before it is deleted. Null when roles are not set up. */
export async function creatorOf(look: string): Promise<string | null> {
  return ready(creatorRole()) ? discordIdOfLook(look) : null;
}

/** After a look is deleted: its player keeps the role only while another look remains. */
export async function recheckCreator(discordId: string | null) {
  if (!discordId || !ready(creatorRole())) return;
  if (!(await discordHasLooks(discordId))) {
    await setRole(guild(), discordId, creatorRole(), false, "No longer has a look on the Eclipse Community Gallery");
  }
}

/**
 * Everyone with a look gets the role, also those who joined the server after publishing
 * or whose looks were claimed at sign-in. Adding a role someone holds changes nothing.
 */
export async function syncCreators(): Promise<number> {
  if (!ready(creatorRole())) return 0;
  const creators = await discordCreators();
  for (const discordId of creators) await setRole(guild(), discordId, creatorRole(), true, CREATOR_REASON);
  return creators.length;
}

/** Moves the Look of the Week role to the winner's player, or takes it back in a quiet week. */
export async function crownLookOfTheWeek(look: string | null) {
  if (!ready(weekRole())) return;
  const winner = look ? await discordIdOfLook(look) : null;
  const previous = await swapRoleHolder("look_of_the_week", winner);
  if (previous && previous !== winner) {
    await setRole(guild(), previous, weekRole(), false, "Another look is the Look of the Week");
  }
  if (winner) await setRole(guild(), winner, weekRole(), true, "Made the Eclipse Look of the Week");
}
