import { describe, expect, it } from "vitest";
import { ago, posted } from "./ago";

const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("when a look was posted", () => {
  it("reads like a social app for the first week", () => {
    expect(posted("2026-11-13T11:59:30Z", NOW)).toBe("just now");
    expect(posted("2026-11-13T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(posted("2026-11-12T12:00:00Z", NOW)).toBe("yesterday");
    expect(posted("2026-11-07T12:00:00Z", NOW)).toBe("6 days ago");
  });

  it("gives the date once it is older, with the year", () => {
    expect(posted("2026-11-01T03:41:14Z", NOW)).toBe("Nov 1, 2026");
    expect(posted("2025-12-31T23:00:00Z", NOW)).toBe("Dec 31, 2025");
  });
});

describe("in Russian", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  it("says how long ago, and the date past a week", () => {
    expect(ago("2026-11-20T09:00:00Z", now, "ru")).toBe("3 часа назад");
    expect(ago("2026-11-20T12:00:00Z", now, "ru")).toBe("сейчас");
    expect(posted("2026-11-01T12:00:00Z", now, "ru")).toMatch(/1 нояб\.? 2026/);
  });
});
