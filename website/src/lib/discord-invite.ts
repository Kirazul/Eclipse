import "server-only";
import { DISCORD_URL } from "@/lib/site";

// How many people are in the community server, as Discord counts them for its invite.
// Public, needs no token, and is read at most once an hour. Null whenever Discord does
// not say, so the page shows no number rather than a wrong one.
export async function discordMembers(): Promise<number | null> {
  const code = new URL(DISCORD_URL).pathname.split("/").filter(Boolean).pop();
  if (!code) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const { approximate_member_count: count } = (await res.json()) as { approximate_member_count?: unknown };
    return typeof count === "number" && count > 0 ? count : null;
  } catch {
    return null;
  }
}
