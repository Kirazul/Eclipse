import { describe, expect, it, vi } from "vitest";
import { reach } from "./reach";

describe("calling a server action from a form", () => {
  it("gives the action's own answer, failure and all", async () => {
    expect(await reach(async () => ({ ok: true as const, value: 3 }), "offline")).toEqual({ ok: true, value: 3 });
    expect(await reach(async () => ({ ok: false as const, error: "Taken" }), "offline")).toEqual({ ok: false, error: "Taken" });
  });

  it("turns a dropped connection into an error the form can show, instead of the error page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await reach(async (): Promise<{ ok: true }> => {
      throw new TypeError("Failed to fetch");
    }, "Check your connection");
    expect(r).toEqual({ ok: false, error: "Check your connection" });
  });
});
