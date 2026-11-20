import { describe, expect, it, vi } from "vitest";
import { voteReader } from "./my-votes";

describe("reading which looks a visitor voted for", () => {
  it("asks once for every button on the page", async () => {
    const fetch = vi.fn(async (ids: string[]) => ids.filter((id) => id !== "b"));
    const hasVoted = voteReader(fetch, () => true);
    const answers = await Promise.all([hasVoted("a"), hasVoted("b"), hasVoted("c"), hasVoted("a")]);
    expect(answers).toEqual([true, false, true, true]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("asks nothing for a visitor who is not signed in", async () => {
    const fetch = vi.fn(async () => ["a"]);
    expect(await voteReader(fetch, () => false)("a")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows nothing voted when the answer fails, rather than breaking the page", async () => {
    const hasVoted = voteReader(async () => { throw new Error("offline"); }, () => true);
    expect(await hasVoted("a")).toBe(false);
  });
});
