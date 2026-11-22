"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that fetches its page once someone reaches for it, rather than when it scrolls
 * into view. For long lists: every page is drawn per visitor, so a list that prefetches
 * asks the server for a page per link, and nobody opens most of them.
 */
export function HoverLink(props: Omit<ComponentProps<typeof Link>, "prefetch" | "onMouseEnter" | "onTouchStart" | "onFocus">) {
  const [near, setNear] = useState(false);
  const reach = () => setNear(true);
  // null is Next's default: prefetch now that it is wanted.
  return <Link {...props} prefetch={near ? null : false} onMouseEnter={reach} onTouchStart={reach} onFocus={reach} />;
}
