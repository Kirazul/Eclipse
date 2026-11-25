import type { MetadataRoute } from "next";
import { repository } from "@/lib/data";
import { PAGES } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { looks, creators } = await repository.sitemapEntries();
  return [
    { url: `${siteUrl}/` },
    ...Object.keys(PAGES).map((path) => ({ url: `${siteUrl}${path}` })),
    ...looks.map((id) => ({ url: `${siteUrl}/community-gallery/${id}` })),
    ...creators.map((id) => ({ url: `${siteUrl}/creators/${id}` })),
  ];
}
