import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// A new look's code is at most 32768 characters (CODE_MAX in src/lib/limits.ts), however it
// arrives. Looks published before keep their longer codes, and stay votable: a vote
// rewrites the row, which a CHECK constraint would refuse. Proved on a real Postgres with
// the outfits table cut to the columns the rule reads.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261125101000_new_codes_capped.sql"), "utf8");

const SCHEMA = `
  create role anon; create role authenticated;
  create schema private;
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    title text not null default 'A look',
    code text not null check (code ilike 'ECA1:%' and char_length(code) <= 262144),
    upvotes integer not null default 0
  );
`;

const code = (length: number) => `ECA1:${"A".repeat(length - 5)}`;
const codeOf = (e: unknown) => (e as { code?: string }).code;

let db: PGlite;
let old: string;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  old = (await db.query<{ id: string }>("insert into public.outfits (code) values ($1) returning id", [code(262144)])).rows[0].id;
  await db.exec(MIGRATION);
});

const publish = (c: string) => db.query("insert into public.outfits (code) values ($1)", [c]);

describe("a new look's code", () => {
  it("may be as long as the limit", async () => {
    await expect(publish(code(32768))).resolves.toBeTruthy();
  });

  it("is refused past it", async () => {
    await expect(publish(code(32769))).rejects.toSatisfy((e) => codeOf(e) === "23514");
  });

  it("cannot be swapped for a longer one later", async () => {
    await publish(code(100));
    await expect(db.query("update public.outfits set code = $1 where id <> $2", [code(32769), old]))
      .rejects.toSatisfy((e) => codeOf(e) === "23514");
  });
});

describe("a look published before the limit", () => {
  it("keeps its long code, and can still be voted on and renamed", async () => {
    await db.query("update public.outfits set upvotes = upvotes + 1, title = 'Renamed' where id = $1", [old]);
    const row = (await db.query<{ n: number; upvotes: number }>(
      "select char_length(code) as n, upvotes from public.outfits where id = $1", [old])).rows[0];
    expect(row).toEqual({ n: 262144, upvotes: 1 });
  });

  it("keeps it when an update names the column without changing it", async () => {
    await expect(db.query("update public.outfits set code = code where id = $1", [old])).resolves.toBeTruthy();
  });
});
