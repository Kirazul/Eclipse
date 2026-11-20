import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/site/icons";
import { linkedRolesConfigured } from "@/lib/linked-roles";

export const metadata: Metadata = { title: "Discord roles", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ status?: string }> };

const NOTES = { ok: "ok", "no-account": "noAccount", failed: "failed", off: "off" } as const;

/** Where Discord sends a player back after connecting, and where they can connect again. */
export default async function LinkedRolesPage({ searchParams }: Props) {
  const t = await getTranslations("linkedRoles");
  const { status } = await searchParams;
  const note = status && status in NOTES ? NOTES[status as keyof typeof NOTES] : null;
  const on = linkedRolesConfigured();

  return (
    <main id="main" className="wrap flex max-w-2xl flex-col gap-5 py-10">
      <h1 className="text-3xl leading-tight">{t("title")}</h1>
      {note && (
        <p role="status" className={`rounded-md border px-4 py-3 text-sm ${note === "ok" ? "border-good/40 text-ink" : "border-line text-ink-dim"}`}>
          {t(note)}
        </p>
      )}
      <p className="text-sm text-ink-dim">{t("lead")}</p>
      {on ? (
        // A plain link: the route answers with a redirect to Discord, not a page.
        <a className="btn btn--primary self-start" href="/api/discord/linked-roles">
          <Icon id="i-discord" />
          <span>{t("connect")}</span>
        </a>
      ) : (
        !note && <p className="text-sm text-ink-faint">{t("off")}</p>
      )}
      <p className="text-xs text-ink-faint">{t("shares")}</p>
    </main>
  );
}
