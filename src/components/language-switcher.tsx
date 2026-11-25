"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_NAMES } from "@/i18n/locales";

/**
 * Flips between the site's two languages. The page keeps its address: the choice is a
 * cookie, and a refresh renders the same page again in the other language.
 */
export function LanguageSwitcher({ className = "icon-btn", withName = false }: { className?: string; withName?: boolean }) {
  const t = useTranslations("language");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const unreachable = useTranslations("layout")("unreachable");
  const next = LOCALES.find((l) => l !== locale) ?? LOCALES[0];

  return (
    <button
      type="button"
      className={className}
      lang={next}
      disabled={pending}
      aria-label={t("switchTo", { language: LOCALE_NAMES[next] })}
      title={t("switchTo", { language: LOCALE_NAMES[next] })}
      onClick={() => start(async () => {
        try {
          await setLocale(next);
        } catch {
          toast.error(unreachable);
          return;
        }
        router.refresh();
      })}
    >
      <Languages aria-hidden />
      {withName ? <span>{LOCALE_NAMES[next]}</span> : <span className="lang-code" aria-hidden>{next.toUpperCase()}</span>}
    </button>
  );
}
