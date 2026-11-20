import type en from "./messages/en.json";
import type { Locale } from "./locales";

// Every message key is checked at compile time against the English messages.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
