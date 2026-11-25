import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Trending ranks by upvotes, each worth half as much a week later. Proved on a real
// Postgres, with Supabase's roles and auth.uid() stubbed and the outfits table cut to the
// columns the score reads.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const VOTE = migration("20261120090000_vote_toggle.sql");
const TRENDING = migration("20261122120000_trending_holds.sql");

const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create schema private;
  grant usage on schema private to anon, authenticated;
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
  create function public.upvote_outfit(target uuid) returns integer language sql as $$ select 0 $$;
`;

const VOTER = "00000000-0000-0000-0000-000000000002";
const look = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(VOTE);
  await db.query("insert into public.profiles (id) values ($1)", [VOTER]);
});

const post = (n: number, daysAgo: number, upvotes = 0) =>
  db.query("insert into public.outfits (id, upvotes, created_at) values ($1, $2, now() - make_interval(days => $3))", [look(n), upvotes, daysAgo]);

async function vote(n: number, up: boolean) {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${VOTER}', false);`);
  await db.query("select public.set_outfit_vote($1, $2)", [look(n), up]);
  await db.exec("reset role;");
}

const score = async (n: number) =>
  (await db.query<{ s: number }>("select trending_score as s from public.outfits where id = $1", [look(n)])).rows[0].s;

/** The looks as the Gallery's Trending lists them. */
const order = async () =>
  (await db.query<{ id: string }>("select id from public.outfits order by trending_score desc, created_at desc, id")).rows.map((r) => Number(r.id.slice(-4)));

describe("trending", () => {
  it("never sinks a look for being upvoted, however old it is", async () => {
    await db.exec(TRENDING);
    await post(1, 30, 10);
    const before = await score(1);
    await vote(1, true);
    expect(await score(1)).toBeGreaterThan(before);
  });

  it("puts a look back where it was when its upvote is taken back", async () => {
    await db.exec(TRENDING);
    await post(1, 30, 10);
    const before = await score(1);
    await vote(1, true);
    await vote(1, false);
    expect(await score(1)).toBe(before);
  });

  it("lists the newest first among looks nobody voted on", async () => {
    await db.exec(TRENDING);
    await post(1, 9);
    await post(2, 1);
    await post(3, 4);
    expect(await order()).toEqual([2, 3, 1]);
  });

  it("holds an upvoted look above newer ones for a week per doubling, then lets it go", async () => {
    await db.exec(TRENDING);
    await post(1, 20, 1); // one upvote is worth a week, so an unvoted look 8 days newer passes it
    await post(2, 12);
    await post(3, 30, 3); // three are worth two weeks, so one 13 days newer does not
    await post(4, 17);
    expect(await score(2)).toBeGreaterThan(await score(1));
    expect(await score(3)).toBeGreaterThan(await score(4));
  });

  it("scores the looks already there, so old and new scores compare", async () => {
    await post(1, 40, 2);
    await db.query("update public.outfits set trending_score = 4.35");
    await post(2, 1);
    await db.exec(TRENDING);
    await post(3, 0);
    expect(await order()).toEqual([3, 2, 1]);
  });

  it("cannot be set by hand", async () => {
    await db.exec(TRENDING);
    await post(1, 5);
    const before = await score(1);
    await db.query("update public.outfits set upvotes = 0, trending_score = 999");
    expect(await score(1)).toBe(before);
  });
});
