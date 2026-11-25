// Our host sets these headers itself and overwrites what a browser sends, so a visitor
// cannot pick their own address. The browser's own description of itself is left out: a
// visitor can change it at will, and each change would count their copy again. The
// database turns this into a salted fingerprint and keeps only that
// (supabase/migrations/20261119090000_look_copies.sql).

/** The visitor behind a request: their address. Null when the host gave no address. */
export function visitorOf(h: Headers): string | null {
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  return ip?.trim() || null;
}
