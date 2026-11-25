// Small copies of the studio backdrops for Wardrobe cards, which draw them faintly behind a
// card a few hundred pixels wide: the 1024px originals cost a page of 24 cards over a megabyte.
// Rerun after adding a backdrop: node tools/make-card-backdrops.mjs
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const from = "public/wow/backdrops";
const to = join(from, "card");
mkdirSync(to, { recursive: true });

let bytes = 0;
for (const file of readdirSync(from).filter((f) => f.endsWith(".jpg"))) {
  const info = await sharp(join(from, file))
    .resize({ width: 480 })
    .webp({ quality: 50 })
    .toFile(join(to, file.replace(/\.jpg$/, ".webp")));
  bytes += info.size;
}
console.log(`${readdirSync(to).length} card backdrops, ${Math.round(bytes / 1024)} KB in all -> ${to}`);
