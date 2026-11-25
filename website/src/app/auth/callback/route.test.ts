import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-key");

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { exchangeCodeForSession } }),
}));

const { GET } = await import("./route");

const visit = (query: string, next?: string) =>
  GET(
    new NextRequest(`https://site.test/auth/callback${query}`, {
      headers: next ? { cookie: `eclipse-auth-next=${encodeURIComponent(next)}` } : {},
    }),
  );
const landing = (response: Response) => response.headers.get("location");

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the sign-in callback", () => {
  it("returns a signed-in visitor to the page they left", async () => {
    const response = await visit("?code=abc", "/inspector");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(landing(response)).toBe("https://site.test/inspector?auth=signed-in");
  });

  it("clears the remembered page", async () => {
    const response = await visit("?code=abc", "/inspector");
    expect(response.headers.get("set-cookie")).toMatch(/^eclipse-auth-next=;/);
  });

  it("opens the Wardrobe when no page was remembered", async () => {
    expect(landing(await visit("?code=abc"))).toBe("https://site.test/community-gallery?auth=signed-in");
  });

  it("stays on this site", async () => {
    expect(landing(await visit("?code=abc", "/\\evil.com"))).toBe("https://site.test/community-gallery?auth=signed-in");
  });

  it("says so when the code cannot be exchanged", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("bad code") });
    expect(landing(await visit("?code=abc", "/inspector"))).toBe("https://site.test/inspector?auth=failed");
  });

  it("says so when the provider sent no code", async () => {
    expect(landing(await visit(""))).toBe("https://site.test/community-gallery?auth=failed");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("tells a change of mind from a failure", async () => {
    const response = await visit("?error=access_denied&error_description=denied", "/inspector");
    expect(landing(response)).toBe("https://site.test/inspector?auth=cancelled");
  });
});
