import "server-only";
import type { OutfitPost } from "@/lib/data/types";
import { AMBER, codeBlock, plain, postWebhook } from "@/lib/discord";
import { siteUrl } from "@/lib/site";

/** A post's text, then the code to copy, or the site when the code cannot be shown here. */
export function wearIt(text: string, code: string): string {
  const block = codeBlock(code);
  return block
    ? `${text} Copy its code and wear it with Eclipse.\n${block}`
    : `${text} Copy its code from the Community Gallery and wear it with Eclipse.`;
}

// Posts each newly published look to the community's #wardrobe channel
// (DISCORD_FEED_WEBHOOK_URL). With no channel set up, nothing is sent.
export async function announceLook(post: OutfitPost) {
  const hook = process.env.DISCORD_FEED_WEBHOOK_URL;
  if (!hook) return;

  const url = `${siteUrl}/community-gallery/${post.id}`;
  const by = post.author ? ` by ${plain(post.author)}` : "";
  await postWebhook(hook, [{
    // Shown as typed, as the weekly post shows it. Mentions are off, so nothing pings.
    title: post.title.slice(0, 256),
    url,
    description: wearIt(`A new look${by}.`, post.code),
    color: AMBER,
    ...(post.gallery.length ? { image: { url: `${url}/cover` } } : {}),
    footer: { text: "New in the Community Gallery" },
  }]);
}
