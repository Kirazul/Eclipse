import en from "./messages/en.json";
import ru from "./messages/ru.json";
import type { Locale } from "./locales";

/** Each language's messages. Russian has every English key (messages.test.ts). */
export const MESSAGES: Record<Locale, typeof en> = { en, ru };
