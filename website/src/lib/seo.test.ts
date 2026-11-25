import { describe, expect, it } from "vitest";
import ru from "@/i18n/messages/ru.json";
import { pageMetadata, PAGES, siteStructuredData, type PagePath } from "@/lib/seo";

const paths = Object.keys(PAGES) as PagePath[];
const SUFFIX = " · Eclipse";

describe("what Russian search results show for each page", () => {
  it.each(Object.entries(ru.pages))("%s fits a search result", (_, { title, description }) => {
    expect((title + SUFFIX).length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });
});

describe("what search results show for each page", () => {
  it.each(paths)("%s fits a search result", (path) => {
    const { title, description } = PAGES[path];
    expect((title + SUFFIX).length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("describes every page differently, because duplicates compete with each other", () => {
    const unique = (key: "title" | "description") => new Set(paths.map((path) => PAGES[path][key])).size;
    expect(unique("title")).toBe(paths.length);
    expect(unique("description")).toBe(paths.length);
  });

  it("names no vendor or location", () => {
    expect(JSON.stringify(PAGES)).not.toMatch(/supabase|vercel|cloudflare|paris|france/i);
  });
});

describe("a page's metadata", () => {
  it("points filtered and paged addresses at the page itself", () => {
    expect(pageMetadata("/community-gallery").alternates?.canonical).toBe("/community-gallery");
  });

  it("previews as that page when its link is shared, not as the home page", () => {
    const { openGraph } = pageMetadata("/community-gallery");
    expect(openGraph?.url).toBe("/community-gallery");
    expect(openGraph?.title).toBe(`${PAGES["/community-gallery"].title}${SUFFIX}`);
    expect(openGraph?.description).toBe(PAGES["/community-gallery"].description);
  });

  it("keeps the shared preview image", () => {
    expect(pageMetadata("/guide").openGraph?.images).toBeDefined();
  });
});

describe("the structured data", () => {
  const graph = () => JSON.parse(siteStructuredData())["@graph"] as Record<string, unknown>[];

  it("names the site and the software", () => {
    expect(graph().map((node) => node["@type"])).toEqual(["WebSite", "SoftwareApplication"]);
    expect(graph()[0]).toMatchObject({ name: "Eclipse" });
  });

  it("says Eclipse is free", () => {
    expect(graph()[1]).toMatchObject({ offers: { "@type": "Offer", price: "0" } });
  });

  it("claims no rating, because nobody has given one", () => {
    expect(siteStructuredData()).not.toMatch(/aggregateRating|"review"/i);
  });

  it("cannot close the script tag it sits in", () => {
    expect(siteStructuredData()).not.toContain("<");
  });
});
