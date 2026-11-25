"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { iconSources, ringArt } from "@/lib/wow-assets";

function Tries({ sources, size, className }: { sources: string[]; size: number; className?: string }) {
  const [tried, setTried] = useState(0);
  return (
    <Image
      src={sources[Math.min(tried, sources.length - 1)]}
      alt=""
      width={size}
      height={size}
      unoptimized
      loading="lazy"
      onError={() => setTried((t) => t + 1)}
      className={className}
    />
  );
}

/**
 * A game icon, walking its sources until one loads: the baked file, the icon CDN,
 * then the slot's own empty texture. There is no drawn stand-in. Keyed, so a new
 * icon starts over from the best source.
 */
export function ItemIcon({
  icon,
  slot,
  size = 36,
  className,
}: {
  icon: string | null;
  /** The morph slot, for the real texture to fall back to. */
  slot: number;
  size?: number;
  className?: string;
}) {
  return <Tries key={`${icon}:${slot}`} sources={iconSources(icon, slot)} size={size} className={cn("shrink-0", className)} />;
}

/** An icon in Narcissus's hexagon ring, the ring chosen by the item's quality. */
export function ItemRing({
  icon,
  slot,
  quality = null,
  size = 56,
  hidden = false,
  empty = false,
  colour,
}: {
  icon: string | null;
  slot: number;
  quality?: number | null;
  size?: number;
  /** The code hides this slot on purpose: the studio rings that green. */
  hidden?: boolean;
  /** The code leaves this slot to the wearer's own gear. */
  empty?: boolean;
  /** A custom colour on the piece, marked with a dot. */
  colour?: string | null;
}) {
  const ring = hidden ? 2 : quality;
  return (
    <span
      className={cn("hex", ring === null && "hex--plain", empty && "hex--empty")}
      style={{ width: size, height: size }}
    >
      <span className="hex__icon"><ItemIcon icon={hidden ? null : icon} slot={slot} size={size} /></span>
      <Image src={ringArt(ring)} alt="" width={size} height={size} unoptimized className="hex__frame" />
      {colour && <span aria-hidden className="hex__dot" style={{ background: colour }} />}
    </span>
  );
}
