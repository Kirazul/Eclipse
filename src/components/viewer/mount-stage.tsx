"use client";

import { useTranslations } from "next-intl";
import type { MountEntry } from "@eclipse/format";
import { ImageDown, UserRound } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ClipPicker } from "@/components/viewer/clip-picker";
import { cn } from "@/lib/utils";
import { art } from "@/lib/viewer/pack";
import { isAbort, useEngine } from "@/lib/viewer/use-engine";

/** The body a rider is, when asked for. */
const RIDER = "human-male";

/** One mount family on an animated stage, its colours under it (after Eclipse's UiMounts.cpp). */
export function MountStage({ mount }: { mount: MountEntry }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useEngine(canvas);
  const t = useTranslations("mounts");
  const [variant, setVariant] = useState(mount.variants[0]!);
  const [rider, setRider] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  // Read by a new colour's load, which must not reload when only the rider changes.
  const riding = useRef(rider);
  riding.current = rider;

  useEffect(() => {
    let wanted = true;
    setStatus("loading");
    (async () => {
      const e = await engine();
      await e.loadModel(variant.id);
      if (riding.current) await e.setRider(RIDER);
      if (wanted) setStatus("ready");
    })().catch((err: unknown) => {
      if (!isAbort(err) && wanted) setStatus("failed");
    });
    return () => {
      wanted = false;
    };
  }, [engine, variant]);

  const toggleRider = () => {
    const next = !rider;
    setRider(next);
    void engine().then((e) => e.setRider(next ? RIDER : null)).catch(() => setRider(!next));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full cursor-grab touch-none overflow-hidden rounded-md border border-line bg-surface active:cursor-grabbing sm:aspect-video">
        <canvas ref={canvas} className="absolute inset-0 size-full" />
        {status !== "ready" && (
          <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ink-dim">
            {status === "loading" ? t("saddling") : t("failed")}
          </p>
        )}
        {status === "ready" && (
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 sm:max-w-sm">
            <ClipPicker />
            <button type="button" className="pill bg-surface/90 px-2.5" aria-pressed={rider} aria-label={t("rider")} title={t("rider")} onClick={toggleRider}>
              <UserRound className="size-4" aria-hidden />
            </button>
            <button type="button" className="pill bg-surface/90 px-2.5" aria-label={t("saveImage")} title={t("saveImage")} onClick={() => void engine().then((e) => e.exportPNG(2, true))}>
              <ImageDown className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg">{variant.name}</h2>
        {mount.variants.length > 1 && <p className="text-xs text-ink-faint">{mount.variants.length} colours</p>}
      </div>
      {mount.variants.length > 1 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("colourList")}>
          {mount.variants.map((v) => {
            const icon = art(v.icon);
            return (
              <li key={v.display}>
                <button
                  type="button"
                  aria-label={v.name}
                  title={v.name}
                  aria-pressed={v === variant}
                  onClick={() => setVariant(v)}
                  className={cn("relative block size-11 overflow-hidden rounded-md border", v === variant ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong")}
                >
                  {icon && <Image src={icon} alt="" fill unoptimized sizes="2.75rem" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
