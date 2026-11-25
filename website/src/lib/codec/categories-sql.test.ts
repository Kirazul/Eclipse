import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { codeCategories } from "./categories";
import { OUTFIT_TAG } from "./outfit";

// The database files every look by its code (the look_categories migration), and the
// site files the game's own sets and the publish preview the same way in TypeScript.
// Every code the game wrote must land in the same categories on both sides.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const MIGRATIONS = ["20261110090000_look_categories.sql", "20261110120000_look_categories_strict.sql"].map(migration);
const golden: { name: string; code: string }[] = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/codec/golden/fields.json"), "utf8"),
);
const code = (text: string) => OUTFIT_TAG + Buffer.from(text).toString("base64");
const COSM = "cosm 71111 0 1.0000 0.0000 0.0000 0.0000 0.000 0.000 0.000 0 0 250.000 1.0000 1.0000 0.3500 0.000 0.000 20.000 0";
const cosm = (line: string) => code(`slot 0 231001\n${line}\n`);

const CASES = [
  ...golden.map((g) => g.code),
  code("slot 0 0\n"),
  code("display 1234 0\n"),
  code("look 1 0 2 3 4 5 6\n"),
  code("rlook 37 f 1 2 3\n"),
  code("mount 5\nslot 4 1001735\ndisplay 9 0\n"),
  code("mountfly 7\n"),
  "ECA1:!!!",
  // A worn cosmetic, then every way the decoder (readCosmetic) refuses one.
  cosm(COSM),
  cosm(`${COSM} 7`),
  cosm(COSM.replace("cosm 71111", "cosm 0")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 0.0000")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 -1")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 abc")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 0x10")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 1e400")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 0 .5")),
  cosm(COSM.replace("cosm 71111 0 1.0000", "cosm 71111 1.5 1.0000")),
  cosm(COSM.replace(" 0.000 0 0 250.000", " 0.000 0 2 250.000")),
  cosm(COSM.replace(" 0.000 0 0 250.000", " 0.000 0.5 0 250.000")),
  cosm(COSM.replace(/ 0$/, " 2")),
  cosm(`${COSM} \r`),
  cosm(`${COSM}\t`),
  cosm(` ${COSM}`),
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema private;
    create table public.outfits (id serial primary key, code text not null, category text not null);
  `);
  for (const m of MIGRATIONS) await db.exec(m);
});

const inSql = async (c: string) =>
  (await db.query<{ r: string[] }>("select private.code_categories($1) as r", [c])).rows[0].r;

describe("the database's categories", () => {
  it("match the site's for every code the game wrote", async () => {
    for (const c of CASES) expect([c, await inSql(c)]).toEqual([c, codeCategories(c)]);
  });

  it("file a cosmetic exactly when the decoder reads one", async () => {
    const worn = await Promise.all([cosm(COSM), cosm(` ${COSM}`), cosm(COSM.replace("cosm 71111", "cosm 0"))].map(inSql));
    expect(worn.map((c) => c.includes("Cosmetics"))).toEqual([true, false, false]);
  });

  it("are written from the code on insert and on a changed code, whatever the client sent", async () => {
    const { rows } = await db.query<{ id: number; categories: string[] }>(
      "insert into public.outfits (code) values ($1) returning id, categories",
      [code("display 9 0\n")],
    );
    expect(rows[0].categories).toEqual(["Creature morph"]);
    const after = await db.query<{ categories: string[] }>(
      "update public.outfits set code = $1, categories = '{Cosmetics}' where id = $2 returning categories",
      [code("slot 0 231001\n"), rows[0].id],
    );
    expect(after.rows[0].categories).toEqual(["Armor"]);
  });
});
