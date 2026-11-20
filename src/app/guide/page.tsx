import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { HELP_IDS, helpParts } from "@/lib/help";
import { pageMetadata } from "@/lib/seo";
import { DISCORD_URL } from "@/lib/site";

export const metadata: Metadata = pageMetadata("/guide");

const STEPS = ["files", "start", "wear", "color", "share"] as const;
const TRAVELS = ["slots", "sheathe", "morph", "race", "colours"] as const;

export default function GuidePage() {
  const t = useTranslations("guide");
  const th = useTranslations("help");
  return (
    <main id="main" className="wrap flex flex-col gap-10 py-10">
      <div>
        <h1 className="text-3xl leading-tight">{t("title")}</h1>
        <p className="text-sm text-ink-dim">{t("lead")}</p>
      </div>

      <ol className="flex flex-col">
        {STEPS.map((s, i) => (
          <li key={s} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-line py-4 first:pt-0 last:border-0">
            <span className="nums font-mono text-sm text-amber">{i + 1}</span>
            <div>
              <h2 className="text-base">{t(`steps.${s}.title`)}</h2>
              <p className="max-w-prose text-sm text-ink-dim">{t(`steps.${s}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="sync" className="rounded-md border border-line bg-surface p-5">
        <h2 id="sync" className="text-xl">{t("syncTitle")}</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-dim">
          {t("syncBody")}
        </p>
        <h3 className="mt-4 text-sm">{t("carries")}</h3>
        <ul className="mt-1 list-disc pl-5 text-sm text-ink-dim">
          {TRAVELS.map((k) => <li key={k}>{t(`travels.${k}`)}</li>)}
        </ul>
        <p className="mt-3 max-w-prose text-sm text-ink-dim">
          {t("notCarried")}
        </p>
      </section>

      <section aria-labelledby="help">
        <h2 id="help" className="text-xl">{t("helpTitle")}</h2>
        <dl className="mt-2 flex flex-col gap-4">
          {HELP_IDS.map((id) => (
            <div key={id}>
              <dt className="text-sm">{th(`${id}.question`)}</dt>
              <dd className="mt-1 max-w-prose text-sm text-ink-dim">
                {helpParts(th(`${id}.answer`)).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : p.text))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-prose text-sm text-ink-dim">
          {t.rich("stuck", {
            discord: (c) => <a href={DISCORD_URL} target="_blank" rel="noopener" className="text-amber underline underline-offset-2">{c}</a>,
          })}
        </p>
      </section>
      <section aria-labelledby="remove">
        <h2 id="remove" className="text-xl">{t("removeTitle")}</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-dim">
          {t("removeBody")}
        </p>
        <p className="mt-3 text-sm">
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">{t("browse")}</Link>
        </p>
      </section>
    </main>
  );
}
