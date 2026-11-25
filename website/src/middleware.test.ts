import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-key");

const { middleware } = await import("./middleware");

const visit = (path: string) => middleware(new NextRequest(`https://site.test${path}`));

// Supabase sends a sign-in to the Site URL, the bare home page, when it does not
// recognise the address it was asked to use. That page must not swallow the result.
describe("a sign-in that lands on the home page", () => {
  it("is passed to the callback", async () => {
    const response = await visit("/?code=abc");
    expect(response.headers.get("location")).toBe("https://site.test/auth/callback?code=abc");
  });

  it("keeps a provider's refusal", async () => {
    const response = await visit("/?error=access_denied");
    expect(response.headers.get("location")).toBe("https://site.test/auth/callback?error=access_denied");
  });

  it("leaves an ordinary home page alone", async () => {
    expect((await visit("/")).headers.get("location")).toBeNull();
  });

  it("leaves a code on another page alone", async () => {
    expect((await visit("/inspector?code=abc")).headers.get("location")).toBeNull();
  });
});
