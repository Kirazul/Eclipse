"use client";

import { Analytics } from "@vercel/analytics/next";
import { countedAddress } from "@/lib/counted-address";

/** Counts page views, without cookies and without what follows the page in its address. */
export function SiteAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: countedAddress(event.url) })} />;
}
