import "server-only";
import { revalidatePath } from "next/cache";
import { repository } from "@/lib/data";
import {
  adminConfigured, importDiscordLook, lookOfMessage, removeScreenshots, storeScreenshot,
} from "@/lib/data/admin";
import { compressScreenshot } from "@/lib/data/compress";
import { botConfigured, download, messagesBefore } from "@/lib/discord-bot";
import { grantCreator } from "@/lib/discord-roles";
import { announceLook } from "@/lib/look-feed";
import { thumbOf } from "@/lib/screenshots";
import { SHOWCASE_CHANNEL, codeIn, images, showcaseLook } from "@/lib/showcase-post";
import { siteUrl } from "@/lib/site";
import { say, type Interaction, type Reply } from "./reply";

// "Add to Community Gallery" on a #showcase post's right-click menu: what
// tools/import-discord-showcase.mts does for the whole channel, for one post, at once.
// Its player, or a moderator, can add it; the look is credited to the player either way.

// Permission bits, as Discord numbers them.
const MANAGE_MESSAGES = BigInt(1 << 13);
const ADMINISTRATOR = BigInt(1 << 3);

function moderates(permissions: string | undefined): boolean {
  try {
    return (BigInt(permissions ?? "0") & (MANAGE_MESSAGES | ADMINISTRATOR)) !== BigInt(0);
  } catch {
    return false;
  }
}

// The post itself, or the same code published on the site or from another post: the
// database answers one public look per code with the look already there.
const already = (look: string) => say(`This look is already in the Community Gallery: ${siteUrl}/community-gallery/${look}`);

export async function addToWardrobe(interaction: Interaction): Promise<Reply> {
  if (!adminConfigured() || !botConfigured()) return say("Adding looks from Discord is not switched on yet.");
  const data = interaction.data;
  const target = data?.target_id ? data.resolved?.messages?.[data.target_id] : undefined;
  if (!target) return say("Discord did not send the post. Try again.");
  if ((interaction.channel_id ?? target.channel_id) !== SHOWCASE_CHANNEL) {
    return say(`Only posts in <#${SHOWCASE_CHANNEL}> can be added to the Community Gallery.`);
  }
  if (interaction.member?.user.id !== target.author.id && !moderates(interaction.member?.permissions)) {
    return say("Only the player who posted this, or a moderator, can add it.");
  }
  if (!codeIn(target.content)) return say("This post has no Eclipse code to add.");
  const existing = await lookOfMessage(target.id);
  if (existing) return already(existing);

  // The picture may be an earlier post the code answers, so read what came before.
  const history = images(target).length ? [] : await messagesBefore(SHOWCASE_CHANNEL, target.id);
  const made = showcaseLook(target, new Map([...history, target].map((m) => [m.id, m])), history);
  if (!made.ok) return say(`This post cannot be added: ${made.reason}.`);
  const { look } = made;

  // Screenshots first, as the site does: a look only ever names files that exist.
  const id = crypto.randomUUID();
  const written: string[] = [];
  const gallery: string[] = [];
  try {
    for (const url of look.pictures) {
      const raw = await download(url);
      const compressed = raw && (await compressScreenshot(raw));
      if (!compressed) {
        await removeScreenshots(written);
        return say("A screenshot in this post could not be read. Try again.");
      }
      const path = `discord/${id}/${crypto.randomUUID()}.avif`;
      // The thumbnail first, as the site uploads: a gallery names only the full file.
      await storeScreenshot(thumbOf(path), compressed.thumb);
      written.push(thumbOf(path));
      await storeScreenshot(path, compressed.full);
      written.push(path);
      gallery.push(path);
    }
    const saved = await importDiscordLook(id, look, gallery);
    if (saved !== id) {
      await removeScreenshots(written);
      return already(saved);
    }
  } catch (error) {
    await removeScreenshots(written).catch(() => {});
    throw error;
  }

  revalidatePath("/community-gallery");
  revalidatePath("/");
  const post = await repository.getOutfit(id);
  await Promise.allSettled([grantCreator(look.discordId), post ? announceLook(post) : null]);
  return say(`Added to the Community Gallery: ${siteUrl}/community-gallery/${id}`);
}
