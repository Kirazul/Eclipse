import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentReportActions } from "@/components/comment-report-actions";
import { repository } from "@/lib/data";
import { COMMENT_REPORT_REASONS, REPORT_REASONS } from "@/lib/data/types";

export const metadata: Metadata = { title: "Reports", robots: { index: false, follow: false } };

/**
 * Looks and comments with reports nobody has reviewed. A look opens on its page, where
 * Dismiss and Delete are; a comment is shown whole, with its answers beside it.
 */
export default async function ModerationPage() {
  const account = await repository.getAccount();
  if (!account?.moderator) notFound();
  const [reported, comments] = await Promise.all([repository.listReports(), repository.listCommentReports()]);
  const t = await getTranslations("moderation");
  const tc = await getTranslations("comments");

  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      <h1 className="text-2xl">{t("title")}</h1>
      <p className="text-sm text-ink-dim">
        {t("lead")}
      </p>
      {reported.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
          {reported.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <Link href={`/community-gallery/${r.id}`} className="flex-1 text-ink underline-offset-2 hover:underline">
                {r.title}
              </Link>
              <span className="nums text-xs text-ink-dim">
                {r.reports} {r.reports === 1 ? "report" : "reports"}
              </span>
              <span className="w-full text-xs text-ink-faint">{r.reasons.map((k) => REPORT_REASONS[k]).join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-dim">
          {t("none")}
        </p>
      )}

      <h2 className="pt-4 text-xl">{t("comments")}</h2>
      {comments.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
          {comments.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 p-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-dim">
                <span className="text-ink">{c.author ?? tc("someone")}</span>
                on
                <Link href={`/community-gallery/${c.outfitId}#comment-${c.id}`} className="text-ink underline-offset-2 hover:underline">
                  {c.title}
                </Link>
                <span className="nums ml-auto text-xs">{c.reports} {c.reports === 1 ? "report" : "reports"}</span>
              </p>
              <blockquote className="border-l-2 border-line pl-3 text-sm break-words whitespace-pre-wrap text-ink-dim">
                {c.body}
              </blockquote>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ink-faint">{c.reasons.map((k) => COMMENT_REPORT_REASONS[k]).join(" · ")}</span>
                <CommentReportActions id={c.id} outfitId={c.outfitId} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-dim">
          {t("noComments")}
        </p>
      )}
    </main>
  );
}
