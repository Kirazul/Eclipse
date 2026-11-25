import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_PATH, AUTH_NEXT_COOKIE, safeNext } from "@/lib/account";
import { supabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabase } from "@/lib/supabase/server";

/** Why the sign-in did not finish, for the notice on the page it lands on. */
async function finishSignIn(params: URLSearchParams): Promise<"failed" | "cancelled" | null> {
  if (params.get("error") === "access_denied") return "cancelled";
  const code = params.get("code");
  if (!code || !supabaseConfigured()) return "failed";
  const db = await createServerSupabase();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (!error) return null;
  console.error("Sign-in failed:", error.message);
  return "failed";
}

// Where a Discord sign-in lands. The page to return to is checked again
// here: a cookie can be set by hand, and this must not become an open redirect.
export async function GET(request: NextRequest) {
  const target = new URL(safeNext(request.cookies.get(AUTH_NEXT_COOKIE)?.value), request.nextUrl.origin);
  const failure = await finishSignIn(request.nextUrl.searchParams);
  target.searchParams.set("auth", failure ?? "signed-in");
  const response = NextResponse.redirect(target);
  response.cookies.delete({ name: AUTH_NEXT_COOKIE, path: AUTH_COOKIE_PATH });
  return response;
}
