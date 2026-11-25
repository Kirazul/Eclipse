import { describe, expect, it } from "vitest";
import { pickLocale } from "./locales";

describe("which language a visitor gets", () => {
  it("keeps the switcher's choice over the browser's", () => {
    expect(pickLocale("en", "ru-RU,ru;q=0.9")).toBe("en");
    expect(pickLocale("ru", "en-US")).toBe("ru");
  });

  it("follows the browser when nothing was chosen, by its weights", () => {
    expect(pickLocale(undefined, "ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru");
    expect(pickLocale(undefined, "en-US,en;q=0.9,ru;q=0.8")).toBe("en");
    expect(pickLocale(undefined, "de;q=0.5,ru;q=0.7")).toBe("ru");
  });

  it("falls back to English for anything else, a bad cookie included", () => {
    expect(pickLocale("xx", "de-DE")).toBe("en");
    expect(pickLocale(undefined, null)).toBe("en");
    expect(pickLocale(undefined, "ru;q=0")).toBe("en");
  });

  it("does not assume a neighbouring language wants Russian", () => {
    expect(pickLocale(undefined, "uk-UA,uk;q=0.9")).toBe("en");
  });
});
