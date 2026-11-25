import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-key");

// The real client builds the provider URL without touching the network.
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => createClient("https://stub.supabase.co", "stub-key"),
}));

const { GET } = await import("./route");

const respond = (query: string) => GET(new NextRequest(`https://site.test/auth/login${query}`));
const visit = async (query: string) => new URL((await respond(query)).headers.get("location")!);

describe("the sign-in route", () => {
  it("sends a visitor to Discord and back to this site", async () => {
    const target = await visit("?provider=discord");
    expect(target.pathname).toBe("/auth/v1/authorize");
    expect(target.searchParams.get("provider")).toBe("discord");
    expect(target.searchParams.get("redirect_to")).toBe("https://site.test/auth/callback");
  });

  it.each(["", "?provider=github", "?provider=google", "?provider="])("does not start a sign-in for %j", async (query) => {
    const target = await visit(query);
    expect(target.href).toBe("https://site.test/community-gallery");
  });

  // The allow list matches redirect_to exactly, so the page cannot travel in it.
  it("remembers the page in a cookie and leaves the redirect alone", async () => {
    const response = await respond("?provider=discord&next=%2Finspector");
    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("redirect_to")).toBe("https://site.test/auth/callback");
    expect(response.headers.get("set-cookie")).toContain("eclipse-auth-next=%2Finspector");
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("will not remember a page off this site", async () => {
    const response = await respond("?provider=discord&next=%2F%5Cevil.com");
    expect(response.headers.get("set-cookie")).toContain("eclipse-auth-next=%2Fcommunity-gallery");
  });
});
