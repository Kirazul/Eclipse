"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { dismissCommentReports, removeComment } from "@/app/actions";

/** A moderator's two answers to a reported comment. Either takes it off the list. */
export function CommentReportActions({ id, outfitId }: { id: string; outfitId: string }) {
  const t = useTranslations("comments");
  const [busy, start] = useTransition();

  const act = (run: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await run();
      if (!r.ok) {
        toast.error(r.error ?? t("failed"));
        return;
      }
      toast.success(done);
    });

  return (
    <span className="flex items-center gap-2">
      <button type="button" className="pill" disabled={busy} onClick={() => act(() => dismissCommentReports(id), t("dismissed"))}>
        {t("dismiss")}
      </button>
      <button
        type="button"
        className="pill hover:border-bad/50 hover:text-bad"
        disabled={busy}
        onClick={() => act(() => removeComment(id, outfitId), t("removed"))}
      >
        {t("remove")}
      </button>
    </span>
  );
}
