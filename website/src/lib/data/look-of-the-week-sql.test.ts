import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Look of the Week's rule, proved on a real Postgres: a week counts only when the
// community posted five looks or more in it, and the pick is the most upvoted of the
// looks posted that week. Tables are stubbed with the columns the function reads.
const RULE = readFileSync(join(process.cwd(), "supabase/migrations/20261114200000_look_of_the_week_needs_five.sql"), "utf8");

const SCHEMA = `
  create role anon; create role authenticated;
  create table public.profiles (id uuid primary key);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references public.profiles (id),
    created_at timestamptz not null default now()
  );
  create table public.discord_looks (
    outfit_id uuid primary key references public.outfits (id) on delete cascade,
    discord_id text not null
  );
  create table public.outfit_votes (
    outfit_id uuid not null references public.outfits (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (outfit_id, user_id)
  );
`;

const AUTHOR = "00000000-0000-0000-0000-000000000001";
const voter = (n: number) => `00000000-0000-0000-0000-1${String(n).padStart(11, "0")}`;
const look = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(RULE);
  await db.query("insert into public.profiles (id) values ($1)", [AUTHOR]);
  for (let n = 1; n <= 9; n++) await db.query("insert into public.profiles (id) values ($1)", [voter(n)]);
});

/** A look its author published, `days` ago. */
const published = (n: number, days = 1) =>
  db.query("insert into public.outfits (id, author_id, created_at) values ($1, $2, now() - make_interval(days => $3))", [look(n), AUTHOR, days]);

/** A look shared on Discord and imported with no account yet. */
const shared = async (n: number, days = 1) => {
  await db.query("insert into public.outfits (id, author_id, created_at) values ($1, null, now() - make_interval(days => $2))", [look(n), days]);
  await db.query("insert into public.discord_looks (outfit_id, discord_id) values ($1, '354266414397390858')", [look(n)]);
};

/** One of the game's own sets: no author and never shared. */
const gameSet = (n: number) => db.query("insert into public.outfits (id, author_id) values ($1, null)", [look(n)]);

/** `count` upvotes on a look, the last one `minutesAgo` minutes ago. */
async function upvote(n: number, count: number, minutesAgo = 0) {
  for (let v = 1; v <= count; v++) {
    await db.query("insert into public.outfit_votes (outfit_id, user_id, created_at) values ($1, $2, now() - make_interval(mins => $3))", [
      look(n), voter(v), minutesAgo + count - v,
    ]);
  }
}

async function pick() {
  const { rows } = await db.query<{ outfit_id: string; votes: number }>("select outfit_id, votes::int as votes from public.look_of_the_week()");
  return rows[0] ?? null;
}

describe("Look of the Week", () => {
  it("picks nobody while fewer than five looks were posted this week", async () => {
    for (let n = 1; n <= 4; n++) await published(n);
    await upvote(1, 3);
    expect(await pick()).toBeNull();
  });

  it("picks the most upvoted of the week's looks once five were posted", async () => {
    for (let n = 1; n <= 5; n++) await published(n);
    await upvote(2, 1);
    await upvote(4, 3);
    expect(await pick()).toEqual({ outfit_id: look(4), votes: 3 });
  });

  it("counts looks shared on Discord as posted, but not the game's own sets", async () => {
    for (let n = 1; n <= 3; n++) await published(n);
    await shared(4);
    await gameSet(5);
    await upvote(4, 2);
    expect(await pick()).toBeNull();
    await shared(6);
    expect(await pick()).toEqual({ outfit_id: look(4), votes: 2 });
  });

  it("leaves out a look posted before the week, however liked, and does not count it toward five", async () => {
    for (let n = 1; n <= 4; n++) await published(n);
    await published(5, 8);
    await upvote(5, 9);
    await upvote(1, 1);
    expect(await pick()).toBeNull();
    await published(6);
    expect(await pick()).toEqual({ outfit_id: look(1), votes: 1 });
  });

  it("picks nobody when none of the week's looks has an upvote", async () => {
    for (let n = 1; n <= 6; n++) await published(n);
    expect(await pick()).toBeNull();
  });

  it("gives a tie to the look that reached its count first", async () => {
    for (let n = 1; n <= 5; n++) await published(n);
    await upvote(1, 2, 0);
    await upvote(3, 2, 60);
    expect(await pick()).toEqual({ outfit_id: look(3), votes: 2 });
  });
});
