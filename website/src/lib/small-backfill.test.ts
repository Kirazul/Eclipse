import { describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");

const { smallCopiesToMake } = await import("./small-backfill");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("the small copies a folder still needs", () => {
  it("makes one from the thumbnail of each picture that has none", () => {
    const plan = smallCopiesToMake("owner", [
      { name: `${A}.avif`, size: 200 },
      { name: `${A}-thumb.avif`, size: 90 },
    ]);
    expect(plan).toEqual([
      { source: `owner/${A}-thumb.avif`, target: `owner/${A}-small.avif`, bytes: 90 },
    ]);
  });

  it("skips a picture that already has one, so running it again does nothing", () => {
    expect(
      smallCopiesToMake("owner", [
        { name: `${A}.avif`, size: 200 },
        { name: `${A}-thumb.avif`, size: 90 },
        { name: `${A}-small.avif`, size: 30 },
      ]),
    ).toEqual([]);
  });

  it("falls back to the full file when the thumbnail is missing", () => {
    expect(smallCopiesToMake("discord/look", [{ name: `${B}.webp`, size: 300 }])).toEqual([
      { source: `discord/look/${B}.webp`, target: `discord/look/${B}-small.webp`, bytes: 300 },
    ]);
  });

  it("leaves alone anything that is not a picture", () => {
    expect(
      smallCopiesToMake("owner", [
        { name: `${C}-thumb.avif`, size: 90 },
        { name: "notes.txt", size: 1 },
        { name: ".emptyFolderPlaceholder", size: 0 },
      ]),
    ).toEqual([]);
  });
});
