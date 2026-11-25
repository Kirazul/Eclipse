"use client";

import type { ViewerEngine } from "@eclipse/engine";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { PACK_BASE } from "@/lib/viewer/pack";
import { $engine } from "@/lib/viewer/state";

/**
 * The 3D engine on this canvas, created on first ask and disposed with the component.
 * three.js and the engine are heavy and only a figure needs them, so they load then.
 */
export function useEngine(canvas: RefObject<HTMLCanvasElement | null>): () => Promise<ViewerEngine> {
  const engine = useRef<Promise<ViewerEngine> | null>(null);

  useEffect(() => () => {
    void engine.current?.then((e) => {
      if ($engine.get() === e) $engine.set(null);
      e.dispose();
    }, () => {});
    engine.current = null;
  }, []);

  return useCallback(() => {
    engine.current ??= import("@eclipse/engine").then(async ({ createEngine }) => {
      // The figure can close while the engine downloads, as a skimmed drawer does: build nothing then.
      const target = canvas.current;
      if (!target) throw new DOMException("The figure closed before its engine loaded", "AbortError");
      const e = createEngine({
        packBase: PACK_BASE,
        interactable: true,
        animated: !matchMedia("(prefers-reduced-motion: reduce)").matches,
        cameraStyle: innerWidth < 768 ? "mobile" : "default",
        shadow: true,
        shortcuts: false,
        lockCamera: false,
      });
      await e.mount(target);
      $engine.set(e);
      return e;
    });
    return engine.current;
  }, [canvas]);
}

/** A newer load superseded this one: it answers instead. */
export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";
