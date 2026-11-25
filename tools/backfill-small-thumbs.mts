/**
 * Gives every picture stored before the site wrote small copies one of its own:
 * <name>-small.avif, 480 px on its long edge, which phones load in place of the 960 px
 * thumbnail (supabase/migrations/20261125110000_small_thumbnails.sql). Each is made from the
 * picture's thumbnail, so it reads about half what the full files would.
 *
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/backfill-small-thumbs.mts          # dry run
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/backfill-small-thumbs.mts --apply  # write
 *
 * The dry run only lists the bucket and says what it would make and how much it would read.
 * Safe to run again: a picture that has its small copy is skipped, so a second run after the
 * site starts writing them catches pictures stored in between. Needs NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SECRET_KEY in .env.local; the secret key skips the bucket's upload limits,
 * which the migration raises to make room for the third file.
 */
import { createClient } from "@supabase/supabase-js";
import { SCREENSHOT_TYPE, smallCopy } from "@/lib/data/compress";
import { SCREENSHOT_BUCKET } from "@/lib/screenshots";
import { smallCopiesToMake, type SmallCopy, type StoredFile } from "@/lib/small-backfill";

const APPLY = process.argv.includes("--apply");

process.loadEnvFile(".env.local");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !KEY) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local");

const files = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).storage.from(SCREENSHOT_BUCKET);

const PAGE = 1000;

/** A folder's files and subfolders, every page of them. */
async function list(folder: string) {
  const found: StoredFile[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await files.list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listing ${folder || "the bucket"}: ${error.message}`);
    for (const entry of data) {
      // A folder is listed with no id.
      if (entry.id === null) folders.push(folder ? `${folder}/${entry.name}` : entry.name);
      else found.push({ name: entry.name, size: Number(entry.metadata?.size ?? 0) });
    }
    if (data.length < PAGE) return { found, folders };
  }
}

// Owners' folders (<owner>/<picture>) and imported looks' (discord/<look>/<picture>).
const plan: SmallCopy[] = [];
const pending = [""];
while (pending.length) {
  const folder = pending.pop()!;
  const { found, folders } = await list(folder);
  if (folder) plan.push(...smallCopiesToMake(folder, found));
  pending.push(...folders);
}

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
const reads = plan.reduce((sum, copy) => sum + copy.bytes, 0);
console.log(`${plan.length} picture(s) without a small copy; making them reads ${megabytes(reads)} MB.`);
for (const copy of plan.slice(0, 20)) console.log(`  ${copy.source} -> ${copy.target}`);
if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more`);

// Ends on its own rather than by process.exit, which can crash Node on Windows while
// connections are still closing.
if (APPLY) await apply();
else console.log("\nDry run. Add --apply to write.");

async function apply() {
  let made = 0;
  let skipped = 0;
  let failed = 0;
  for (const copy of plan) {
    const { data, error } = await files.download(copy.source);
    const small = data && (await smallCopy(Buffer.from(await data.arrayBuffer())));
    if (error || !small) {
      console.error(`  could not read ${copy.source}: ${error?.message ?? "not an image"}`);
      failed++;
      continue;
    }
    // As the site stores them (src/lib/data/supabase.ts), and never over a file already there.
    const stored = await files.upload(copy.target, small, { contentType: SCREENSHOT_TYPE, upsert: false });
    if (stored.error && /exists|duplicate/i.test(stored.error.message)) skipped++;
    else if (stored.error) {
      console.error(`  could not store ${copy.target}: ${stored.error.message}`);
      failed++;
    } else made++;
    if ((made + skipped + failed) % 50 === 0) console.log(`  ${made + skipped + failed} of ${plan.length}`);
  }
  console.log(`Made ${made}, already there ${skipped}, failed ${failed}.`);
  if (failed) process.exitCode = 1;
}
