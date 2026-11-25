"use client";

import { useTranslations } from "next-intl";
import { Box, Images } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useState } from "react";
import { PreviewNotice } from "@/components/preview-notice";
import { StudioGallery } from "@/components/studio/studio-gallery";
import type { Wearer } from "@/lib/viewer/figure";

function Loading3d() {
  const t = useTranslations("shots");
  return <div className="mx-auto aspect-[3/4] w-full max-w-sm animate-pulse rounded-md bg-surface" aria-label={t("loading3d")} />;
}

// The figure's code and the models it streams load only once a visitor asks for them.
const ModelStage = dynamic(() => import("@/components/model-stage").then((m) => m.ModelStage), {
  ssr: false,
  loading: () => <Loading3d />,
});

/** The share of a look's pieces the packs must hold before the 3D preview is offered. */
export const SHOWN_SHARE = 0.7;

const toggle = "inline-flex items-center gap-1.5 text-xs text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline";

/**
 * A look as the game drew it: its studio screenshots first. The 3D figure is one click away,
 * because it is slow to load and spends the viewer's pack host, and it only offers itself when
 * it would show the look: at least {@link SHOWN_SHARE} of its pieces baked, or no pieces at all
 * and the look's own body. A stand-in missing most of a code's pieces would show a look that is
 * not there.
 */
export function LookModel({ pieces, wearer, gallery, backdrop, title }: {
  pieces: Record<number, number | null>;
  wearer: Wearer | null;
  gallery: string[];
  backdrop: string;
  title: string;
}) {
  const t = useTranslations("shots");
  const [figure, setFigure] = useState(false);
  const displays = Object.values(pieces);
  const baked = displays.filter(Boolean).length;
  const drawable = displays.length ? baked / displays.length >= SHOWN_SHARE : wearer !== null;
  const incomplete = displays.some((display) => display === null);

  if (figure && drawable) {
    return (
      <div className="flex flex-col gap-3">
        <div className="mx-auto w-full max-w-sm">
          <ModelStage pieces={pieces} wearer={wearer} />
        </div>
        <PreviewNotice
          advice={gallery.length > 0 ? t("advice") : undefined}
          compact
          className="mx-auto w-full max-w-sm"
        />
        {gallery.length > 0 && (
          <button type="button" className={`${toggle} self-center`} onClick={() => setFigure(false)}>
            <Images className="size-3.5" aria-hidden />
            {t("showShots")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {gallery.length ? (
        <StudioGallery images={gallery} title={title} />
      ) : (
        <div className="gallery__frame">
          <Image src={backdrop} alt="" fill unoptimized sizes="(min-width: 1024px) 40rem, 100vw" className="object-cover opacity-60" />
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12 text-center text-sm text-ink-dim">
            {drawable
              ? t("noShot")
              : t("noShotNo3d")}
          </p>
        </div>
      )}
      {drawable && (
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
          <button type="button" className={toggle} onClick={() => setFigure(true)}>
            <Box className="size-3.5" aria-hidden />
            {t("show3d")}
          </button>
          {incomplete && <span className="text-xs text-ink-faint">{t("incomplete")}</span>}
        </p>
      )}
    </div>
  );
}
