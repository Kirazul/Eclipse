"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { MAX_ZOOM, panBy, UNZOOMED, zoomAt, type View } from "@/lib/zoom";

const BUTTON =
  "grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10";

/**
 * A screenshot on the whole screen, to look closely: the wheel, a pinch or the + and -
 * buttons zoom toward the pointer, a drag moves the zoomed picture, and a double click
 * goes in or back out. Arrows step through a look's other screenshots.
 */
export function ScreenshotViewer({ images, index, onIndex, title, open, onOpenChange }: {
  images: string[];
  index: number;
  onIndex: (i: number) => void;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shots");
  const [view, setView] = useState<View>(UNZOOMED);
  const stage = useRef<HTMLDivElement | null>(null);
  // Radix mounts the portal a render after `open`, so the wheel listener waits for the element.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  // Every finger or mouse button down on the picture, for drags and pinches.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const count = images.length;

  // Each screenshot opens whole.
  useEffect(() => setView(UNZOOMED), [index, open]);

  /** The stage's size, and a client point measured from its centre. */
  const measure = (clientX: number, clientY: number) => {
    const box = stage.current!.getBoundingClientRect();
    return {
      size: { width: box.width, height: box.height },
      point: { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 },
    };
  };

  // React's onWheel is passive, so it cannot stop the page scrolling under the viewer.
  useEffect(() => {
    const el = stageEl;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { size, point } = measure(e.clientX, e.clientY);
      setView((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.001), point, size));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [stageEl]);

  const zoomCentre = (by: number) => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    setView((v) => zoomAt(v, v.scale * by, { x: 0, y: 0 }, { width: box.width, height: box.height }));
  };

  const step = (by: number) => onIndex((index + by + count) % count);

  function pointerMove(e: React.PointerEvent) {
    const held = pointers.current;
    const last = held.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    if (held.size === 2) {
      // A pinch: the scale follows the fingers' spread, about the point between them.
      const [a, b] = [...held.entries()].map(([id, p]) => (id === e.pointerId ? now : p));
      const [pa, pb] = [...held.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y) / (Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1);
      const { size, point } = measure((a.x + b.x) / 2, (a.y + b.y) / 2);
      setView((v) => zoomAt(v, v.scale * spread, point, size));
    } else if (held.size === 1) {
      const { size } = measure(0, 0);
      setView((v) => panBy(v, { x: now.x - last.x, y: now.y - last.y }, size));
    }
    held.set(e.pointerId, now);
  }

  const release = (e: React.PointerEvent) => pointers.current.delete(e.pointerId);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none"
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (count > 1 && e.key === "ArrowRight") step(1);
            if (count > 1 && e.key === "ArrowLeft") step(-1);
            if (e.key === "+" || e.key === "=") zoomCentre(1.5);
            if (e.key === "-") zoomCentre(1 / 1.5);
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {count > 1 ? t("nth", { title, index: index + 1, count }) : t("one", { title })}
          </DialogPrimitive.Title>

          <div
            ref={(el) => {
              stage.current = el;
              setStageEl(el);
            }}
            className={`relative min-h-0 flex-1 touch-none overflow-hidden select-none ${view.scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            }}
            onPointerMove={pointerMove}
            onPointerUp={release}
            onPointerCancel={release}
            onDoubleClick={(e) => {
              const { size, point } = measure(e.clientX, e.clientY);
              setView((v) => (v.scale > 1 ? UNZOOMED : zoomAt(v, 2.5, point, size)));
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- full size, already stored compressed */}
            <img
              src={images[index]}
              alt=""
              draggable={false}
              className="absolute inset-0 size-full object-contain will-change-transform"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transition: pointers.current.size ? "none" : "transform 120ms ease-out",
              }}
            />
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-3">
            <p className="nums pointer-events-auto rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">
              {count > 1 ? `${index + 1} / ${count}` : title}
            </p>
            <div className="pointer-events-auto flex items-center gap-2">
              <button type="button" className={BUTTON} aria-label={t("zoomOut")} disabled={view.scale <= 1} onClick={() => zoomCentre(1 / 1.5)}>
                <Minus className="size-4" aria-hidden />
              </button>
              <span className="nums w-11 text-center text-xs text-white/80">{Math.round(view.scale * 100)}%</span>
              <button type="button" className={BUTTON} aria-label={t("zoomIn")} disabled={view.scale >= MAX_ZOOM} onClick={() => zoomCentre(1.5)}>
                <Plus className="size-4" aria-hidden />
              </button>
              <DialogPrimitive.Close className={`${BUTTON} ml-2`} aria-label={t("close")}>
                <X className="size-4" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </div>

          {count > 1 && (
            <>
              <button type="button" aria-label={t("previous")} onClick={() => step(-1)} className={`${BUTTON} absolute top-1/2 left-3 -translate-y-1/2`}>
                <ChevronLeft className="size-5" aria-hidden />
              </button>
              <button type="button" aria-label={t("next")} onClick={() => step(1)} className={`${BUTTON} absolute top-1/2 right-3 -translate-y-1/2`}>
                <ChevronRight className="size-5" aria-hidden />
              </button>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
