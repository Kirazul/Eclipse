"use client";

import { useTranslations } from "next-intl";
import { Loader2, MoreHorizontal, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { createGameLinkCode, publishGameSets, removeGameSet, unlinkGame } from "@/app/actions";
import type { SetOutcome } from "@/lib/publish-sets";
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

/** A ready set's row, with what the server drew of it: its pictures, name and count. */
export interface ReadyRow {
  id: string;
  name: string;
  preview: ReactNode;
}

type Refused = Extract<SetOutcome, { ok: false }>;

/**
 * The sets waiting with the game's pictures, each published as it is with one press, or
 * several chosen and published together. Either way every set goes down the publish form's
 * own path on the server, and nothing is chosen until the player chooses it. Edit first
 * opens that form for anyone who wants to change something before the look goes public.
 */
export function PublishReadySets({ rows }: { rows: ReadyRow[] }) {
  const t = useTranslations("loadouts");
  const td = useTranslations("decoder");
  const unreachable = useTranslations("layout")("unreachable");
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState<string[]>([]);
  const [refused, setRefused] = useState<Record<string, Refused>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A set published since is gone from the rows, and so from the choice.
  const chosen = picked.filter((id) => rows.some((row) => row.id === id));
  const many = rows.length > 1;
  const allChosen = chosen.length === rows.length;

  function choose(id: string, on: boolean) {
    setPicked((was) => (on ? [...was, id] : was.filter((x) => x !== id)));
  }

  function publish(ids: string[]) {
    setSending(ids);
    setSummary(null);
    start(async () => {
      const r = await reach(() => publishGameSets(ids), unreachable);
      setSending([]);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const { outcomes, stoppedBy } = r.value;
      const done = outcomes.filter((o) => o.ok).length;
      const failed = outcomes.filter((o): o is Refused => !o.ok);
      setRefused((was) => {
        const next = { ...was };
        for (const id of ids) delete next[id];
        for (const o of failed) next[o.setId] = o;
        // One set stopped by the limit says why under itself, as any refusal does.
        if (stoppedBy && ids.length === 1) next[ids[0]] = { setId: ids[0], name: "", ok: false, error: stoppedBy };
        return next;
      });
      if (done > 0) router.refresh();
      if (ids.length === 1) {
        if (done) toast.success(td("published"));
        else toast.error(stoppedBy ?? failed[0]?.error ?? unreachable);
        return;
      }
      if (done === ids.length) {
        toast.success(t("publishedAll", { count: done }));
        return;
      }
      const said = stoppedBy
        ? t("publishStopped", { published: done, total: ids.length, reason: stoppedBy })
        : t("publishedSome", { published: done, total: ids.length });
      setSummary(said);
      toast.warning(said);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => {
          const why = refused[row.id];
          return (
            <li key={row.id} className="flex flex-wrap items-center gap-3">
              {many && (
                <input
                  type="checkbox"
                  aria-label={t("choose", { name: row.name })}
                  checked={chosen.includes(row.id)}
                  disabled={pending}
                  onChange={(e) => choose(row.id, e.target.checked)}
                  className="size-4 accent-amber"
                />
              )}
              {row.preview}
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/sets/${row.id}`}>{t("editFirst")}</Link>
                </Button>
                <Button type="button" size="sm" disabled={pending} onClick={() => publish([row.id])}>
                  {pending && sending.length === 1 && sending[0] === row.id && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t("publish")}
                </Button>
              </div>
              {why && (
                <p role="alert" className="basis-full text-xs text-bad">
                  {why.error}
                  {why.existing && (
                    <>
                      {" "}
                      <Link href={`/community-gallery/${why.existing}`} className="text-amber underline underline-offset-2">{td("openIt")}</Link>
                    </>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {summary && <p role="status" className="text-xs text-amber">{summary}</p>}
      {many && (
        <div className="flex flex-wrap items-center gap-3 border-t border-amber/20 pt-3">
          <button type="button" className="pill" disabled={pending} onClick={() => setPicked(allChosen ? [] : rows.map((row) => row.id))}>
            {allChosen ? t("chooseNone") : t("chooseAll")}
          </button>
          <Button type="button" size="sm" disabled={pending || chosen.length === 0} onClick={() => publish(chosen)}>
            {pending && sending.length > 1 && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t("publishChosen", { count: chosen.length })}
          </Button>
        </div>
      )}
    </div>
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
