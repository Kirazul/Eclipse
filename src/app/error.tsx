"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("error");
  return (
    <main id="main" className="wrap flex flex-col items-start gap-3 py-20">
      <h1 className="text-3xl">{t("title")}</h1>
      <p className="text-sm text-ink-dim">{t("body")}</p>
      <Button size="sm" onClick={reset}>{t("retry")}</Button>
    </main>
  );
}
