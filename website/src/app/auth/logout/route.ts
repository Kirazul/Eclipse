import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (supabaseConfigured()) {
    const db = await createServerSupabase();
    await db.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), 303);
}
