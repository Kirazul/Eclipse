import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigured, supabaseKey, supabaseUrl } from "@/lib/supabase/config";

// Server Components cannot write cookies, so one that refreshed an expired token
// would throw the new token away and sign the visitor out. This runs first and
// keeps it. A visitor with no Supabase cookie has no session to refresh.
export async function middleware(request: NextRequest) {
  // Supabase uses its Site URL, this page, when it does not recognise the address it
  // was given. Nothing here reads a sign-in's result, so pass it to the page that does.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/" && (searchParams.has("code") || searchParams.has("error"))) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }

  const hasSession = request.cookies.getAll().some(({ name }) => name.startsWith("sb-"));
  if (!supabaseConfigured() || !hasSession) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const db = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Nothing may run between creating the client and this call: it does the refresh.
  await db.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|assets|basis|gpu|favicon.ico|.*\\.(?:png|jpe?g|webp|svg|ico|woff2?)$).*)"],
};
