import { describe, expect, it } from "vitest";
import { visitorOf } from "./visitor";

const headers = (h: Record<string, string>) => new Headers(h);

describe("who copied a look, as the server sees them", () => {
  it("is the address the host saw, and nothing the browser says", () => {
    expect(visitorOf(headers({ "x-real-ip": "203.0.113.7", "user-agent": "Firefox/140" }))).toBe("203.0.113.7");
  });

  it("stays the same visitor when the browser changes what it calls itself", () => {
    const a = visitorOf(headers({ "x-real-ip": "203.0.113.7", "user-agent": "Firefox/140" }));
    const b = visitorOf(headers({ "x-real-ip": "203.0.113.7", "user-agent": "Chrome/141" }));
    const c = visitorOf(headers({ "x-real-ip": "203.0.113.7" }));
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it("takes the first forwarded address when the host gives a chain", () => {
    expect(visitorOf(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "Firefox/140" }))).toBe("203.0.113.7");
  });

  it("is nobody without an address, so nothing is counted", () => {
    expect(visitorOf(headers({ "user-agent": "Firefox/140" }))).toBeNull();
  });
});
