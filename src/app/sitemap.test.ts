import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const looks = Array.from({ length: 450 }, (_, i) => `look-${i}`);
vi.mock("@/lib/data", () => ({
  repository: {
    sitemapEntries: async () => ({ looks, creators: ["creator-a", "creator-b"] }),
  },
}));

const { default: sitemap } = await import("./sitemap");
const { siteUrl } = await import("@/lib/site");

describe("the sitemap", () => {
  it("lists every public look, not only the top ones", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.filter((u) => u.includes("/community-gallery/"))).toHaveLength(450);
    expect(urls).toContain(`${siteUrl}/community-gallery/look-449`);
  });

  it("lists the page of each creator with a public look", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${siteUrl}/creators/creator-a`);
    expect(urls).toContain(`${siteUrl}/creators/creator-b`);
  });

  it("still lists the site's own pages", async () => {
    expect((await sitemap()).map((e) => e.url)).toContain(`${siteUrl}/`);
  });
});
