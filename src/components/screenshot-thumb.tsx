"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { preload } from "react-dom";
import { smallOf, thumbOf } from "@/lib/screenshots";

// What next/image's fill draws: the frame around it sets the size.
const FILL: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", color: "transparent" };

/**
 * A screenshot's stored thumbnail at the size the screen needs: the browser takes the 480 px
 * copy where the 960 px one would be wasted, as on a phone's Gallery, and the 960 px one
 * elsewhere. The widths are the long edges, which is right for wide captures and
 * picks a little smaller for tall ones.
 *
 * A picture stored before the small copy existed has none until the backfill
 * (tools/backfill-small-thumbs.mts) has made it, so a small copy that fails to load gives
 * way to the thumbnail, which every picture has.
 *
 * `eager` is for a picture at the top of the page, as next/image's priority: it loads at
 * once, ahead of the rest, and the page's head asks for it before the picture is reached.
 */
export function ScreenshotThumb({
  src,
  sizes,
  alt = "",
  className,
  eager = false,
}: {
  src: string;
  sizes: string;
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  const [small, setSmall] = useState(true);
  const thumb = thumbOf(src);
  const srcSet = `${smallOf(src)} 480w, ${thumb} 960w`;
  if (eager) preload(thumb, { as: "image", imageSrcSet: srcSet, imageSizes: sizes, fetchPriority: "high" });
  // An error before the page came alive fired before onError was listening.
  const settled = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth === 0) setSmall(false);
  }, []);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- stored compressed at both sizes, which srcSet chooses between
    <img
      ref={settled}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      sizes={small ? sizes : undefined}
      srcSet={small ? srcSet : undefined}
      src={thumb}
      onError={() => setSmall(false)}
      className={className}
      style={FILL}
    />
  );
}
