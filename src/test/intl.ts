import { vi } from "vitest";

// Tests render pages and components outside Next, where next-intl has no request and
// no provider. They read the English messages, as an English visitor would. vi.mock is
// hoisted above this file's other lines, so each factory builds what it needs itself.

async function englishTranslator() {
  const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
  const { default: en } = await import("@/i18n/messages/en.json");
  return (namespace?: string) =>
    createTranslator({ locale: "en", messages: en, ...(namespace ? { namespace: namespace as never } : {}) });
}

vi.mock("next-intl", async (importOriginal) => {
  const translator = await englishTranslator();
  return { ...(await importOriginal<typeof import("next-intl")>()), useTranslations: translator, useLocale: () => "en" };
});

vi.mock("next-intl/server", async (importOriginal) => {
  const translator = await englishTranslator();
  return {
    ...(await importOriginal<typeof import("next-intl/server")>()),
    getTranslations: async (namespace?: string) => translator(namespace),
    getLocale: async () => "en",
  };
});
