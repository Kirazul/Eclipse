import { Info } from "lucide-react";

/** Sets expectations for the 3D figure, wherever one is drawn: it is a guide, not the game. */
export function PreviewNotice({ advice, compact = false, className = "" }: {
  advice?: string;
  /** Smaller type, for under a figure rather than across a page. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-ink-dim ${compact ? "text-xs" : "text-sm"} ${className}`}
    >
      <Info aria-hidden className={`shrink-0 text-ink-faint ${compact ? "mt-px size-3.5" : "mt-0.5 size-4"}`} />
      <span>
        The 3D preview is a close guide, not an exact match. Some pieces may not show up or may look a little
        different than in game.{advice && ` ${advice}`}
      </span>
    </p>
  );
}
