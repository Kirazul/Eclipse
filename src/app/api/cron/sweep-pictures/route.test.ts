import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let configured = true;
let sweep: () => Promise<number> = async () => 3;
vi.mock("@/lib/data/admin", () => ({ adminConfigured: () => configured, sweepGamePictures: () => sweep() }));

const { GET } = await import("./route");

const call = (auth?: string) =>
  GET(new Request("https://eclipse.test/api/cron/sweep-pictures", auth ? { headers: { authorization: auth } } : {}));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  configured = true;
  sweep = async () => 3;
});
afterEach(() => vi.unstubAllEnvs());

describe("the daily picture sweep", () => {
  it("answers only the scheduler, which sends the cron secret", async () => {
    sweep = async () => { throw new Error("must not run"); };
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("says how many pictures it removed", async () => {
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ removed: 3 });
  });

  it("does nothing without the database key", async () => {
    configured = false;
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ removed: 0 });
  });

  it("reports a failure, so the scheduler shows it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sweep = async () => { throw new Error("storage is down"); };
    expect((await call("Bearer cron-secret")).status).toBe(500);
  });
});
