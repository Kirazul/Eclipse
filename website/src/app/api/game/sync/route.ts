import { NextResponse, type NextRequest } from "next/server";
import { bearerToken, hashSecret } from "@/lib/game-sync/secrets";
import { formatSyncAnswer, parseSyncRequest, type SyncAnswer } from "@/lib/game-sync/wire";
import { createAnonSupabase } from "@/lib/supabase/anon";

// A batch is capped by the game at 1 MB; this is the door, below the platform's limit.
const MAX_BODY = 4 * 1024 * 1024;

const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return reply("unlinked", 401);
  if (Number(request.headers.get("content-length")) > MAX_BODY) return reply("too large", 413);

  const parsed = parseSyncRequest(await request.text());
  if (!parsed) return reply("bad request", 400);

  const { data, error } = await createAnonSupabase().rpc("game_sync", {
    p_token_hash: hashSecret(token),
    p_cursor: parsed.cursor,
    p_label: parsed.label,
    p_changes: parsed.changes,
  });
  if (error) {
    console.error("Game sync failed:", error.message);
    return reply("unavailable", 503);
  }

  const answer = data as SyncAnswer & { status: string };
  if (answer.status === "unlinked") return reply("unlinked", 401);
  if (answer.status === "busy") return reply("busy", 429, { "Retry-After": "2" });
  return reply(formatSyncAnswer({ ...answer, rejected: [...answer.rejected, ...parsed.rejected] }));
}
