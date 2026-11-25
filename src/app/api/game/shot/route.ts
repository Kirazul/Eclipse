import { NextResponse, type NextRequest } from "next/server";
import { compressScreenshot, SCREENSHOT_EXTENSION, SCREENSHOT_TYPE } from "@/lib/data/compress";
import { bearerToken, hashSecret } from "@/lib/game-sync/secrets";
import { formatShotAnswer, MAX_SHOT_BYTES, parseShotRequest, type ShotStatus } from "@/lib/game-sync/wire";
import { SCREENSHOT_BUCKET, smallOf, thumbOf } from "@/lib/screenshots";
import { createAnonSupabase } from "@/lib/supabase/anon";

// A picture from the game's Showcase studio, filed on one of the player's saved sets.
// The anon key cannot write storage by itself: game_shot_begin checks the token and
// issues a ticket for one path, which the bucket's policy then lets this store.

// The picture in base64, its header lines, and room to spare, under the platform's limit.
const MAX_BODY = Math.ceil((MAX_SHOT_BYTES * 4) / 3) + 4096;

const STATUS: Record<ShotStatus, number> = {
  ok: 200,
  unlinked: 401,
  missing: 404,
  "set-full": 409,
  "account-full": 409,
  busy: 429,
  "too-large": 413,
  unreadable: 415,
  "bad-request": 400,
  unavailable: 503,
};

function reply(status: ShotStatus, count?: number) {
  return new NextResponse(formatShotAnswer({ status, count }), {
    status: STATUS[status],
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(status === "busy" ? { "Retry-After": "5" } : {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return reply("unlinked");
  if (Number(request.headers.get("content-length")) > MAX_BODY) return reply("too-large");

  const parsed = parseShotRequest(await request.text());
  if (!parsed) return reply("bad-request");
  if (parsed.image.length > MAX_SHOT_BYTES) return reply("too-large");

  const db = createAnonSupabase();
  const tokenHash = hashSecret(token);

  // The token first: compressing is the costly step, and only a linked game gets it.
  const begun = await db.rpc("game_shot_begin", {
    p_token_hash: tokenHash,
    p_name: parsed.name,
    p_ext: SCREENSHOT_EXTENSION,
  });
  if (begun.error) {
    console.error("Game picture failed to begin:", begun.error.message);
    return reply("unavailable");
  }
  const ticket = begun.data as { status: ShotStatus; path?: string };
  if (ticket.status !== "ok" || !ticket.path) return reply(ticket.status);

  // An unfiled ticket runs out, and anything it stored is cleared with the owner's orphans.
  const compressed = await compressScreenshot(parsed.image);
  if (!compressed) return reply("unreadable");

  const files = db.storage.from(SCREENSHOT_BUCKET);
  // The smaller copies first, as the site's own uploads: a set only ever names the full file.
  for (const [path, body] of [
    [thumbOf(ticket.path), compressed.thumb],
    [smallOf(ticket.path), compressed.small],
    [ticket.path, compressed.full],
  ] as const) {
    const stored = await files.upload(path, body, { contentType: SCREENSHOT_TYPE });
    if (stored.error) {
      console.error("Game picture failed to store:", stored.error.message);
      return reply("unavailable");
    }
  }

  const attached = await db.rpc("game_shot_attach", { p_token_hash: tokenHash, p_path: ticket.path });
  if (attached.error) {
    console.error("Game picture failed to attach:", attached.error.message);
    return reply("unavailable");
  }
  const filed = attached.data as { status: ShotStatus; count?: number };
  return reply(filed.status, filed.count);
}
