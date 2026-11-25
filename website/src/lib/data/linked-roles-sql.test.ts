import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Discord Linked Roles' database side, proved on a real Postgres with Supabase's roles,
// auth.users, auth.identities and the outfit columns it reads stubbed.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261120150000_discord_linked_roles.sql"), "utf8");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create schema private;
  create table auth.users (id uuid primary key);
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid,
    upvotes integer not null default 0,
    is_private boolean not null default false
  );
`;

const PLAYER = "00000000-0000-0000-0000-000000000001";
const PLAYER_DISCORD = "354266414397390858";
const STRANGER_DISCORD = "708022303841058907";
const LATER = "2026-11-27T00:00:00Z";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const codeOf = (e: unknown) => (e as { code?: string }).code;
const save = (discord: string) =>
  one<{ stats: { looks: number; upvotes: number; name: string } | null }>(
    "select public.discord_link_save($1, 'access', 'refresh', $2) as stats", [discord, LATER],
  );

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
  await db.query("insert into auth.users values ($1)", [PLAYER]);
  await db.query("insert into auth.identities values ($1, 'discord', $2)", [PLAYER, PLAYER_DISCORD]);
  await db.query("insert into public.profiles values ($1, 'Kira')", [PLAYER]);
  await db.query("insert into public.outfits (author_id, upvotes) values ($1, 7), ($1, 5)", [PLAYER]);
  await db.query("insert into public.outfits (author_id, upvotes, is_private) values ($1, 100, true)", [PLAYER]);
});

describe("Discord Linked Roles", () => {
  it("keeps a player's connection and judges them on their public looks", async () => {
    expect((await save(PLAYER_DISCORD)).stats).toEqual({ looks: 2, upvotes: 12, name: "Kira" });
    const { n } = await one<{ n: number }>("select count(*)::int as n from private.discord_role_connections");
    expect(n).toBe(1);
  });

  it("keeps nothing for a Discord account no site account signs in with", async () => {
    expect((await save(STRANGER_DISCORD)).stats).toBeNull();
    const { n } = await one<{ n: number }>("select count(*)::int as n from private.discord_role_connections");
    expect(n).toBe(0);
  });

  it("replaces the token on a second connection, and on a refresh", async () => {
    await save(PLAYER_DISCORD);
    await save(PLAYER_DISCORD);
    await db.query("select public.discord_link_tokens($1, 'new-access', 'new-refresh', $2)", [PLAYER_DISCORD, LATER]);
    const rows = (await db.query<{ access_token: string; stats: { looks: number } }>("select * from public.discord_links()")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].access_token).toBe("new-access");
    expect(rows[0].stats.looks).toBe(2);
  });

  it("forgets a connection Discord no longer honours", async () => {
    await save(PLAYER_DISCORD);
    await db.query("select public.discord_link_forget($1)", [PLAYER_DISCORD]);
    expect((await db.query("select * from public.discord_links()")).rows).toEqual([]);
  });

  it("is out of reach of visitors, signed in or not", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      const error = await db.query("select * from public.discord_links()").catch((e) => e);
      expect(codeOf(error)).toBe("42501");
      await db.exec("reset role");
    }
  });
});
