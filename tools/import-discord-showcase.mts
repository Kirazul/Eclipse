/**
 * Brings looks shared in the Discord showcase onto the Wardrobe, credited to the player
 * who shared them. Each becomes theirs when they sign in with Discord
 * (supabase/migrations/20261113180000_discord_showcase_looks.sql).
 *
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/import-discord-showcase.mts          # dry run
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/import-discord-showcase.mts --apply  # write
 *
 * A look is a message holding an ECA1: code plus its screenshots: the message's own
 * images, or else the player's own picture that the code answers, reached through the
 * replies ("code?" -> picture). A code with no picture of its own is left out: the site
 * shows only what was recorded. Each message is imported once, so a rerun adds only
 * what is new. Needs DISCORD_BOT_TOKEN in .env.local, with Message Content Intent on,
 * and a logged-in, linked Supabase CLI: writes go through it, as the database's owner.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressScreenshot } from "@/lib/data/compress";
import { SCREENSHOT_BUCKET, smallOf, thumbOf } from "@/lib/screenshots";
import { SHOWCASE_CHANNEL, codeIn, showcaseLook, type ShowcaseLook, type ShowcaseMessage } from "@/lib/showcase-post";

const APPLY = process.argv.includes("--apply");

process.loadEnvFile(".env.local");
const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) throw new Error("DISCORD_BOT_TOKEN is missing from .env.local");

async function discord<T>(path: string): Promise<T> {
  for (;;) {
    const r = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (r.status === 429) {
      const wait = ((await r.json()).retry_after ?? 1) * 1000 + 100;
      await new Promise((done) => setTimeout(done, wait));
      continue;
    }
    if (!r.ok) throw new Error(`Discord ${r.status} on ${path}: ${await r.text()}`);
    return r.json() as Promise<T>;
  }
}

async function history(channel: string): Promise<ShowcaseMessage[]> {
  const all: ShowcaseMessage[] = [];
  for (let before = ""; ;) {
    const page = await discord<ShowcaseMessage[]>(`/channels/${channel}/messages?limit=100${before}`);
    all.push(...page);
    if (page.length < 100) break;
    before = `&before=${page.at(-1)!.id}`;
  }
  return all.reverse();
}

const sql = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const sqlArray = (vs: string[]) => `array[${vs.map(sql).join(",")}]::text[]`;

function supabase(args: string[]): string {
  return execFileSync("pnpm", ["exec", "supabase", ...args], { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

function query<T>(text: string): T[] {
  const dir = mkdtempSync(join(tmpdir(), "showcase-sql-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, text);
  const out = supabase(["db", "query", "--linked", "-f", file]);
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).rows as T[];
}

const messages = await history(SHOWCASE_CHANNEL);
const byId = new Map(messages.map((m) => [m.id, m]));
const done = new Set(query<{ message_id: string }>("select message_id from public.discord_looks").map((r) => r.message_id));
// One public look per code (20261115090000_one_public_look_per_code): a code already in
// the Gallery, or earlier in this run, is left out rather than refused mid-transaction.
const taken = new Set(query<{ code: string }>("select code from public.outfits where not is_private").map((r) => r.code));

const looks: (ShowcaseLook & { id: string })[] = [];
const skipped: string[] = [];
for (const m of messages) {
  if (done.has(m.id) || m.author.bot || !codeIn(m.content)) continue;
  const made = showcaseLook(m, byId, messages);
  if (made.ok && taken.has(made.look.code)) {
    skipped.push(`${m.timestamp.slice(0, 10)} ${m.author.global_name ?? m.author.username}: its code is already in the Community Gallery`);
  } else if (made.ok) {
    taken.add(made.look.code);
    looks.push({ id: crypto.randomUUID(), ...made.look });
  } else skipped.push(`${m.timestamp.slice(0, 10)} ${m.author.global_name ?? m.author.username}: ${made.reason}`);
}

console.log(`${messages.length} messages, ${done.size} already imported, ${looks.length} to import\n`);
for (const l of looks) {
  console.log(`${l.createdAt.slice(0, 10)}  ${l.name.padEnd(18)} ${l.title.padEnd(26)} ${l.pictures.length} shot(s)${l.description ? `  "${l.description.slice(0, 50)}"` : ""}`);
}
if (skipped.length) console.log(`\nLeft out:\n  ${skipped.join("\n  ")}`);
if (!APPLY) {
  console.log("\nDry run. Add --apply to write.");
  process.exit(0);
}

// Screenshots first, as the site does: a look only ever names files that exist.
// Relative, with forward slashes: the CLI reads an absolute Windows path (C:\...) as a
// remote address and refuses to copy it.
const root = "node_modules/.cache/showcase-import";
rmSync(root, { recursive: true, force: true });
for (const l of looks) {
  mkdirSync(`${root}/discord/${l.id}`, { recursive: true });
  const gallery: string[] = [];
  for (const url of l.pictures) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download a screenshot of ${l.name}'s look: ${res.status}`);
    const compressed = await compressScreenshot(Buffer.from(await res.arrayBuffer()));
    if (!compressed) throw new Error(`A screenshot of ${l.name}'s look is not an image`);
    const path = `discord/${l.id}/${crypto.randomUUID()}.avif`;
    // The smaller copies first, as the site uploads: a gallery names only the full file.
    for (const [file, body] of [[thumbOf(path), compressed.thumb], [smallOf(path), compressed.small], [path, compressed.full]] as const) {
      writeFileSync(`${root}/${file}`, body);
      supabase(["storage", "cp", `${root}/${file}`, `ss:///${SCREENSHOT_BUCKET}/${file}`, "--linked", "--experimental", "--content-type", "image/avif"]);
    }
    gallery.push(path);
  }
  l.pictures = gallery;
  console.log(`  uploaded ${gallery.length} screenshot(s) for ${l.name}: ${l.title}`);
}

// A player who already has an account gets the look now; the rest at their first sign-in.
const inserts = looks.map((l) => `
  with look as (
    insert into public.outfits (id, author_id, discord_name, title, code, race, tags, description, gallery, created_at)
    values (${sql(l.id)}::uuid,
      (select user_id from auth.identities where provider = 'discord' and provider_id = ${sql(l.discordId)} limit 1),
      ${sql(l.name)}, ${sql(l.title)}, ${sql(l.code)}, ${sql(l.race)}, ${sqlArray(l.tags)}, ${sql(l.description)},
      ${sqlArray(l.pictures)}, ${sql(l.createdAt)}::timestamptz)
    returning id
  )
  insert into public.discord_looks (outfit_id, discord_id, message_id)
    select id, ${sql(l.discordId)}, ${sql(l.messageId)} from look;`);
query(`begin;${inserts.join("")}\ncommit;\nselect count(*) from public.discord_looks;`);
rmSync(root, { recursive: true, force: true });
console.log(`\nImported ${looks.length} looks.`);
