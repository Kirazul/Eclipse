import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// An upvote is taken back by voting again. Proved on a real Postgres, with Supabase's roles
// and auth.uid() stubbed and the outfits table cut to the columns the vote reads.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261120090000_vote_toggle.sql"), "utf8");

const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table public.profiles (id uuid primary key);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references public.profiles (id),
    is_private boolean not null default false,
    upvotes integer not null default 0,
    trending_score real not null default 0,
    created_at timestamptz not null default now()
  );
  create table public.outfit_votes (
    outfit_id uuid not null references public.outfits (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (outfit_id, user_id)
  );
`;

const AUTHOR = "00000000-0000-0000-0000-000000000001";
const VOTER = "00000000-0000-0000-0000-000000000002";
const LOOK = "10000000-0000-0000-0000-000000000001";

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(MIGRATION);
  for (const id of [AUTHOR, VOTER]) await db.query("insert into public.profiles (id) values ($1)", [id]);
  await db.query("insert into public.outfits (id, author_id) values ($1, $2)", [LOOK, AUTHOR]);
});

async function vote(user: string | null, up: boolean, look = LOOK) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return (await db.query<{ n: number }>("select public.set_outfit_vote($1, $2) as n", [look, up])).rows[0].n;
  } finally {
    await db.exec("reset role;");
  }
}

const score = async () =>
  (await db.query<{ upvotes: number; trending_score: number }>("select upvotes, trending_score from public.outfits")).rows[0];

describe("set_outfit_vote", () => {
  it("counts a vote once and takes it back", async () => {
    expect(await vote(VOTER, true)).toBe(1);
    expect(await vote(VOTER, true)).toBe(1);
    expect((await score()).trending_score).toBeGreaterThan(0);
    expect(await vote(VOTER, false)).toBe(0);
    expect(await vote(VOTER, false)).toBe(0);
    expect(await score()).toEqual({ upvotes: 0, trending_score: 0 });
    expect((await db.query("select * from public.outfit_votes")).rows).toEqual([]);
  });

  it("refuses a signed-out caller", async () => {
    await expect(vote(null, true)).rejects.toThrow(/sign in/);
  });

  it("counts nothing on a look the voter cannot see", async () => {
    await db.query("update public.outfits set is_private = true");
    expect(await vote(VOTER, true)).toBe(0);
    expect(await vote(AUTHOR, true)).toBe(1);
  });

  it("cannot be called by a visitor", async () => {
    await db.exec("set role anon;");
    await expect(db.query("select public.set_outfit_vote($1, true)", [LOOK])).rejects.toThrow(/permission denied/);
    await db.exec("reset role;");
  });
});
