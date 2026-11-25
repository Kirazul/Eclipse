import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-key");

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ auth: { signOut } }),
}));

const route = await import("./route");

it("signs out and goes home with a GET, so a refresh does not post again", async () => {
  const response = await route.POST(new NextRequest("https://site.test/auth/logout", { method: "POST" }));
  expect(signOut).toHaveBeenCalledOnce();
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://site.test/");
});

// Anything can link to a GET, and an image tag on another site should not end a session.
it("only answers a POST", () => {
  expect("GET" in route).toBe(false);
});
