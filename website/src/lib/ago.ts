const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago", "yesterday", "just now": how long before `now` a moment was, in `locale`. */
export function ago(iso: string, now: number, locale = "en") {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsed = new Date(iso).getTime() - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return format.format(Math.round(elapsed / size), unit);
  }
  // English says it as a feed does; other languages take Intl's own word for "now".
  return locale === "en" ? "just now" : format.format(0, "second");
}

const WEEK = 7 * 86_400_000;
// Read on the server, so one zone for everyone; a date is only shown past a week old.
const date = (locale: string) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-US" : locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "3 hours ago" for the first week, as a feed reads, then the date: "Nov 1, 2026". */
export function posted(iso: string, now: number, locale = "en") {
  const time = new Date(iso).getTime();
  return now - time < WEEK ? ago(iso, now, locale) : date(locale).format(time);
}
