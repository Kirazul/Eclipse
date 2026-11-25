import { NextResponse, type NextRequest } from "next/server";
import { isNewerBuild, parseVersionRequest } from "@/lib/game-sync/wire";
import { latestRelease } from "@/lib/releases";

const reply = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

/** A version check is two short lines; anything longer is not one. */
const MAX_BODY = 256;

// Asked once a launch by the overlay, with no token: is a newer Eclipse out? It answers
// current whenever it cannot tell, so a quiet or broken lookup never nags a player.
export async function POST(request: NextRequest) {
  const body = (await request.text().catch(() => "")).slice(0, MAX_BODY);
  const build = parseVersionRequest(body);
  if (!build) return reply("bad-request", 400);
  const release = await latestRelease();
  return reply(release && isNewerBuild(release.version, build) ? `update ${release.version}` : "current");
}
