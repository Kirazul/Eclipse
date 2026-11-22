import { NextResponse, type NextRequest } from "next/server";
import { searchItems } from "@/lib/catalog";

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").slice(0, 60);
  return NextResponse.json(searchItems(q, Number(searchParams.get("slot") ?? -1)), {
    // The catalogue changes only with a deployment, which starts a fresh cache.
    headers: { "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
