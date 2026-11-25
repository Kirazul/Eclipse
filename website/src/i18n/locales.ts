// The site's languages. Every page keeps one address for all of them: the language
// comes from the visitor's own choice (a cookie, set by the switcher), else from their
// browser's languages, else English. No server-only imports: the switcher reads this too.

export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The switcher's choice, kept for a year. */
export const LOCALE_COOKIE = "eclipse-locale";
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language by its own name, as a switcher shows it. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ru: "Русский" };

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * The language for a request: the cookie when it names one we have, else the first of
 * the browser's languages (by its q weights) we have, else English. Only Russian itself
 * picks Russian: a browser set to a neighbouring language is not assumed to want it.
 */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const wanted = (acceptLanguage ?? "")
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q) : 1, order };
    })
    .filter((w) => w.lang && w.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  return wanted.map((w) => w.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
