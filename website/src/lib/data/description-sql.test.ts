import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// A look's description is checked by the database as a comment is. Only the role, and
// the column grants an author publishes with, are stubbed.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261113120000_look_description.sql"), "utf8");

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    grant usage on schema public to authenticated;
    create table public.outfits (id serial primary key, title text not null);
    grant select on public.outfits to authenticated;
    grant usage on sequence public.outfits_id_seq to authenticated;
    grant insert (title) on public.outfits to authenticated;
  `);
  await db.exec(MIGRATION);
});

const publish = async (description: string | null) => {
  await db.exec("set role authenticated");
  try {
    await db.query("insert into public.outfits (title, description) values ('A look', $1)", [description]);
  } finally {
    await db.exec("reset role");
  }
};

const codeOf = (e: unknown) => (e as { code?: string }).code;

describe("a look's description", () => {
  it("is optional, and an author may write one when publishing", async () => {
    await publish(null);
    await publish("Crystal Scholar set,\nwith the Archcowl on top.");
    const { rows } = await db.query<{ description: string | null }>("select description from public.outfits order by id");
    expect(rows.map((r) => r.description)).toEqual([null, "Crystal Scholar set,\nwith the Archcowl on top."]);
  });

  it("refuses empty, padded, overlong or control-character text", async () => {
    for (const text of ["", " padded", "padded\n", "x".repeat(501), "bell\u0007"]) {
      await expect(publish(text), JSON.stringify(text)).rejects.toSatisfy((e) => codeOf(e) === "23514");
    }
    await expect(publish("x".repeat(500))).resolves.toBeUndefined();
  });
});
