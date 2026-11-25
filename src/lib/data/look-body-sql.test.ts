import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { decodeOutfit, OUTFIT_TAG } from "@/lib/codec/outfit";
import { RACE_LABEL } from "@/lib/domain";

vi.mock("server-only", () => ({}));
const { resolveOutfit } = await import("@/lib/catalog");

// The Gallery filters by race and body, so the database reads both from the code, as it
// does categories and tags, rather than taking the author's word. Every code the game
// wrote must get the race and body the site's own decoder reads from it.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const golden: { name: string; code: string }[] = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/codec/golden/fields.json"), "utf8"),
);
const code = (text: string) => OUTFIT_TAG + Buffer.from(text).toString("base64");

const CASES = [
  ...golden.map((g) => g.code),
  ...Object.keys(RACE_LABEL).map((race) => code(`rlook ${race} f 1 2 3\n`)),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 266].map((race) => code(`look ${race} 0 1 2 3 4 5\n`)),
  code("look 10 1 2 3 4 5 6\n"),
  code("look 10 7 2 3 4 5 6 9 9\n"),
  // A retail race over its classic fallback, in either order: the rlook is what the code means.
  code("rlook voidelf f 1 2 3\nlook 10 1 2 3 4 5 6\n"),
  code("look 1 0 2 3 4 5 6\nrlook vulpera m 1 2 3\n"),
  // The last line of a kind wins.
  code("look 1 0 2 3 4 5 6\nlook 4 1 2 3 4 5 6\n"),
  code("rlook orc m\nrlook gnome f\n"),
  // A race the site has no art for, and lines the decoder refuses.
  code("rlook 37 f 1 2 3\n"),
  code("rlook human x 1 2 3\n"),
  code("rlook human\n"),
  code("look 1 0 2 3 4 5\n"),
  code("look 1 0 2 3 4 5 6x\n"),
  code("look -1 0 2 3 4 5 6\n"),
  code("slot 0 231001\n"),
  code("display 1234 0\n"),
  "ECA1:!!!",
  "not a code",
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema private;
    create role anon; create role authenticated;
    create table public.outfits (
      id serial primary key, code text not null, race text, class_name text, armor text,
      is_private boolean not null default false, category text, tags text[] not null default '{}'
    );
    insert into public.outfits (code, race) values ('${code("rlook vulpera f 1 2 3\n")}', 'human');
    insert into public.outfits (code, race) values ('${code("slot 0 231001\n")}', 'human');
  `);
  // For private.code_text, which reads a code as the decoder does.
  await db.exec(migration("20261110090000_look_categories.sql"));
  await db.exec(migration("20261122130000_look_tags.sql"));
  await db.exec(migration("20261125120000_look_body_from_code.sql"));
});

/** The race key and body the site's own decoder gives a code. */
function expected(c: string): { race: string | null; sex: string | null } {
  const r = decodeOutfit(c);
  if (!r.ok) return { race: null, sex: null };
  const resolved = resolveOutfit(r.outfit);
  return { race: resolved.raceKey, sex: resolved.sex?.toLowerCase() ?? null };
}

const insert = async (c: string, race: string | null = null) =>
  (await db.query<{ id: number; race: string | null; sex: string | null }>(
    "insert into public.outfits (code, race) values ($1, $2) returning id, race, sex", [c, race],
  )).rows[0];

describe("a look's race and body in the database", () => {
  it("match the site's decoder for every code the game wrote", async () => {
    for (const c of CASES) {
      const { race, sex } = await insert(c);
      expect({ c, race, sex }).toEqual({ c, ...expected(c) });
    }
  });

  it("come from the code over a different race the author picked", async () => {
    const made = await insert(code("rlook bloodelf f\n"), "human");
    expect(made).toMatchObject({ race: "bloodelf", sex: "female" });
    const claimed = await db.query<{ race: string | null; sex: string | null }>(
      "update public.outfits set race = 'orc', sex = 'male' where id = $1 returning race, sex", [made.id],
    );
    expect(claimed.rows[0]).toEqual({ race: "bloodelf", sex: "female" });
  });

  it("keep the author's race when the code carries none", async () => {
    const made = await insert(code("slot 0 231001\n"), "human");
    expect(made).toMatchObject({ race: "human", sex: null });
    const changed = await db.query<{ race: string | null; sex: string | null }>(
      "update public.outfits set code = $1 where id = $2 returning race, sex", [code("rlook vulpera m\n"), made.id],
    );
    expect(changed.rows[0]).toEqual({ race: "vulpera", sex: "male" });
  });

  it("are put right on the looks already there only where the code carries a race", async () => {
    const { rows } = await db.query<{ id: number; race: string; sex: string | null }>(
      "select id, race, sex from public.outfits where id in (1, 2) order by id",
    );
    expect(rows).toEqual([
      { id: 1, race: "vulpera", sex: "female" },
      { id: 2, race: "human", sex: null },
    ]);
  });
});

describe("the Gallery's filter choices", () => {
  it("offer only what a public look has", async () => {
    await db.exec(`
      delete from public.outfits;
      insert into public.outfits (code, class_name, armor) values
        ('${code("rlook vulpera f\n")}', 'Mage', 'cloth'),
        ('${code("look 10 0 1 2 3 4 5\n")}', null, null),
        ('${code("slot 0 231001\n")}', null, 'plate');
      insert into public.outfits (code, class_name, armor, is_private) values
        ('${code("rlook orc m\n")}', 'Warrior', 'mail', true);
    `);
    const { rows } = await db.query<{ r: unknown }>("select public.gallery_filter_values() as r");
    expect(rows[0].r).toEqual({
      classes: ["Mage"],
      armor: ["cloth", "plate"],
      races: ["bloodelf", "vulpera"],
      sexes: ["female", "male"],
    });
  });

  it("are empty lists, not nulls, with no looks", async () => {
    await db.exec("delete from public.outfits");
    const { rows } = await db.query<{ r: unknown }>("select public.gallery_filter_values() as r");
    expect(rows[0].r).toEqual({ classes: [], armor: [], races: [], sexes: [] });
  });
});
