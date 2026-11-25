import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION_HEADER } from "@/lib/game-sync/wire";

vi.mock("server-only", () => ({}));
let release: { version: string } | null = null;
vi.mock("@/lib/releases", () => ({ latestRelease: async () => release }));

const { POST } = await import("./route");

const ask = (body: string) => POST(new NextRequest("https://site.test/api/game/version", { method: "POST", body }));
const build = (b: string) => `${VERSION_HEADER}\nbuild ${b}\n`;

beforeEach(() => {
  release = null;
});

describe("POST /api/game/version", () => {
  it("names the newer release to a game on an older build", async () => {
    release = { version: "1.1.0" };
    const res = await ask(build("1.0.0"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("update 1.1.0");
  });

  it("says current to a game on the newest build, or when there is no release to compare", async () => {
    release = { version: "1.1.0" };
    expect(await (await ask(build("1.1.0"))).text()).toBe("current");
    release = null;
    expect(await (await ask(build("1.0.0"))).text()).toBe("current");
  });

  it("refuses a request that is not a version check", async () => {
    const res = await ask("hello");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("bad-request");
  });
});
