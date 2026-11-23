import type { Metadata } from "next";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { localPageMetadata } from "@/lib/seo";
import { DISCORD_URL } from "@/lib/site";

export function generateMetadata(): Promise<Metadata> {
  return localPageMetadata("/privacy");
}

const UPDATED = "2026-11-22";

/** Each section and how many points it has, in src/i18n/messages (privacy.sections). */
const SECTIONS = [
  ["visiting", 5], ["account", 6], ["game", 4], ["updates", 1], ["public", 5], ["services", 6], ["control", 6],
] as const;

export default function PrivacyPage() {
  const t = useTranslations("privacy");
  const date = new Date(`${UPDATED}T12:00:00Z`).toLocaleDateString(useLocale(), { year: "numeric", month: "long", day: "numeric" });
  return (
    <main id="main" className="wrap flex flex-col gap-10 py-10">
      <div>
        <h1 className="text-3xl leading-tight">{t("title")}</h1>
        <p className="max-w-prose text-sm text-ink-dim">
          {t("lead", { date })}
        </p>
      </div>

      {SECTIONS.map(([id, points]) => (
        <section key={id} aria-labelledby={id}>
          <h2 id={id} className="text-xl">{t(`sections.${id}.title`)}</h2>
          <ul className="mt-2 flex max-w-prose list-disc flex-col gap-1.5 pl-5 text-sm text-ink-dim">
            {Array.from({ length: points }, (_, i) => (
              <li key={i}>{t(`sections.${id}.points.p${i + 1}` as never)}</li>
            ))}
          </ul>
        </section>
      ))}

      <section aria-labelledby="contact" className="rounded-md border border-line bg-surface p-5">
        <h2 id="contact" className="text-xl">{t("questions")}</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-dim">
          {t.rich("contact", {
            discord: (c) => <a href={DISCORD_URL} target="_blank" rel="noopener" className="text-amber underline underline-offset-2">{c}</a>,
            guide: (c) => <Link href="/guide" className="text-amber underline underline-offset-2">{c}</Link>,
          })}
        </p>
      </section>
    </main>
  );
}
