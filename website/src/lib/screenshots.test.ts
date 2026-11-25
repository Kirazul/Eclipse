import { describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");

const { UPLOAD_PATH, screenshotFiles, screenshotUrl, smallOf, thumbOf } = await import("./screenshots");

const path = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.avif";

describe("a screenshot's address", () => {
  it("is built from its storage path", () => {
    expect(screenshotUrl(path)).toBe(`https://stub.supabase.co/storage/v1/object/public/showcase/${path}`);
  });

  it("has a thumbnail beside it, as a path or a link", () => {
    expect(thumbOf(path)).toMatch(/-thumb\.avif$/);
    expect(thumbOf(screenshotUrl(path))).toMatch(/\/showcase\/.+-thumb\.avif$/);
  });

  it("has a smaller copy beside it too, for phones", () => {
    expect(smallOf(path)).toBe(path.replace(/\.avif$/, "-small.avif"));
    expect(smallOf(screenshotUrl(path))).toMatch(/\/showcase\/.+-small\.avif$/);
  });

  it("is stored as three files, removed together", () => {
    expect(screenshotFiles(path)).toEqual([path, thumbOf(path), smallOf(path)]);
  });

  it("only ever names an uploaded file", () => {
    expect(UPLOAD_PATH.test(path)).toBe(true);
    expect(UPLOAD_PATH.test(thumbOf(path))).toBe(false);
    expect(UPLOAD_PATH.test(smallOf(path))).toBe(false);
    expect(UPLOAD_PATH.test("https://evil.test/a.avif")).toBe(false);
    expect(UPLOAD_PATH.test(`../${path}`)).toBe(false);
  });
});
