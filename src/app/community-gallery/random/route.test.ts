import { beforeEach, describe, expect, it, vi } from "vitest";

const sitemapEntries = vi.fn();
vi.mock("@/lib/data", () => ({ repository: { sitemapEntries: () => sitemapEntries() } }));

const { GET } = await import("./route");
const request = new Request("https://example.test/community-gallery/random");

describe("random look", () => {
  beforeEach(() => sitemapEntries.mockReset());

  it("redirects to one of the public looks, uncached", async () => {
    sitemapEntries.mockResolvedValue({ looks: ["a", "b", "c"], creators: [] });
    const res = await GET(request);
    expect(res.status).toBe(307);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(["a", "b", "c"].map((id) => `https://example.test/community-gallery/${id}`)).toContain(res.headers.get("location"));
  });

  it("falls back to the Gallery when there are no looks", async () => {
    sitemapEntries.mockResolvedValue({ looks: [], creators: [] });
    const res = await GET(request);
    expect(res.headers.get("location")).toBe("https://example.test/community-gallery");
  });
});
