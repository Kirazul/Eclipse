import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("SUPABASE_SECRET_KEY", "secret");

// The real client over a stubbed network: what is proved is which files it asks storage to
// remove, and that a picture is forgotten only once its file is gone.
let waiting: string[][] = [];
let refuse = false;
const removed: string[] = [];
const swept: string[] = [];
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/rpc/game_shot_sweep")) return Response.json(waiting.shift() ?? []);
  if (url.endsWith("/rpc/game_shot_swept")) {
    swept.push(...(JSON.parse(String(init?.body)) as { p_paths: string[] }).p_paths);
    return Response.json(null);
  }
  if (url.includes("/storage/") && init?.method === "DELETE") {
    if (refuse) return Response.json({ message: "down" }, { status: 500 });
    removed.push(...(JSON.parse(String(init.body)) as { prefixes: string[] }).prefixes);
    return Response.json([]);
  }
  throw new Error(`unexpected request ${url}`);
});

const { sweepGamePictures } = await import("./admin");

const USER = "33333333-3333-4333-8333-333333333333";
const shot = (n: number) => `${USER}/44444444-4444-4444-8444-${String(n).padStart(12, "0")}.avif`;
const thumb = (path: string) => path.replace(".avif", "-thumb.avif");

beforeEach(() => {
  waiting = [];
  refuse = false;
  removed.length = 0;
  swept.length = 0;
});

describe("sweeping replaced game pictures", () => {
  it("removes each picture with its thumbnail, a batch at a time, until none wait", async () => {
    waiting = [[shot(1), shot(2)], [shot(3)]];
    expect(await sweepGamePictures()).toBe(3);
    expect(removed).toEqual([shot(1), thumb(shot(1)), shot(2), thumb(shot(2)), shot(3), thumb(shot(3))]);
    expect(swept).toEqual([shot(1), shot(2), shot(3)]);
  });

  it("forgets nothing storage did not remove", async () => {
    waiting = [[shot(1)]];
    refuse = true;
    await expect(sweepGamePictures()).rejects.toThrow();
    expect(swept).toEqual([]);
  });

  it("touches nothing but game pictures, whatever the list says", async () => {
    waiting = [[shot(1), `discord/${USER}/44444444-4444-4444-8444-000000000009.avif`]];
    await expect(sweepGamePictures()).rejects.toThrow(/not a game picture/i);
    expect(removed).toEqual([]);
  });
});
