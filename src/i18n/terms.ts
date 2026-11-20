import type en from "./messages/en.json";

// The game's words (src/lib/domain.ts) in the reader's language. The data keeps the
// English word as its value, in the database and in links, so only the label changes.

export type TermGroup = keyof typeof en.domain;

/** next-intl's t, from useTranslations, getTranslations or createTranslator. */
interface Translate {
  (key: never): string;
  has(key: never): boolean;
}

/** The word in the reader's language; the English, or `fallback`, for one the messages lack. */
export function term(t: Translate, group: TermGroup, key: string, fallback = key): string {
  const id = `domain.${group}.${key}` as never;
  return t.has(id) ? t(id) : fallback;
}
