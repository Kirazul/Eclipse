import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { latestRelease } = await import("./releases");

type NextInit = RequestInit & { next?: { revalidate?: number } };
const asks: { url: string; init: NextInit }[] = [];
function github(status: number, body: unknown) {
  vi.stubGlobal("fetch", async (url: string, init: NextInit) => {
    asks.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  });
}

afterEach(() => {
  asks.length = 0;
  vi.unstubAllGlobals();
});

describe("the overlay's latest release", () => {
  it("reads the version from the public repo's latest release, at most once an hour", async () => {
    github(200, { tag_name: "v1.1.0", html_url: "https://github.com/Kirazul/Eclipse/releases/tag/v1.1.0" });
    expect(await latestRelease()).toEqual({ version: "1.1.0" });
    expect(asks[0].url).toBe("https://api.github.com/repos/Kirazul/Eclipse/releases/latest");
    expect(asks[0].init.next?.revalidate).toBe(3600);
  });

  it("is null while there is no release", async () => {
    github(404, { message: "Not Found" });
    expect(await latestRelease()).toBeNull();
  });

  it("is null for a tag that is not a version, so nothing odd reaches the game", async () => {
    github(200, { tag_name: "release night <b>" });
    expect(await latestRelease()).toBeNull();
  });

  it("is null when GitHub cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await latestRelease()).toBeNull();
  });
});
