"use client";

import { useTranslations } from "next-intl";
import { Flag, MoreHorizontal, Trash2 } from "lucide-react";
import { createContext, useContext, useState, useTransition } from "react";
import { toast } from "sonner";
import { removeComment, reportComment } from "@/app/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Account, COMMENT_REPORT_REASONS, type CommentReportReason } from "@/lib/data/types";
import { useAccount } from "@/lib/use-account";

type Viewer = { account: Account | null; checking: boolean };
const ViewerContext = createContext<Viewer>({ account: null, checking: true });

/** One account lookup for the whole comments section, not one for each comment. */
export function CommentsViewer({ children }: { children: React.ReactNode }) {
  const [account, , checking] = useAccount();
  return <ViewerContext value={{ account, checking }}>{children}</ViewerContext>;
}

export const useViewer = () => useContext(ViewerContext);

/**
 * A comment's menu: Remove, for the comment's writer, the look's author and moderators;
 * Report, for anyone else signed in. The database decides either way. Each opens a
 * dialog, so a narrow column never has to fit a question and its answers on one line.
 */
export function CommentActions({ id, outfitId, writerId, lookAuthorId }: {
  id: string;
  outfitId: string;
  writerId: string;
  lookAuthorId: string | null;
}) {
  const { account } = useViewer();
  const t = useTranslations("comments");
  const [open, setOpen] = useState<"remove" | "report" | null>(null);
  if (!account) return null;
  const canRemove = account.moderator || account.id === writerId || account.id === lookAuthorId;
  const canReport = account.id !== writerId;
  if (!canRemove && !canReport) return null;
  const close = (next: boolean) => !next && setOpen(null);

  return (
    <>
      <DropdownMenu modal={false}>
        {/* Shown on hover or focus where there is a pointer, always on a touch screen. */}
        <DropdownMenuTrigger
          aria-label={t("options")}
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-faint opacity-0 transition hover:bg-surface-raised hover:text-ink focus-visible:opacity-100 group-hover/comment:opacity-100 data-[state=open]:bg-surface-raised data-[state=open]:text-ink data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-36">
          {canReport && (
            <DropdownMenuItem onSelect={() => setOpen("report")}>
              <Flag aria-hidden />{t("report")}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <DropdownMenuItem onSelect={() => setOpen("remove")} className="text-bad focus:text-bad">
              <Trash2 aria-hidden />{t("removeShort")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canRemove && <RemoveComment id={id} outfitId={outfitId} open={open === "remove"} onOpenChange={close} />}
      {canReport && <ReportComment id={id} open={open === "report"} onOpenChange={close} />}
    </>
  );
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Asks once: a removed comment is gone for everyone. */
function RemoveComment({ id, outfitId, open, onOpenChange }: { id: string; outfitId: string } & DialogProps) {
  const t = useTranslations("comments");
  const [removing, startRemoving] = useTransition();

  function remove() {
    startRemoving(async () => {
      const r = await removeComment(id, outfitId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(t("removed"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-line bg-surface p-6">
        <DialogHeader>
          <DialogTitle>{t("removeTitle")}</DialogTitle>
          <DialogDescription>{t("removeBody")}</DialogDescription>
        </DialogHeader>
        <button type="button" className="btn btn--primary btn--block" disabled={removing} onClick={remove}>
          {removing ? t("removing") : t("remove")}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ReportComment({ id, open, onOpenChange }: { id: string } & DialogProps) {
  const t = useTranslations("comments");
  const tl = useTranslations("lookMenu");
  const tr = useTranslations("commentReportReason");
  const [reason, setReason] = useState<CommentReportReason | null>(null);
  const [sending, startSending] = useTransition();

  function send() {
    if (!reason) return;
    startSending(async () => {
      const r = await reportComment(id, reason);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(tl("reported"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-line bg-surface p-6">
        <DialogHeader>
          <DialogTitle>{t("reportTitle")}</DialogTitle>
          <DialogDescription>{t("reportBody")}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{tl("reason")}</legend>
          {(Object.keys(COMMENT_REPORT_REASONS) as CommentReportReason[]).map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim has-checked:text-ink">
              <input type="radio" name="comment-reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
              {tr(key)}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn--primary btn--block" disabled={!reason || sending} onClick={send}>
          {sending ? tl("sending") : tl("send")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
