import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// A private look's comments are as private as the look, and a moderator can still read a
// reported look, and its comments, after its author makes it private. Proved on a real
// Postgres with the comments and private-looks migrations as they are live, Supabase's
// roles and auth.uid() stubbed, and the tables cut to the columns these rules read.
const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const COMMENTS = read("20261113090000_look_comments.sql");
const PRIVATE_LOOKS = read("20261114230000_private_looks.sql");
const MIGRATION = read("20261125102000_moderators_read_reported_private_looks.sql");

const SUPABASE = `
  create role anon; create role authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create schema private;
  grant usage on schema private to anon, authenticated;
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (
    id uuid primary key,
    author_id uuid references public.profiles (id),
    title text not null default 'A look',
    created_at timestamptz not null default now()
  );
  alter table public.outfits enable row level security;
  create policy "outfits are public" on public.outfits for select using (true);
  create policy "edit own outfit" on public.outfits for update
    using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
  grant select on public.outfits to anon, authenticated;
  create table public.moderators (user_id uuid primary key references public.profiles (id));
  alter table public.moderators enable row level security;
  create policy "moderators are known" on public.moderators for select using (true);
  create table public.discord_looks (outfit_id uuid primary key references public.outfits (id), discord_id text not null);
  create table public.outfit_votes (
    outfit_id uuid not null references public.outfits (id), user_id uuid not null references public.profiles (id),
    created_at timestamptz not null default now(), primary key (outfit_id, user_id)
  );
  create table public.outfit_reports (
    outfit_id uuid not null references public.outfits (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    reason text not null,
    created_at timestamptz not null default now(),
    primary key (outfit_id, user_id)
  );
  alter table public.outfit_reports enable row level security;
  revoke all on public.outfit_reports from anon, authenticated;
`;

const AUTHOR = "00000000-0000-0000-0000-000000000001";
const STRANGER = "00000000-0000-0000-0000-000000000002";
const MOD = "00000000-0000-0000-0000-000000000003";
const REPORTED = "10000000-0000-0000-0000-000000000001";
const QUIET = "10000000-0000-0000-0000-000000000002";
const COMMENT_REPORTED = "10000000-0000-0000-0000-000000000003";
const OPEN = "10000000-0000-0000-0000-000000000004";

let db: PGlite;

/** What a visitor (null), a signed-in person or a moderator reads, as themselves. */
async function as<T>(user: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

const looks = (user: string | null) =>
  as(user, async () => (await db.query<{ id: string }>("select id from public.outfits order by id")).rows.map((r) => r.id));
const commentsOn = (user: string | null, look: string) =>
  as(user, async () =>
    (await db.query<{ body: string }>("select body from public.outfit_comments where outfit_id = $1", [look])).rows.map((r) => r.body));

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(COMMENTS);
  await db.exec(PRIVATE_LOOKS);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.profiles (id, display_name) values ('${AUTHOR}', 'Author'), ('${STRANGER}', 'Stranger'), ('${MOD}', 'Mod');
    insert into public.moderators (user_id) values ('${MOD}');
    insert into public.outfits (id, author_id, is_private) values
      ('${REPORTED}', '${AUTHOR}', true), ('${QUIET}', '${AUTHOR}', true),
      ('${COMMENT_REPORTED}', '${AUTHOR}', true), ('${OPEN}', '${AUTHOR}', false);
    insert into public.outfit_reports (outfit_id, user_id, reason) values ('${REPORTED}', '${STRANGER}', 'offensive');
    insert into public.outfit_comments (outfit_id, author_id, body) values
      ('${REPORTED}', '${STRANGER}', 'On the reported look'),
      ('${QUIET}', '${STRANGER}', 'On the quiet look'),
      ('${COMMENT_REPORTED}', '${STRANGER}', 'A reported comment'),
      ('${OPEN}', '${STRANGER}', 'On the public look');
    insert into public.outfit_comment_reports (comment_id, user_id, reason)
      select id, '${AUTHOR}', 'spam' from public.outfit_comments where outfit_id = '${COMMENT_REPORTED}';
  `);
});

describe("a private look's comments", () => {
  it("are hidden from visitors and other players, as the look is", async () => {
    for (const who of [null, STRANGER]) {
      expect(await commentsOn(who, QUIET)).toEqual([]);
      expect(await commentsOn(who, REPORTED)).toEqual([]);
    }
  });

  it("are still read by the look's author", async () => {
    expect(await commentsOn(AUTHOR, QUIET)).toEqual(["On the quiet look"]);
  });

  it("show again with the look when it is public", async () => {
    expect(await commentsOn(null, OPEN)).toEqual(["On the public look"]);
    await as(AUTHOR, () => db.query("update public.outfits set is_private = false where id = $1", [QUIET]));
    expect(await commentsOn(null, QUIET)).toEqual(["On the quiet look"]);
  });
});

describe("a moderator reviewing reports", () => {
  it("reads a reported look its author made private, with its comments", async () => {
    expect(await looks(MOD)).toContain(REPORTED);
    expect(await commentsOn(MOD, REPORTED)).toEqual(["On the reported look"]);
  });

  it("reads a private look whose comment was reported", async () => {
    expect(await looks(MOD)).toContain(COMMENT_REPORTED);
    expect(await commentsOn(MOD, COMMENT_REPORTED)).toEqual(["A reported comment"]);
  });

  it("does not read a private look nobody reported", async () => {
    expect(await looks(MOD)).not.toContain(QUIET);
    expect(await commentsOn(MOD, QUIET)).toEqual([]);
  });

  it("is the only one a report opens a private look to", async () => {
    expect(await looks(STRANGER)).toEqual([OPEN]);
    expect(await looks(null)).toEqual([OPEN]);
    expect(await looks(AUTHOR)).toEqual([REPORTED, QUIET, COMMENT_REPORTED, OPEN]);
  });
});
