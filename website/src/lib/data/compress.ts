import "server-only";

// Every stored screenshot comes through here, so a capture's size, format and
// metadata are the site's choice and not the uploader's. Measured on game art
// against WebP q80: AVIF q55 is 25-40% smaller at the same or better SSIM. Effort 4
// takes about 350ms; effort 6 takes three times that and saves almost nothing.

export const SCREENSHOT_TYPE = "image/avif";
export const SCREENSHOT_EXTENSION = "avif";

// The post's frame is 4:5 and crops a wide capture by height, so these are long
// edges that stay sharp at 2x. Supabase's own resizing is not on the Free plan.
const FULL = { edge: 1600, quality: 55 };
const THUMB = { edge: 960, quality: 50 };
// What a phone's Gallery card needs: a card there is half the screen wide.
const SMALL = { edge: 480, quality: 50 };

// Just above 8K, which is 33 million: a small file can decode to a huge image.
const MAX_INPUT_PIXELS = 40_000_000;

async function encode(input: Buffer, { edge, quality }: { edge: number; quality: number }) {
  // Loaded here, not at the top: every page reads through the file that imports this
  // one, and a native binary that fails to load should only cost uploads.
  const { default: sharp } = await import("sharp");
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // Applies the file's orientation, which is about to be dropped.
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .avif({ quality, effort: 4 }) // sharp keeps no metadata unless asked: no EXIF, no GPS.
    .toBuffer();
}

// The size Discord, X and others draw a large link preview at.
const CARD = { width: 1200, height: 630, quality: 80 };

/** A stored screenshot as a link preview: a JPEG, which every preview reads. */
export async function socialCard(input: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: CARD.width, height: CARD.height, fit: "cover" })
      .jpeg({ quality: CARD.quality, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    console.error("Link preview failed:", error);
    return null;
  }
}

/**
 * The small copy for a picture stored before there was one, made from its stored thumbnail
 * (tools/backfill-small-thumbs.mts). Null when the bytes are not an image.
 */
export async function smallCopy(thumb: Buffer): Promise<Buffer | null> {
  try {
    return await encode(thumb, SMALL);
  } catch (error) {
    console.error("Small copy failed:", error);
    return null;
  }
}

/** A capture's three stored copies, or null when its bytes are not an image. */
export async function compressScreenshot(input: Buffer) {
  try {
    const [full, thumb, small] = await Promise.all([encode(input, FULL), encode(input, THUMB), encode(input, SMALL)]);
    return { full, thumb, small };
  } catch (error) {
    console.error("Screenshot compression failed:", error);
    return null;
  }
}
