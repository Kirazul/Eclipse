"use client";

import { useTranslations } from "next-intl";
import type { SlotId } from "@eclipse/format";
import { useEffect, useRef, useState } from "react";
import { SLOT_NAMES } from "@/lib/domain";
import { bodyOf, lookTextOf, slotIdOf, wornOf, type Wearer } from "@/lib/viewer/figure";
import { isAbort, useEngine } from "@/lib/viewer/use-engine";

const ALL_SLOTS: SlotId[] = ["head", "shoulder", "back", "chest", "shirt", "tabard", "wrist", "hands", "waist", "legs", "feet", "mainhand", "offhand", "ranged"];
const MORPH_OF = Object.fromEntries(
  Array.from({ length: 19 }, (_, slot) => [slotIdOf(slot), slot]).filter(([id]) => id),
) as Record<SlotId, number>;

/** The look on an animated character. If this fails nothing is lost: the code works without it. */
export function ModelStage({ pieces, wearer, children }: {
  /** Morph slot -> the worn piece's baked display, or null when none is baked. Hidden slots are left out. */
  pieces: Record<number, number | null>;
  /** Null: "your own race", which a human stands in for. */
  wearer: Wearer | null;
  /** Controls drawn over the figure's foot, such as the animation picker. */
  children?: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useEngine(canvas);
  // The body on this engine; a new engine (a remount) has none yet.
  const body = useRef<{ on: object; id: string } | null>(null);
  const t = useTranslations("shots");
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [notShown, setNotShown] = useState<number[]>([]);

  // Compared as text, so a new object holding the same look does not redraw.
  const look = JSON.stringify({ wearer, pieces });

  useEffect(() => {
    let wanted = true;
    const next = JSON.parse(look) as { wearer: Wearer | null; pieces: Record<number, number | null> };
    (async () => {
      const e = await engine();
      const id = bodyOf(next.wearer);
      if (body.current?.on !== e || body.current.id !== id) {
        setStatus("loading");
        await e.loadModel(id, lookTextOf(next.wearer?.line));
        body.current = { on: e, id };
      }
      const worn = new Map(wornOf(next.pieces));
      // A pack that fails to load is not shown either, and the rest still dress.
      const failed: SlotId[] = [];
      await Promise.all(ALL_SLOTS.map((slot) => e.equip(slot, worn.get(slot) ?? null).catch((err: unknown) => {
        if (isAbort(err)) throw err;
        failed.push(slot);
      })));
      if (!wanted) return;
      const missing = [...worn].filter(([slot, id]) => !id || failed.includes(slot)).map(([slot]) => MORPH_OF[slot]);
      setNotShown(missing);
      setStatus("ready");
    })().catch((err: unknown) => {
      if (!isAbort(err) && wanted) setStatus("failed");
    });
    return () => {
      wanted = false;
    };
  }, [look, engine]);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative aspect-[3/4] w-full cursor-grab touch-none overflow-hidden rounded-md active:cursor-grabbing">
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        {status !== "ready" && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ink-dim">
            {status === "loading" ? t("dressing") : t("failed")}
          </p>
        )}
        {children && status === "ready" && <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">{children}</div>}
      </div>
      {notShown.length > 0 && (
        <p className="text-center text-xs text-ink-dim">Not in the preview: {notShown.map((slot) => SLOT_NAMES[slot]).join(", ")}.</p>
      )}
    </div>
  );
}
