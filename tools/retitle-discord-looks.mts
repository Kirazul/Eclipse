/**
 * Renames the looks brought in from the Discord showcase that still carry the title the
 * import made up from their race ("Blood Elf transmog"), after what their pieces share
 * ("Dark Ranger General") or the item set they come from, as new imports are named
 * (src/lib/look-title.ts). A title is changed only when it is exactly the made-up one for
 * that look's own code, so nothing a player typed is touched, and a look whose pieces
 * share no name keeps its title.
 *
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/retitle-discord-looks.mts          # dry run
 *   pnpm dlx tsx@4.23.15 --conditions=react-server tools/retitle-discord-looks.mts --apply  # write
 *
 * Needs a logged-in, linked Supabase CLI: reads and writes go through it, as the
 * database's owner, like tools/import-discord-showcase.mts.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retitled } from "@/lib/showcase-post";

const APPLY = process.argv.includes("--apply");

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

function query<T>(text: string): T[] {
  const dir = mkdtempSync(join(tmpdir(), "retitle-sql-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, text);
  const out = execFileSync("pnpm", ["exec", "supabase", "db", "query", "--linked", "-f", file], {
    encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).rows as T[];
}

const looks = query<{ id: string; title: string; code: string }>(`
  select o.id, o.title, o.code
  from public.outfits o
  join public.discord_looks d on d.outfit_id = o.id
  where not o.is_private
  order by o.created_at`);

const renames = looks.flatMap((look) => {
  const to = retitled(look);
  return to ? [{ id: look.id, from: look.title, to }] : [];
});

console.log(`${looks.length} public looks from Discord, ${renames.length} to rename. The rest keep a title their player gave, or have pieces that share no name.\n`);
for (const r of renames) console.log(`  ${r.id}  ${r.from.padEnd(26)} -> ${r.to}`);
if (!APPLY || !renames.length) {
  if (!APPLY) console.log("\nDry run. Add --apply to write.");
  process.exit(0);
}

// Each only while its title is still the made-up one, in case its player renamed it meanwhile.
const updates = renames.map((r) =>
  `update public.outfits set title = ${sql(r.to)} where id = ${sql(r.id)}::uuid and title = ${sql(r.from)};`);
query(`begin;\n${updates.join("\n")}\ncommit;\nselect count(*) from public.outfits;`);
console.log(`\nRenamed ${renames.length} looks.`);
