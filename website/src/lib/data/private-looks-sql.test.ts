import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// A look its author set private: seen by its author alone, left out of Look of the Week
// and of the Gallery Creator role, and set public again only by its author. Proved on a
// real Postgres, with Supabase's roles, grants, auth.uid() and auth.identities stubbed and
// the outfits table cut to the columns these rules read.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261114230000_private_looks.sql"), "utf8");

const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create table public.profiles (id uuid primary key);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references public.profiles (id),
    title text not null default 'A look',
    created_at timestamptz not null default now()
  );
  alter table public.outfits enable row level security;
  create policy "outfits are public" on public.outfits for select using (true);
  create policy "edit own outfit" on public.outfits for update
    using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
  grant select on public.outfits to anon, authenticated;
  grant update (title) on public.outfits to authenticated;
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
const OTHER = "00000000-0000-0000-0000-000000000002";
const voter = (n: number) => `00000000-0000-0000-0000-1${String(n).padStart(11, "0")}`;
const look = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(MIGRATION);
  for (const id of [AUTHOR, OTHER]) await db.query("insert into public.profiles (id) values ($1)", [id]);
  for (let n = 1; n <= 9; n++) await db.query("insert into public.profiles (id) values ($1)", [voter(n)]);
});

const publish = (n: number, author = AUTHOR) =>
  db.query("insert into public.outfits (id, author_id) values ($1, $2)", [look(n), author]);
const makePrivate = (n: number) => db.query("update public.outfits set is_private = true where id = $1", [look(n)]);

/** Runs `fn` as a database role, signed in as `user` or signed out. */
async function as<T>(role: "anon" | "authenticated", user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

const visible = async (role: "anon" | "authenticated", user: string | null) =>
  as(role, user, async () => (await db.query<{ id: string }>("select id from public.outfits order by id")).rows.map((r) => r.id));

describe("a private look", () => {
  it("is seen by its author and by nobody else", async () => {
    await publish(1);
    await publish(2);
    await makePrivate(2);
    expect(await visible("authenticated", AUTHOR)).toEqual([look(1), look(2)]);
    expect(await visible("authenticated", OTHER)).toEqual([look(1)]);
    expect(await visible("anon", null)).toEqual([look(1)]);
  });

  it("starts public: every look published before this change stays in the gallery", async () => {
    await publish(1);
    expect(await visible("anon", null)).toEqual([look(1)]);
  });

  it("is set private and public again by its author", async () => {
    await publish(1);
    await as("authenticated", AUTHOR, () => db.query("update public.outfits set is_private = true where id = $1", [look(1)]));
    expect(await visible("anon", null)).toEqual([]);
    await as("authenticated", AUTHOR, () => db.query("update public.outfits set is_private = false where id = $1", [look(1)]));
    expect(await visible("anon", null)).toEqual([look(1)]);
  });

  it("cannot be hidden by anyone but its author", async () => {
    await publish(1);
    const r = await as("authenticated", OTHER, () =>
      db.query("update public.outfits set is_private = true where id = $1 returning id", [look(1)]));
    expect(r.rows).toEqual([]);
    expect(await visible("anon", null)).toEqual([look(1)]);
  });

  it("keeps its date and votes, so it returns where it stood rather than on top", async () => {
    await db.query("insert into public.outfits (id, author_id, created_at) values ($1, $2, now() - interval '3 days')", [look(1), AUTHOR]);
    await makePrivate(1);
    await as("authenticated", AUTHOR, () => db.query("update public.outfits set is_private = false where id = $1", [look(1)]));
    const { rows } = await db.query<{ old: boolean }>("select created_at < now() - interval '2 days' as old from public.outfits where id = $1", [look(1)]);
    expect(rows[0].old).toBe(true);
  });
});

describe("Look of the Week and Gallery Creator", () => {
  async function upvote(n: number, count: number) {
    for (let v = 1; v <= count; v++) {
      await db.query("insert into public.outfit_votes (outfit_id, user_id) values ($1, $2)", [look(n), voter(v)]);
    }
  }

  it("never picks a private look, however many votes it has", async () => {
    for (let n = 1; n <= 6; n++) await publish(n);
    await upvote(1, 5);
    await upvote(2, 2);
    await makePrivate(1);
    const { rows } = await db.query<{ outfit_id: string }>("select outfit_id from public.look_of_the_week()");
    expect(rows.map((r) => r.outfit_id)).toEqual([look(2)]);
  });

  it("counts only public looks towards the five a week needs", async () => {
    for (let n = 1; n <= 5; n++) await publish(n);
    await upvote(1, 3);
    await makePrivate(5);
    expect((await db.query("select * from public.look_of_the_week()")).rows).toEqual([]);
  });

  it("is held only by players with a look others can see", async () => {
    await db.query("insert into auth.identities (user_id, provider, provider_id) values ($1, 'discord', '111111111111111111')", [AUTHOR]);
    await db.query("insert into auth.identities (user_id, provider, provider_id) values ($1, 'discord', '222222222222222222')", [OTHER]);
    await publish(1, AUTHOR);
    await publish(2, OTHER);
    await makePrivate(2);
    const creators = async () => (await db.query<{ c: string }>("select c from public.discord_creators() c order by c")).rows.map((r) => r.c);
    expect(await creators()).toEqual(["111111111111111111"]);
    // A look imported from Discord counts the same way once it is private.
    await db.query("insert into public.outfits (id, author_id) values ($1, null)", [look(3)]);
    await db.query("insert into public.discord_looks (outfit_id, discord_id) values ($1, '333333333333333333')", [look(3)]);
    expect(await creators()).toEqual(["111111111111111111", "333333333333333333"]);
    await makePrivate(3);
    expect(await creators()).toEqual(["111111111111111111"]);
  });
});
