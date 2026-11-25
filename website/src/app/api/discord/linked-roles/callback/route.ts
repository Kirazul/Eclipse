import { NextResponse, type NextRequest } from "next/server";
import { discordLinkSave } from "@/lib/data/admin";
import {
  STATE_COOKIE, applicationId, discordUserId, exchangeCode, linkedRolesConfigured, pushRoleData,
} from "@/lib/linked-roles";
import { siteUrl } from "@/lib/site";

type Status = "ok" | "no-account" | "failed" | "off";

/** Discord sends the player back here. The page they land on says how it went. */
export async function GET(request: NextRequest) {
  const done = (status: Status) => {
    const response = NextResponse.redirect(`${siteUrl}/linked-roles?status=${status}`);
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/discord/linked-roles" });
    return response;
  };
  if (!linkedRolesConfigured()) return done("off");

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  // The state proves this browser started the connection, so nobody can link a
  // player's Discord to the site by sending them a crafted link.
  if (!code || !state || request.cookies.get(STATE_COOKIE)?.value !== state) return done("failed");

  try {
    const app = await applicationId();
    const tokens = await exchangeCode(app, code);
    const player = tokens && (await discordUserId(tokens.access));
    if (!tokens || !player) return done("failed");
    const stats = await discordLinkSave(player, tokens.access, tokens.refresh, tokens.expires);
    if (!stats) return done("no-account");
    return done((await pushRoleData(app, tokens.access, stats)) ? "ok" : "failed");
  } catch (error) {
    console.error("A Linked Roles connection failed:", error);
    return done("failed");
  }
}
