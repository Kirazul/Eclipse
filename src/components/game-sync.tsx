"use client";

import { useTranslations } from "next-intl";
import { Loader2, MoreHorizontal, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createGameLinkCode, removeGameSet, unlinkGame } from "@/app/actions";
import { reach } from "@/lib/reach";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Issues a code for the game to trade for its token. The code is shown once. */
export function LinkGame() {
  const t = useTranslations("gameSync");
  const [code, setCode] = useState<string | null>(null);
  const [creating, startCreating] = useTransition();
  const unreachable = useTranslations("layout")("unreachable");

  function create() {
    startCreating(async () => {
      const r = await reach(createGameLinkCode, unreachable);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setCode(r.value.code);
    });
  }

  if (!code) {
    return (
      <Button type="button" variant="outline" disabled={creating} onClick={create}>
        {creating && <Loader2 className="animate-spin" aria-hidden="true" />}
        {t("link")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-raised p-4">
      <p className="font-mono text-2xl tracking-[0.15em] text-ink">{code}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-dim">
        <li>{t("step1")}</li>
        <li>{t("step2")}</li>
      </ol>
      <p className="text-xs text-ink-faint">{t("once")}</p>
      <CopyButton
        code={code}
        variant="outline"
        className="self-start"
        toastHint={t("pasteHint")}
      />
    </div>
  );
}

export function UnlinkGame({ id }: { id: string }) {
  const t = useTranslations("gameSync");
  const [unlinking, startUnlinking] = useTransition();
  const unreachable = useTranslations("layout")("unreachable");
  const router = useRouter();

  function unlink() {
    startUnlinking(async () => {
      const r = await reach(() => unlinkGame(id), unreachable);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t("unlinked"), { description: t("unlinkedHint") });
      router.refresh();
    });
  }

  return (
    <button type="button" className="pill" disabled={unlinking} onClick={unlink}>
      {t("unlink")}
    </button>
  );
}

export function RemoveGameSet({ id, name, after }: { id: string; name: string; after?: string }) {
  const t = useTranslations("gameSync");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label={t("remove", { name })} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
      </Button>
      <RemoveGameSetDialog id={id} name={name} after={after} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** A saved loadout's ⋯ menu on the Loadouts page: Publish it, or remove it. */
export function GameSetMenu({ id, name }: { id: string; name: string }) {
  const t = useTranslations("gameSync");
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t("more", { name })}
          title={t("moreShort")}
          className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-ink-dim transition-colors hover:border-line-strong hover:text-ink data-[state=open]:border-line-strong data-[state=open]:bg-surface-raised data-[state=open]:text-ink"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem asChild>
            <Link href={`/sets/${id}`}><Upload aria-hidden />{t("publish")}</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setRemoving(true)} className="text-bad focus:text-bad">
            <Trash2 aria-hidden />{t("removeShort")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RemoveGameSetDialog id={id} name={name} open={removing} onOpenChange={setRemoving} />
    </>
  );
}

function RemoveGameSetDialog({ id, name, after, open, onOpenChange }: {
  id: string;
  name: string;
  after?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("gameSync");
  const [removing, startRemoving] = useTransition();
  const unreachable = useTranslations("layout")("unreachable");
  const router = useRouter();

  function remove() {
    startRemoving(async () => {
      const r = await reach(() => removeGameSet(id), unreachable);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      onOpenChange(false);
      toast.success(t("removed"));
      if (after) router.push(after);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 border-line bg-surface p-6">
        <DialogHeader>
          <DialogTitle>{t("removeTitle", { name })}</DialogTitle>
          <DialogDescription>{t("removeBody")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("keep")}</Button>
          <Button type="button" variant="destructive" disabled={removing} onClick={remove}>
            {removing && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t("removeShort")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
