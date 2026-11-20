import { createTranslator } from "next-intl";
import { isLocale, type Locale } from "@/i18n/locales";
import { MESSAGES } from "@/i18n/messages";

// The bot answers in the asker's Discord language when the site has it (Discord sends
// it with every command and click), else in English.

export const localeOf = (discordLocale: string | undefined): Locale => {
  const lang = discordLocale?.split("-")[0];
  return isLocale(lang) ? lang : "en";
};

export const translator = (discordLocale?: string) => {
  const locale = localeOf(discordLocale);
  return createTranslator({ locale, messages: MESSAGES[locale] });
};

export type T = ReturnType<typeof translator>;
