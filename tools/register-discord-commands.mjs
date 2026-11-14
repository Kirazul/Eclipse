// Registers the bot's commands (src/lib/discord-commands.json) for everywhere the app is
// installed: the Eclipse server, and players who add it to their own account, so /look
// and /decode work in their DMs and other servers. "Add to Community Gallery" stays server-only.
// Run it after changing that file:
//
//   node --env-file=.env.local tools/register-discord-commands.mjs
//
// It needs DISCORD_APP_ID and DISCORD_BOT_TOKEN, and clears the old server-only copies
// when DISCORD_GUILD_ID is set, so no command shows twice. The token never leaves this
// machine except to Discord.
import { readFileSync } from "node:fs";

const { DISCORD_APP_ID: app, DISCORD_GUILD_ID: guild, DISCORD_BOT_TOKEN: token } = process.env;
if (!app || !token) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN first.");
  process.exit(1);
}

async function discord(path, method = "GET", body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    console.error(`Discord refused ${method} ${path}:`, res.status, await res.text());
    process.exit(1);
  }
  return res.json();
}

// Installing to an account is a switch on the app (Installation, in Discord's developer
// portal). While it is off, every command is registered for servers only.
const { integration_types_config: installs = {} } = await discord("/applications/@me");
const userInstall = "1" in installs;
let commands = JSON.parse(readFileSync(new URL("../src/lib/discord-commands.json", import.meta.url), "utf8"));
if (!userInstall) {
  commands = commands.map((c) => ({ ...c, integration_types: [0], contexts: c.contexts.filter((x) => x === 0) }));
  console.log("User install is off for the app, so the commands are registered for servers only.");
}

const registered = await discord(`/applications/${app}/commands`, "PUT", commands);
console.log("Registered:", registered.map((c) => (c.type === 1 ? `/${c.name}` : `"${c.name}"`)).join(", "));
if (guild) {
  await discord(`/applications/${app}/guilds/${guild}/commands`, "PUT", []);
  console.log("Cleared the old server-only copies.");
}
