// The site header imports this file, so it reaches every page: keep zod out of it.

/** Holds the page to return to while the visitor is away at the provider. */
export const AUTH_NEXT_COOKIE = "eclipse-auth-next";
export const AUTH_COOKIE_PATH = "/auth";

export const NAME_MAX = 32;

export const PROVIDER_NAMES: Record<string, string> = { discord: "Discord" };

const WARDROBE = "/community-gallery";
const THIS_SITE = "https://this.site.invalid";

/**
 * A path on this site, or the Wardrobe. Parsed the way a browser will parse it:
 * a prefix check misses /\evil.com, which browsers treat as //evil.com.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return WARDROBE;
  try {
    const url = new URL(value, THIS_SITE);
    return url.origin === THIS_SITE ? url.pathname + url.search : WARDROBE;
  } catch {
    return WARDROBE;
  }
}
