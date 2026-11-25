import { NextResponse, type NextRequest } from "next/server";
import { bearerToken, hashSecret } from "@/lib/game-sync/secrets";
import { createAnonSupabase } from "@/lib/supabase/anon";

const reply = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

// The game's own Unlink button. The website's goes through the owner's session.
export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return reply("unlinked", 401);
  const { error } = await createAnonSupabase().rpc("game_unlink", { p_token_hash: hashSecret(token) });
  if (error) {
    console.error("Game unlink failed:", error.message);
    return reply("unavailable", 503);
  }
  return reply("ok");
}
