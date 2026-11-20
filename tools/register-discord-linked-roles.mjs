// Turns on Discord Linked Roles for the Eclipse app. Run it once, after
// DISCORD_CLIENT_SECRET is set in production and the callback is listed among the
// app's OAuth2 redirects in Discord's developer portal:
//
//   node --env-file=.env.local tools/register-discord-linked-roles.mjs https://eclipsewow.vercel.app
//
// It sends what a server's roles can ask about (src/lib/discord-linked-roles.json) and
// points the app's Linked Roles Verification URL at the site. Needs DISCORD_BOT_TOKEN;
// the token never leaves this machine except to Discord.
import { readFileSync } from "node:fs";

const { DISCORD_BOT_TOKEN: token } = process.env;
const site = process.argv[2];
if (!token || !site?.startsWith("https://")) {
  console.error("Set DISCORD_BOT_TOKEN and pass the site's https address.");
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

const { id } = await discord("/applications/@me");
const metadata = JSON.parse(readFileSync(new URL("../src/lib/discord-linked-roles.json", import.meta.url), "utf8"));
const saved = await discord(`/applications/${id}/role-connections/metadata`, "PUT", metadata);
console.log("Role fields:", saved.map((m) => m.key).join(", "));
const app = await discord("/applications/@me", "PATCH", { role_connections_verification_url: `${site}/api/discord/linked-roles` });
console.log("Verification URL:", app.role_connections_verification_url);
console.log(`Also list ${site}/api/discord/linked-roles/callback among the app's OAuth2 redirects.`);
