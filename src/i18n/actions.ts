"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_MAX_AGE, isLocale } from "./locales";

/** Keeps the visitor's language choice. Anything but a language the site has is ignored. */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: LOCALE_MAX_AGE, sameSite: "lax" });
}
