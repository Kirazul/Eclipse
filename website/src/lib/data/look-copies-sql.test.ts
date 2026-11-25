import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// How many visitors copied a look's code: once per visitor, recorded only by the site's
// server with the secret key, and kept as a salted fingerprint, never the address itself.
// Proved on a real Postgres, with Supabase's roles and grants stubbed and the outfits
// table cut to the columns these rules read. service_role skips row security, as on Supabase.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261119090000_look_copies.sql"), "utf8");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema private;
  create table public.outfits (
    id uuid primary key,
    is_private boolean not null default false
  );
  revoke update on public.outfits from authenticated, anon;
`;

const LOOK = "10000000-0000-0000-0000-000000000001";
const HIDDEN = "10000000-0000-0000-0000-000000000002";
const MISSING = "10000000-0000-0000-0000-000000000009";
const VISITOR = "203.0.113.7|Mozilla/5.0 Firefox/140";
const OTHER = "198.51.100.4|Mozilla/5.0 Chrome/141";

let db: PGlite;

const copy = (look: string, visitor: string) => db.query("select public.record_copy($1, $2)", [look, visitor]);
const copies = async (look: string) =>
  (await db.query<{ copies: number }>("select copies from public.outfits where id = $1", [look])).rows[0].copies;
const codeOf = (e: unknown) => (e as { code?: string }).code;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.query("insert into public.outfits (id, is_private) values ($1, false), ($2, true)", [LOOK, HIDDEN]);
  await db.exec(MIGRATION);
  await db.exec("set role service_role");
});

describe("counting copies of a look", () => {
  it("starts every look at none", async () => {
    expect(await copies(LOOK)).toBe(0);
  });

  it("counts a visitor once, however often they copy", async () => {
    await copy(LOOK, VISITOR);
    await copy(LOOK, VISITOR);
    await copy(LOOK, VISITOR);
    expect(await copies(LOOK)).toBe(1);
  });

  it("counts each visitor", async () => {
    await copy(LOOK, VISITOR);
    await copy(LOOK, OTHER);
    expect(await copies(LOOK)).toBe(2);
  });

  it("counts a private look's copies for nobody, and ignores a look that is not there", async () => {
    await copy(HIDDEN, VISITOR);
    expect(await copies(HIDDEN)).toBe(0);
    await expect(copy(MISSING, VISITOR)).resolves.toBeDefined();
    await db.exec("reset role");
    expect((await db.query("select * from private.outfit_copies")).rows).toHaveLength(0);
  });

  it("keeps a fingerprint, never the visitor's address", async () => {
    await copy(LOOK, VISITOR);
    await db.exec("reset role");
    const rows = (await db.query<{ visitor: Uint8Array }>("select visitor from private.outfit_copies")).rows;
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0].visitor).toString("utf8")).not.toContain("203.0.113.7");
    expect(rows[0].visitor).toHaveLength(32);
  });

  it("salts the fingerprint, so a bare hash of an address cannot find it", async () => {
    await copy(LOOK, VISITOR);
    await db.exec("reset role");
    const { rows } = await db.query<{ hit: boolean }>(
      "select exists (select 1 from private.outfit_copies where visitor = sha256(convert_to($1 || ':' || $2, 'UTF8'))) as hit",
      [LOOK, VISITOR],
    );
    expect(rows[0].hit).toBe(false);
  });
});

describe("who can count", () => {
  for (const role of ["anon", "authenticated"]) {
    it(`refuses ${role}, so nobody can inflate a count from the public API`, async () => {
      await db.exec(`reset role; set role ${role}`);
      expect(codeOf(await copy(LOOK, VISITOR).catch((e: unknown) => e))).toBe("42501");
      expect(codeOf(await db.query("update public.outfits set copies = 999").catch((e: unknown) => e))).toBe("42501");
    });
  }
});
