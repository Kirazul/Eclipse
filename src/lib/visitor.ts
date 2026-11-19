// Our host sets these headers itself and overwrites what a browser sends, so a visitor
// cannot pick their own address. The database turns this into a salted fingerprint and
// keeps only that (supabase/migrations/20261119090000_look_copies.sql).
const MAX_AGENT = 256;

/** The visitor behind a request: their address and browser. Null when the host gave no address. */
export function visitorOf(h: Headers): string | null {
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  const address = ip?.trim();
  if (!address) return null;
  return `${address}|${(h.get("user-agent") ?? "").slice(0, MAX_AGENT)}`;
}
