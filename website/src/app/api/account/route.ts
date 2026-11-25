import { NextResponse } from "next/server";
import { repository } from "@/lib/data";

// The header asks here so pages stay static: reading the session while rendering
// would make every page dynamic. Never cached, because it answers per visitor.
export async function GET() {
  return NextResponse.json(
    { account: await repository.getAccount() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
