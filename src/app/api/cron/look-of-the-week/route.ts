import { repository } from "@/lib/data";
import { AMBER, plain } from "@/lib/discord";
import { crownLookOfTheWeek, syncCreators } from "@/lib/discord-roles";
import { wearIt } from "@/lib/look-feed";
import { siteUrl } from "@/lib/site";

// Called by Vercel's scheduler (vercel.json crons) every Monday. It posts the look of
// the week to the community Discord through DISCORD_WEBHOOK_URL, moves the Look of the
// Week role to its player, and hands Gallery Creator to everyone with a look. A quiet
// week posts nothing and takes the role back: the site only shows what was recorded.

/** Roles never stop the weekly post. */
async function roles(winner: string | null) {
  try {
    await crownLookOfTheWeek(winner);
    await syncCreators();
  } catch (error) {
    console.error("The weekly Discord roles failed:", error);
  }
}

export async function GET(request: Request) {
  // Vercel sends this header when CRON_SECRET is set. With no secret, nothing passes.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const hook = process.env.DISCORD_WEBHOOK_URL;
  const pick = await repository.lookOfTheWeek();
  await roles(pick?.post.id ?? null);
  if (!hook || !pick) return Response.json({ posted: false });

  const { post, votes } = pick;
  const url = `${siteUrl}/community-gallery/${post.id}`;
  const by = post.author ? `, by ${plain(post.author)}` : "";
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // A look's title or a name must never ping @everyone or anyone else.
      allowed_mentions: { parse: [] },
      embeds: [{
        title: post.title.slice(0, 256),
        url,
        description: wearIt(
          `The most upvoted of the looks posted in the last seven days, with ${votes.toLocaleString("en-US")} upvotes${by}.`,
          post.code,
        ),
        color: AMBER,
        ...(post.gallery.length ? { image: { url: `${url}/cover` } } : {}),
        footer: { text: "Look of the week" },
      }],
    }),
  });
  if (!res.ok) {
    console.error("Discord refused the look of the week:", res.status, await res.text());
    return Response.json({ posted: false }, { status: 502 });
  }
  return Response.json({ posted: true, id: post.id });
}
