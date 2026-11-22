import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeOutfit, enchanted, OUTFIT_TAG } from "@/lib/codec/outfit";

// The Gallery's "mount" and "enchant" tags are filters, so the database writes them from
// the code, as it does categories. Every code the game wrote must get the same tags as
// the site's decoder would give it.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const golden: { name: string; code: string }[] = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/codec/golden/fields.json"), "utf8"),
);
const code = (text: string) => OUTFIT_TAG + Buffer.from(text).toString("base64");

const NO_ENCHANT = "glowok 1\nglow 0 0 0 0 73CCFF\nglow 1 0 1 1 1CFF00\n";
const CASES = [
  ...golden.map((g) => g.code),
  code(NO_ENCHANT),
  code("glow 0 3370 1 1 73CCFF\n"),
  // An id the game ignores: the weapon keeps its own enchant.
  code("glow 1 3370 0 1 73CCFF\n"),
  // The last line for a hand wins, as in the decoder.
  code("glow 0 3370 1 1 73CCFF\nglow 0 0 1 0 000000\n"),
  code("glow 0 0 1 0 000000\nglow 1 2673 1 0 FFCC38\n"),
  // Lines the decoder drops: a third hand, no colour, a colour that is not one.
  code("glow 2 3370 1 1 73CCFF\n"),
  code("glow 0 3370 1 1\n"),
  code("glow 0 3370 1 1 zzz\n"),
  code("mount 134653\nglow 0 3370 1 1 73CCFF\n"),
  code("mountfly 5\n"),
  "ECA1:!!!",
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema private;
    create table public.outfits (id serial primary key, code text not null, tags text[] not null default '{}', category text);
    insert into public.outfits (code, tags) values ('${code(NO_ENCHANT)}', '{mount,enchant,pvp}');
  `);
  // For private.code_last, which reads a code's last line of a kind.
  await db.exec(migration("20261110090000_look_categories.sql"));
  await db.exec(migration("20261122130000_look_tags.sql"));
});

/** The tags the site's own decoder gives a code. */
function expected(c: string): string[] {
  const r = decodeOutfit(c);
  if (!r.ok) return [];
  return [
    ...(r.outfit.mount || r.outfit.mountFly ? ["mount"] : []),
    ...(r.outfit.glow.some(enchanted) ? ["enchant"] : []),
  ];
}

const insert = async (c: string, tags: string[] = []) =>
  (await db.query<{ id: number; tags: string[] }>("insert into public.outfits (code, tags) values ($1, $2) returning id, tags", [c, tags])).rows[0];

describe("the database's tags", () => {
  it("match the site's decoder for every code the game wrote", async () => {
    for (const c of CASES) expect([c, (await insert(c)).tags]).toEqual([c, expected(c)]);
  });

  it("cannot be claimed by an author, on a new look or a changed one", async () => {
    const made = await insert(code("slot 0 231001\n"), ["enchant", "pvp"]);
    expect(made.tags).toEqual(["pvp"]);
    const { rows } = await db.query<{ tags: string[] }>(
      "update public.outfits set tags = '{mount}' where id = $1 returning tags", [made.id],
    );
    expect(rows[0].tags).toEqual([]);
  });

  it("stay within six, the code's own first", async () => {
    const made = await insert(code("mount 5\n"), ["a", "b", "c", "d", "e", "f"]);
    expect(made.tags).toEqual(["mount", "a", "b", "c", "d", "e"]);
  });

  it("were put right on the looks already there", async () => {
    const { rows } = await db.query<{ tags: string[] }>("select tags from public.outfits where id = 1");
    expect(rows[0].tags).toEqual(["pvp"]);
  });
});
