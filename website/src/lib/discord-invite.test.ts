import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { discordMembers } = await import("./discord-invite");

afterEach(() => vi.unstubAllGlobals());

describe("the community server's member count", () => {
  it("is Discord's count for the site's invite", async () => {
    let asked = "";
    vi.stubGlobal("fetch", async (url: string) => {
      asked = url;
      return Response.json({ approximate_member_count: 1234 });
    });
    expect(await discordMembers()).toBe(1234);
    expect(asked).toBe("https://discord.com/api/v10/invites/RvY5VjHgTA?with_counts=true");
  });

  it("is nothing when Discord refuses, fails or gives no count", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 429 }));
    expect(await discordMembers()).toBeNull();
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(await discordMembers()).toBeNull();
    vi.stubGlobal("fetch", async () => Response.json({ code: "RvY5VjHgTA" }));
    expect(await discordMembers()).toBeNull();
  });
});
