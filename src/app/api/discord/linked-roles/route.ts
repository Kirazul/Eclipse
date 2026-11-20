import { NextResponse } from "next/server";
import { STATE_COOKIE, applicationId, authorizeUrl, linkedRolesConfigured } from "@/lib/linked-roles";
import { siteUrl } from "@/lib/site";

// Discord's "Linked Roles Verification URL" for the app: where a player lands from the
// server's role settings to connect their account. It sends them on to Discord, with a
// one-time state the callback checks.
export async function GET() {
  if (!linkedRolesConfigured()) return NextResponse.redirect(`${siteUrl}/linked-roles?status=off`);
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(authorizeUrl(await applicationId(), state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/discord/linked-roles",
  });
  return response;
}
