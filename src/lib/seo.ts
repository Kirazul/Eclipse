import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import en from "@/i18n/messages/en.json";
import { OPEN_GRAPH, SITE_DESCRIPTION, siteUrl } from "@/lib/site";

/**
 * What search results and link previews say about each page. The sitemap lists these too.
 * The English lives in the message file beside the Russian, under `pages`.
 */
const PAGE_KEYS = {
  "/community-gallery": "gallery",
  "/loadouts": "loadouts",
  "/dressing-room": "dressingRoom",
  "/mounts": "mounts",
  "/guide": "guide",
  "/privacy": "privacy",
} as const;

export type PagePath = keyof typeof PAGE_KEYS;

export const PAGES = Object.fromEntries(
  Object.entries(PAGE_KEYS).map(([path, key]) => [path, en.pages[key]]),
) as Record<PagePath, { title: string; description: string }>;

/**
 * The canonical is the bare path, so a filtered or paged address such as
 * /community-gallery?class=Mage counts towards the page instead of competing with it.
 */
export function pageMetadata(path: PagePath): Metadata {
  const { title, description } = PAGES[path];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { ...OPEN_GRAPH, title: `${title} · Eclipse`, description, url: path },
  };
}

/** pageMetadata in the reader's language, for a page's generateMetadata. */
export async function localPageMetadata(path: PagePath): Promise<Metadata> {
  const t = await getTranslations(`pages.${PAGE_KEYS[path]}`);
  const title = t("title");
  const description = t("description");
  const base = pageMetadata(path);
  return { ...base, title, description, openGraph: { ...base.openGraph, title: `${title} · Eclipse`, description } };
}

/**
 * Tells search engines the site's name and what Eclipse is. Goes in a script tag, so
 * "<" is escaped. No rating: structured data must only state what the page can show.
 */
export function siteStructuredData() {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Eclipse", url: `${siteUrl}/` },
      {
        "@type": "SoftwareApplication",
        name: "Eclipse",
        description: SITE_DESCRIPTION,
        url: `${siteUrl}/`,
        applicationCategory: "GameApplication",
        operatingSystem: "Windows",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  }).replace(/</g, "\\u003c");
}
