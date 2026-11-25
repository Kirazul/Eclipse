import "server-only";
import { revalidatePath } from "next/cache";
import { repository } from "@/lib/data";
import { importDiscordLook, removeScreenshots, storeScreenshot } from "@/lib/data/admin";
import { compressScreenshot } from "@/lib/data/compress";
import { download } from "@/lib/discord-bot";
import { grantCreator } from "@/lib/discord-roles";
import { announceLook } from "@/lib/look-feed";
import { smallOf, thumbOf } from "@/lib/screenshots";
import type { ShowcaseLook } from "@/lib/showcase-post";

// What "Add to Community Gallery" and "Ask for the code" share: who may act for a post's
// player, and writing the look a post makes.

// Permission bits, as Discord numbers them.
const MANAGE_MESSAGES = BigInt(1 << 13);
const ADMINISTRATOR = BigInt(1 << 3);

/** Whether someone's permissions, signed by Discord, let them manage the channel's messages. */
export function moderates(permissions: string | undefined): boolean {
  try {
    return (BigInt(permissions ?? "0") & (MANAGE_MESSAGES | ADMINISTRATOR)) !== BigInt(0);
  } catch {
    return false;
  }
}

/** "already" is the look its message or its code became before. */
export type Added = { status: "added" | "already"; id: string } | { status: "badShot" };

/** Writes the look with its screenshots, credits its player and announces it. */
export async function addShowcaseLook(look: ShowcaseLook): Promise<Added> {
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
        return { status: "badShot" };
      }
      const path = `discord/${id}/${crypto.randomUUID()}.avif`;
      // The smaller copies first, as the site uploads: a gallery names only the full file.
      for (const [file, body] of [
        [thumbOf(path), compressed.thumb],
        [smallOf(path), compressed.small],
        [path, compressed.full],
      ] as const) {
        await storeScreenshot(file, body);
        written.push(file);
      }
      gallery.push(path);
    }
    const saved = await importDiscordLook(id, look, gallery);
    if (saved !== id) {
      await removeScreenshots(written);
      return { status: "already", id: saved };
    }
  } catch (error) {
    await removeScreenshots(written).catch(() => {});
    throw error;
  }

  revalidatePath("/community-gallery");
  revalidatePath("/");
  const post = await repository.getOutfit(id);
  await Promise.allSettled([grantCreator(look.discordId), post ? announceLook(post) : null]);
  return { status: "added", id };
}
