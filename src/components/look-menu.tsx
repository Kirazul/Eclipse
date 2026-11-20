"use client";

import { Bookmark, Eye, EyeOff, Flag, MoreHorizontal, Shirt, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bookmarkLook, deleteLook, reportLook, setLookPrivate } from "@/app/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { REPORT_REASONS, type ReportReason } from "@/lib/data/types";
import { useAccount } from "@/lib/use-account";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  authorId: string | null;
  /** A player's look (published here or shared on Discord), not one of the game's own sets. */
  community: boolean;
  isPrivate: boolean;
  /** Whether the viewer has bookmarked it; leave out to offer no Save. */
  saved?: boolean;
  /** The Dressing room link, when the look wears something it can dress. */
  dressingRoom?: string;
  /** Where to go after a delete. Without it the current page refreshes. */
  afterDelete?: string;
  className?: string;
};

/**
 * Everything to do with a look besides using it, behind one ⋯ button: Save, Open in
 * Dressing room, Set to private or public, Report and Delete. Each item shows only to
 * whoever may use it; the database decides either way.
 */
export function LookMenu({ id, authorId, community, isPrivate, saved: initialSaved, dressingRoom, afterDelete, className }: Props) {
  const t = useTranslations("lookMenu");
  const [account] = useAccount();
  const [open, setOpen] = useState<"delete" | "report" | null>(null);
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [busy, startBusy] = useTransition();
  const router = useRouter();

  const isAuthor = Boolean(account && authorId && account.id === authorId);
  const canSave = initialSaved !== undefined;
  const canToggle = isAuthor;
  const canReport = Boolean(account && community && !isAuthor);
  const canDelete = Boolean(account && community && (account.moderator || isAuthor));
  if (!canSave && !dressingRoom && !canToggle && !canReport && !canDelete) return null;
  const close = (next: boolean) => !next && setOpen(null);

  function save() {
    const next = !saved;
    startBusy(async () => {
      const r = await bookmarkLook(id, next);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSaved(next);
      toast.success(next ? t("saved") : t("unsaved"));
    });
  }

  function toggle() {
    startBusy(async () => {
      const r = await setLookPrivate(id, !isPrivate);
      if (!r.ok) {
        const existing = "existing" in r ? r.existing : undefined;
        toast.error(r.error, existing ? { action: { label: t("openIt"), onClick: () => router.push(`/community-gallery/${existing}`) } } : undefined);
        return;
      }
      toast.success(r.value ? t("nowPrivate") : t("nowPublic"));
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t("more")}
          title={t("more")}
          disabled={busy}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-dim transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:bg-surface-raised data-[state=open]:text-ink",
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {canSave && (
            <DropdownMenuItem onSelect={save}>
              <Bookmark aria-hidden fill={saved ? "currentColor" : "none"} className={saved ? "text-amber" : undefined} />
              {saved ? t("unsave") : t("save")}
            </DropdownMenuItem>
          )}
          {dressingRoom && (
            <DropdownMenuItem asChild>
              <Link href={dressingRoom}><Shirt aria-hidden />{t("dressingRoom")}</Link>
            </DropdownMenuItem>
          )}
          {canToggle && (
            <DropdownMenuItem onSelect={toggle}>
              {isPrivate ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              {isPrivate ? t("setPublic") : t("setPrivate")}
            </DropdownMenuItem>
          )}
          {(canReport || canDelete) && (canSave || dressingRoom || canToggle) && <DropdownMenuSeparator />}
          {canReport && (
            <DropdownMenuItem onSelect={() => setOpen("report")}>
              <Flag aria-hidden />Report
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem onSelect={() => setOpen("delete")} className="text-bad focus:text-bad">
              <Trash2 aria-hidden />Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && <DeleteLook id={id} after={afterDelete} open={open === "delete"} onOpenChange={close} />}
      {canReport && <ReportLook id={id} open={open === "report"} onOpenChange={close} />}
    </>
  );
}

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Asks once: a deleted look and its screenshots are gone for everyone. */
function DeleteLook({ id, after, open, onOpenChange }: { id: string; after?: string } & DialogProps) {
  const t = useTranslations("lookMenu");
  const [deleting, startDeleting] = useTransition();
  const router = useRouter();

  function remove() {
    startDeleting(async () => {
      const r = await deleteLook(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(t("deleted"));
      if (after) router.push(after);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-line bg-surface p-6">
        <DialogHeader>
          <DialogTitle>{t("deleteTitle")}</DialogTitle>
          <DialogDescription>
            {t("deleteBody")}
          </DialogDescription>
        </DialogHeader>
        <button type="button" className="btn btn--primary btn--block" disabled={deleting} onClick={remove}>
          {deleting ? t("deleting") : t("delete")}
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Moderators see every report and decide what happens. */
function ReportLook({ id, open, onOpenChange }: { id: string } & DialogProps) {
  const t = useTranslations("lookMenu");
  const tr = useTranslations("reportReason");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [sending, startSending] = useTransition();

  function send() {
    if (!reason) return;
    startSending(async () => {
      const r = await reportLook(id, reason);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(t("reported"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-line bg-surface p-6">
        <DialogHeader>
          <DialogTitle>{t("reportTitle")}</DialogTitle>
          <DialogDescription>
            {t("reportBody")}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t("reason")}</legend>
          {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim has-checked:text-ink">
              <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
              {tr(key)}
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn--primary btn--block" disabled={!reason || sending} onClick={send}>
          {sending ? t("sending") : t("send")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
