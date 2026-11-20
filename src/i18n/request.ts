import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, pickLocale } from "./locales";
import { MESSAGES } from "./messages";

// next-intl's per-request setup: the visitor's language (src/i18n/locales.ts) and its
// messages. Pages keep one address in every language, so nothing here reads the path.

export default getRequestConfig(async () => {
  const locale = pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return { locale, messages: MESSAGES[locale] };
});
