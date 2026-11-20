"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { ScreenshotViewer } from "@/components/studio/screenshot-viewer";
import { thumbOf } from "@/lib/screenshots";

const SIZES = "(min-width: 1024px) 40rem, 100vw";

/**
 * The look's studio captures, one at a time and never cropped: captures come in any shape
 * (the game's studio is near square, a desktop screenshot is wide), so each is shown whole
 * over a blurred copy of itself.
 */
export function StudioGallery({ images, title }: { images: string[]; title: string }) {
  const t = useTranslations("shots");
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const count = images.length;
  const step = (by: number) => setIndex((i) => (i + by + count) % count);
  const src = images[index];

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={t("of", { title })}
      tabIndex={count > 1 ? 0 : undefined}
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <div className="gallery__frame">
        <Image src={src} alt="" aria-hidden fill unoptimized sizes={SIZES} className="gallery__fill" />
        <Image
          src={src}
          alt={count > 1 ? t("nth", { title, index: index + 1, count }) : t("one", { title })}
          fill
          unoptimized
          priority
          sizes={SIZES}
          className="object-contain"
        />
        {/* The whole picture opens it full screen, to zoom in; the arrows sit above it. */}
        <button
          type="button"
          aria-label={t("fullScreen")}
          className="absolute inset-0 cursor-zoom-in"
          onClick={() => setZoomed(true)}
        />
        <span aria-hidden className="gallery__nav pointer-events-none" style={{ top: "0.5rem", right: "0.5rem", transform: "none" }}>
          <Maximize2 className="size-3.5" />
        </span>
        {count > 1 && (
          <>
            <button type="button" aria-label={t("previous")} onClick={() => step(-1)} className="gallery__nav left-2">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" aria-label={t("next")} onClick={() => step(1)} className="gallery__nav right-2">
              <ChevronRight className="size-4" />
            </button>
          </>
        )}
      </div>
      <ScreenshotViewer images={images} index={index} onIndex={setIndex} title={title} open={zoomed} onOpenChange={setZoomed} />
      {count > 1 && (
        <div className="gallery__thumbs">
          {images.map((image, i) => (
            <button
              key={image}
              type="button"
              className="gallery__thumb"
              aria-label={t("show", { index: i + 1 })}
              aria-current={i === index}
              onClick={() => setIndex(i)}
            >
              <Image src={thumbOf(image)} alt="" fill unoptimized sizes="4rem" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
