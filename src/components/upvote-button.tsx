"use client";

import { ArrowBigUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { votedLooks, voteOutfit } from "@/app/actions";
import { voteReader } from "@/lib/my-votes";
import { SESSION_COOKIE } from "@/lib/use-account";
import { cn } from "@/lib/utils";

// One reader for the whole page, so every card's button shares one request.
const hasVoted = voteReader(votedLooks, () => SESSION_COOKIE.test(document.cookie));

/** With `hideZero`, as on a card, the count shows once there is one: a row of zeros says nothing. */
export function UpvoteButton({ id, count, className, hideZero = false }: { id: string; count: number; className?: string; hideZero?: boolean }) {
  const t = useTranslations("upvote");
  const locale = useLocale();
  const [voted, setVoted] = useState(false);
  const [shown, setShown] = useState(count);
  // A fresh count from the server, after a revalidation, replaces the one on screen.
  const [given, setGiven] = useState(count);
  if (count !== given) {
    setGiven(count);
    setShown(count);
  }
  // Only the latest click's answer is applied, so fast clicks cannot land out of order.
  const latest = useRef(0);

  useEffect(() => {
    let live = true;
    void hasVoted(id).then((v) => {
      // A click before the answer arrived already says what the visitor wants.
      if (live && latest.current === 0) setVoted(v);
    });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <button
      type="button"
      aria-label={voted ? t("remove", { count: shown }) : t("label", { count: shown })}
      aria-pressed={voted}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const before = { voted, shown };
        const up = !voted;
        const request = ++latest.current;
        setVoted(up);
        setShown((n) => Math.max(n + (up ? 1 : -1), 0));
        void voteOutfit(id, up).then(
          (r) => {
            if (request !== latest.current) return;
            if (r.ok) return setShown(r.value);
            setVoted(before.voted);
            setShown(before.shown);
            toast.error(r.error);
          },
          () => {
            if (request !== latest.current) return;
            setVoted(before.voted);
            setShown(before.shown);
            toast.error(t("failed"));
          },
        );
      }}
      className={cn(
        "nums flex h-8 items-center gap-1 rounded-sm border border-line px-2 text-sm text-ink-dim transition-colors hover:border-line-strong hover:text-ink",
        className,
        // After the caller's classes, so a card's own text colour cannot unlight it.
        voted && "border-amber/60 text-amber hover:border-amber hover:text-amber",
      )}
    >
      <ArrowBigUp className="size-4" strokeWidth={1.5} fill={voted ? "currentColor" : "none"} />
      {(shown > 0 || !hideZero) && shown.toLocaleString(locale)}
    </button>
  );
}
