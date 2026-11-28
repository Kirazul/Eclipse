import { NextResponse, type NextRequest } from "next/server";
import { searchSets, setAt } from "@/lib/item-sets";

/** ?q= finds the game's sets by name; ?at=<number> is one set, the visitor's random pick. */
export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const at = searchParams.get("at");
  let found;
  if (at !== null) {
    const set = at.trim() ? setAt(Number(at)) : null;
    found = set ? [set] : [];
  } else found = searchSets((searchParams.get("q") ?? "").slice(0, 60));
  return NextResponse.json(found, {
    // The catalogue changes only with a deployment, which starts a fresh cache.
    headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
