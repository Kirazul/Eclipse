import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Moderating from Discord's report alerts. Proved on a real Postgres, with Supabase's
// roles, auth.identities and the tables the migration reads stubbed. service_role skips
// row security, as on Supabase.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261120120000_discord_moderation.sql"), "utf8");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create schema private;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create table public.moderators (user_id uuid primary key);
  create table public.outfits (
    id uuid primary key,
    gallery text[] not null default '{}',
    reports_cleared_at timestamptz
  );
  create table public.outfit_comments (
    id uuid primary key,
    outfit_id uuid not null references public.outfits (id) on delete cascade,
    reports_cleared_at timestamptz
  );
`;

const MOD = "00000000-0000-0000-0000-000000000001";
const PLAYER = "00000000-0000-0000-0000-000000000002";
const MOD_DISCORD = "354266414397390858";
const PLAYER_DISCORD = "708022303841058907";
const LOOK = "10000000-0000-0000-0000-000000000001";
const COMMENT = "20000000-0000-0000-0000-000000000001";
const SHOT = `${PLAYER}/aaaaaaaa-0000-0000-0000-000000000001.avif`;

let db: PGlite;
const codeOf = (e: unknown) => (e as { code?: string }).code;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
  await db.query("insert into auth.identities values ($1, 'discord', $2), ($3, 'discord', $4)", [MOD, MOD_DISCORD, PLAYER, PLAYER_DISCORD]);
  await db.query("insert into public.moderators values ($1)", [MOD]);
  await db.query("insert into public.outfits (id, gallery) values ($1, array[$2])", [LOOK, SHOT]);
  await db.query("insert into public.outfit_comments (id, outfit_id) values ($1, $2)", [COMMENT, LOOK]);
});

describe("moderating from Discord", () => {
  it("knows a moderator by their Discord account, and nobody else", async () => {
    expect((await one<{ m: boolean }>("select public.discord_is_moderator($1) as m", [MOD_DISCORD])).m).toBe(true);
    expect((await one<{ m: boolean }>("select public.discord_is_moderator($1) as m", [PLAYER_DISCORD])).m).toBe(false);
  });

  it("keeps a reported look or comment for a moderator", async () => {
    await db.query("select public.discord_keep_reported($1, 'look', $2)", [MOD_DISCORD, LOOK]);
    await db.query("select public.discord_keep_reported($1, 'comment', $2)", [MOD_DISCORD, COMMENT]);
    expect((await one<{ at: Date | null }>("select reports_cleared_at as at from public.outfits")).at).not.toBeNull();
    expect((await one<{ at: Date | null }>("select reports_cleared_at as at from public.outfit_comments")).at).not.toBeNull();
  });

  it("refuses anyone who is not a moderator, whatever they click", async () => {
    for (const sql of [
      "select public.discord_keep_reported($1, 'look', $2)",
      "select public.discord_delete_reported($1, 'look', $2)",
    ]) {
      const error = await db.query(sql, [PLAYER_DISCORD, LOOK]).catch((e) => e);
      expect(codeOf(error)).toBe("42501");
    }
    expect((await one<{ n: number }>("select count(*)::int as n from public.outfits")).n).toBe(1);
  });

  it("deletes a look and hands back its screenshots, once", async () => {
    const first = await one<{ shots: string[] | null }>("select public.discord_delete_reported($1, 'look', $2) as shots", [MOD_DISCORD, LOOK]);
    expect(first.shots).toEqual([SHOT]);
    expect((await one<{ n: number }>("select count(*)::int as n from public.outfits")).n).toBe(0);
    const again = await one<{ shots: string[] | null }>("select public.discord_delete_reported($1, 'look', $2) as shots", [MOD_DISCORD, LOOK]);
    expect(again.shots).toBeNull();
  });

  it("deletes a comment, and says when it is already gone", async () => {
    const first = await one<{ shots: string[] | null }>("select public.discord_delete_reported($1, 'comment', $2) as shots", [MOD_DISCORD, COMMENT]);
    expect(first.shots).toEqual([]);
    const again = await one<{ shots: string[] | null }>("select public.discord_delete_reported($1, 'comment', $2) as shots", [MOD_DISCORD, COMMENT]);
    expect(again.shots).toBeNull();
    const kept = await one<{ ok: boolean }>("select public.discord_keep_reported($1, 'comment', $2) as ok", [MOD_DISCORD, COMMENT]);
    expect(kept.ok).toBe(false);
  });

  it("is out of reach of visitors, signed in or not", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      const error = await db.query("select public.discord_delete_reported($1, 'look', $2)", [MOD_DISCORD, LOOK]).catch((e) => e);
      expect(codeOf(error)).toBe("42501");
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect((await one<{ m: boolean }>("select public.discord_is_moderator($1) as m", [MOD_DISCORD])).m).toBe(true);
    await db.exec("reset role");
  });
});
