import { NextResponse } from "next/server";
import { repository } from "@/lib/data";

/**
 * Opens one public look at random, so old looks surface again. A static segment, so it
 * wins over `[id]`. Every visit picks anew: nothing here may be cached.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { looks } = await repository.sitemapEntries();
  const id = looks[Math.floor(Math.random() * looks.length)];
  const to = id ? `/community-gallery/${id}` : "/community-gallery";
  return NextResponse.redirect(new URL(to, request.url), { status: 307, headers: { "Cache-Control": "no-store" } });
}
