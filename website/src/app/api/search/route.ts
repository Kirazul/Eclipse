import { NextResponse } from "next/server";
import { repository } from "@/lib/data";
import type { CreatorEntry, SearchEntry } from "@/lib/data/types";

/** How many creators the command menu can find by name. */
const CREATORS = 100;

export interface SearchIndex {
  looks: SearchEntry[];
  creators: CreatorEntry[];
}

// The command menu's list, read when the menu first opens. Public rows only.
export async function GET() {
  const [looks, creators] = await Promise.all([repository.searchIndex(), repository.listCreators({ limit: CREATORS })]);
  return NextResponse.json({ looks, creators } satisfies SearchIndex, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}
