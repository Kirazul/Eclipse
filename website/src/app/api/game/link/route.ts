import { NextResponse, type NextRequest } from "next/server";
import { hashSecret, newDeviceToken, normalizeLinkCode } from "@/lib/game-sync/secrets";
import { parseLinkRequest } from "@/lib/game-sync/wire";
import { createAnonSupabase } from "@/lib/supabase/anon";

const MAX_BODY = 1024;

const reply = (body: string, status = 200) =>
  new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

const REFUSED: Record<string, number> = { invalid: 403, full: 409 };

// The game trades the code a player carried over for its own device token. This is
// the only time the token exists anywhere but on that player's PC.
export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) return reply("too large", 413);
  const parsed = parseLinkRequest(await request.text());
  const code = parsed && normalizeLinkCode(parsed.code);
  if (!parsed || !code) return reply("invalid", 403);

  const token = newDeviceToken();
  const { data, error } = await createAnonSupabase().rpc("game_link_claim", {
    p_code_hash: hashSecret(code),
    p_token_hash: hashSecret(token),
    p_label: parsed.label,
  });
  if (error) {
    console.error("Game link failed:", error.message);
    return reply("unavailable", 503);
  }
  if (data !== "linked") return reply(data, REFUSED[data] ?? 403);
  return reply(`ok ${token}`);
}
