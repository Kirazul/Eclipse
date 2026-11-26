import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { dllReleases, latestRelease } = await import("./releases");

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

const dll = (tag: string) => ({
  name: "dinput8.dll",
  browser_download_url: `https://github.com/Kirazul/Eclipse/releases/download/${tag}/dinput8.dll`,
});

describe("every published DLL", () => {
  it("lists each release that carries dinput8.dll, newest version first, at most once an hour", async () => {
    github(200, [
      { tag_name: "v1.0.0", assets: [dll("v1.0.0")] },
      { tag_name: "v1.10.0", assets: [{ name: "notes.txt", browser_download_url: "x" }, dll("v1.10.0")] },
      { tag_name: "v1.2.0", assets: [dll("v1.2.0")] },
    ]);
    expect(await dllReleases()).toEqual([
      { version: "1.10.0", url: "https://github.com/Kirazul/Eclipse/releases/download/v1.10.0/dinput8.dll" },
      { version: "1.2.0", url: "https://github.com/Kirazul/Eclipse/releases/download/v1.2.0/dinput8.dll" },
      { version: "1.0.0", url: "https://github.com/Kirazul/Eclipse/releases/download/v1.0.0/dinput8.dll" },
    ]);
    expect(asks[0].url).toMatch(/^https:\/\/api\.github\.com\/repos\/Kirazul\/Eclipse\/releases\?per_page=\d+$/);
    expect(asks[0].init.next?.revalidate).toBe(3600);
  });

  it("leaves out drafts, pre-releases, odd tags, releases without the DLL and links off GitHub", async () => {
    github(200, [
      { tag_name: "v2.0.0", draft: true, assets: [dll("v2.0.0")] },
      { tag_name: "v1.9.0", prerelease: true, assets: [dll("v1.9.0")] },
      { tag_name: "release night <b>", assets: [dll("x")] },
      { tag_name: "v1.5.0", assets: [] },
      { tag_name: "v1.4.0", assets: [{ name: "dinput8.dll", browser_download_url: "https://example.com/dinput8.dll" }] },
      { tag_name: "v1.1.0", assets: [dll("v1.1.0")] },
    ]);
    expect(await dllReleases()).toEqual([
      { version: "1.1.0", url: "https://github.com/Kirazul/Eclipse/releases/download/v1.1.0/dinput8.dll" },
    ]);
  });

  it("is empty when GitHub answers with an error or cannot be reached", async () => {
    github(403, { message: "rate limited" });
    expect(await dllReleases()).toEqual([]);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await dllReleases()).toEqual([]);
  });
});
