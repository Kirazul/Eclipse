import { describe, expect, it, vi } from "vitest";
import { CODE_MAX } from "@/lib/limits";
import { CODE_TOO_LONG, outfitCodeSchema, submitOutfitSchema } from "./schema";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

// A 262 KB code took 53 ms to decode on every card and gave megabytes of warnings, so a new
// code is refused on its length alone, before anything reads it. Looks already published
// keep their longer codes: only what enters is capped.
const real = "ECA1:c2xvdCAxNSA0MjAK";
const huge = `ECA1:${"A".repeat(CODE_MAX)}`;

describe("a new code's length", () => {
  it("is the game set's limit, so a published look can always be sent to the game", () => {
    expect(CODE_MAX).toBe(32768);
  });

  it("is refused past the limit when publishing, with its own reason", () => {
    const r = outfitCodeSchema.safeParse(huge);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([CODE_TOO_LONG]);
    const form = submitOutfitSchema.safeParse({ title: "Frost knight", code: huge, gallery: [] });
    expect(form.error?.issues.find((i) => i.path[0] === "code")?.message).toBe(CODE_TOO_LONG);
  });

  it("still lets a real code through", () => {
    expect(outfitCodeSchema.safeParse(real).success).toBe(true);
  });
});

describe("pasting a code to see what it holds", () => {
  it("answers a code past the limit without reading it", async () => {
    const { inspectCode } = await import("@/app/actions");
    expect(await inspectCode(huge)).toEqual({ kind: "error", error: CODE_TOO_LONG });
    expect((await inspectCode(real)).kind).toBe("outfit");
  });
});
