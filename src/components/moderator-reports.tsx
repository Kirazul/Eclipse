"use client";

import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { dismissLookReports, openReportsFor } from "@/app/actions";
import { reach } from "@/lib/reach";
import { REPORT_REASONS, type ReportedLook } from "@/lib/data/types";
import { useAccount } from "@/lib/use-account";

/**
 * A moderator's view of a look's unread reports: how many, why, and Dismiss beside
 * the Delete button. Only fetched for moderators, so visitors cost no request.
 */
export function ModeratorReports({ id }: { id: string }) {
  const t = useTranslations("moderation");
  const [account] = useAccount();
  const [open, setOpen] = useState<ReportedLook | null>(null);
  const [dismissing, start] = useTransition();
  const unreachable = useTranslations("layout")("unreachable");
  const moderator = Boolean(account?.moderator);

  useEffect(() => {
    if (!moderator) return;
    let current = true;
    openReportsFor(id).then((r) => {
      if (current) setOpen(r);
    });
    return () => {
      current = false;
    };
  }, [id, moderator]);

  if (!moderator || !open) return null;

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-3 text-sm text-ink-dim">
      <Flag className="size-4 text-bad" strokeWidth={1.5} aria-hidden />
      <p className="flex-1">
        <span className="nums text-ink">{open.reports} {open.reports === 1 ? "report" : "reports"}</span>
        {": "}
        {open.reasons.map((k) => REPORT_REASONS[k]).join(" · ")}
      </p>
      <button
        type="button"
        className="pill"
        disabled={dismissing}
        onClick={() =>
          start(async () => {
            const r = await reach(() => dismissLookReports(id), unreachable);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            setOpen(null);
            toast.success(t("dismissed"));
          })
        }
      >
        {dismissing ? t("dismissing") : t("dismiss")}
      </button>
    </div>
  );
}
