import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_PATH, AUTH_NEXT_COOKIE, safeNext } from "@/lib/account";
import { isOAuthProvider, supabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabase } from "@/lib/supabase/server";

const TEN_MINUTES = 600;

export async function GET(request: NextRequest) {
  const { origin, protocol, searchParams } = request.nextUrl;
  const provider = searchParams.get("provider");
  if (!supabaseConfigured() || !isOAuthProvider(provider)) return NextResponse.redirect(new URL("/community-gallery", origin));
  const remembered = {
    httpOnly: true,
    sameSite: "lax",
    secure: protocol === "https:",
    path: AUTH_COOKIE_PATH,
    maxAge: TEN_MINUTES,
  } as const;

  const db = await createServerSupabase();
  const { data, error } = await db.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) return NextResponse.redirect(new URL("/community-gallery?auth=failed", origin));
  const response = NextResponse.redirect(data.url);
  // Supabase matches redirectTo against an allow list, so the page goes in a cookie.
  response.cookies.set(AUTH_NEXT_COOKIE, safeNext(searchParams.get("next")), remembered);
  return response;
}
