"use client";

import { useTranslations } from "next-intl";
import { Loader2, SendHorizontal } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { postComment } from "@/app/actions";
import { SignInOptions } from "@/components/sign-in-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { COMMENT_MAX } from "@/lib/limits";
import { useViewer } from "@/components/comment-actions";

// The bar under the list, as a social app holds its comment box at the bottom.
const BAR = "shrink-0 border-t border-line p-3";

/**
 * Where a signed-in person adds to a look's comments. The new comment comes back
 * with the page, which the action revalidates, so nothing is drawn twice.
 */
export function CommentForm({ outfitId }: { outfitId: string }) {
  const { account, checking } = useViewer();
  const t = useTranslations("comments");
  const ts = useTranslations("signIn");
  const [text, setText] = useState("");
  const [posting, startPosting] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);

  // Holds the form's place until we know who is here, so nothing jumps.
  if (checking) return <div className={`${BAR} h-[3.85rem]`} aria-hidden />;

  if (!account) {
    return (
      <div className={`${BAR} flex flex-wrap items-center justify-between gap-3`}>
        <p className="text-sm text-ink-dim">{t("signInPrompt")}</p>
        <Dialog>
          <DialogTrigger className="btn btn--ghost btn--sm">{ts("button")}</DialogTrigger>
          <DialogContent className="gap-5 border-line bg-surface p-6">
            <DialogHeader>
              <DialogTitle>{t("signInTitle")}</DialogTitle>
              <DialogDescription>{t("signInBody")}</DialogDescription>
            </DialogHeader>
            <SignInOptions />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const left = COMMENT_MAX - text.length;

  function send() {
    if (!text.trim() || left < 0) return;
    startPosting(async () => {
      const r = await postComment(outfitId, text);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setText("");
      field.current?.blur();
    });
  }

  return (
    <form
      className={`${BAR} flex flex-col gap-1`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="flex items-end gap-2 rounded-2xl border border-transparent bg-surface-raised py-1.5 pr-1.5 pl-3.5 focus-within:border-line-strong">
        <label htmlFor="comment-body" className="sr-only">{t("write")}</label>
        <textarea
          ref={field}
          id="comment-body"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, as in a chat; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={COMMENT_MAX + 100}
          placeholder={account.name ? t("commentAs", { name: account.name }) : t("write")}
          className="field-sizing-content max-h-32 min-h-[1.75rem] flex-1 resize-none self-center bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="submit"
          aria-label={t("post")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-amber transition-colors hover:bg-surface-high disabled:text-ink-faint disabled:hover:bg-transparent"
          disabled={posting || !text.trim() || left < 0}
        >
          {posting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <SendHorizontal className="size-4" strokeWidth={1.75} aria-hidden />}
        </button>
      </div>
      {left < 80 && (
        <span className={`nums self-end px-2 text-xs ${left < 0 ? "text-bad" : "text-ink-faint"}`} aria-live="polite">{left}</span>
      )}
    </form>
  );
}
