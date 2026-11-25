import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// A look shared in the Discord showcase is credited to its player before they have an
// account, and becomes theirs when they sign in with Discord. That lives in constraints
// and a trigger, so it is proved on a real Postgres. Only Supabase's roles, auth.uid()
// and the columns the migration reads are stubbed, with the gallery rule as live.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261113180000_discord_showcase_looks.sql"), "utf8");

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
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id),
    title text not null,
    gallery text[] not null default '{}'
  );
  alter table public.outfits add constraint outfits_gallery_uploads check (
    array_to_string(gallery, E'\\n')
      ~ ('^(' || author_id::text || '/[0-9a-f-]{36}\\.(avif|webp)(\\n|$))*$')
  );
  create table public.outfit_reports (
    outfit_id uuid not null references public.outfits (id) on delete cascade,
    user_id uuid not null references public.profiles (id),
    reason text not null,
    primary key (outfit_id, user_id)
  );
`;

const PLAYER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const LOOK = "10000000-0000-0000-0000-000000000001";
const OWN = "10000000-0000-0000-0000-000000000002";
const PLAYER_DISCORD = "354266414397390858";
const OTHER_DISCORD = "708022303841058907";
const SHOT = "aaaaaaaa-0000-0000-0000-000000000001";

let db: PGlite;

const codeOf = (e: unknown) => (e as { code?: string }).code;

/** What the import writes: no account yet, the player's name, files in the look's own folder. */
async function imported(id: string, discordId: string, messageId: string, gallery = [`discord/${id}/${SHOT}.avif`]) {
  await db.query("insert into public.outfits (id, author_id, discord_name, title, gallery) values ($1, null, 'Shadow', 'Ice knight', $2)", [id, gallery]);
  await db.query("insert into public.discord_looks (outfit_id, discord_id, message_id) values ($1, $2, $3)", [id, discordId, messageId]);
}

/** What Supabase does on a first Discord sign-in: the user, their profile, then the identity. */
async function signsIn(user: string, provider: string, providerId: string) {
  await db.query("insert into public.profiles (id, display_name) values ($1, 'Someone') on conflict do nothing", [user]);
  await db.query("insert into auth.identities (user_id, provider, provider_id) values ($1, $2, $3)", [user, provider, providerId]);
}

const authorOf = async (id: string) =>
  (await db.query<{ author_id: string | null }>("select author_id from public.outfits where id = $1", [id])).rows[0].author_id;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
});

describe("a look from the Discord showcase", () => {
  it("is credited to its player by name, with no account behind it", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    const row = (await db.query<{ author_id: string | null; discord_name: string }>(
      "select author_id, discord_name from public.outfits where id = $1", [LOOK],
    )).rows[0];
    expect(row).toEqual({ author_id: null, discord_name: "Shadow" });
  });

  it("must be credited to someone: an account or a Discord name", async () => {
    await expect(db.query("insert into public.outfits (author_id, title) values (null, 'Nobody')")).rejects.toSatisfy(
      (e) => codeOf(e) === "23514",
    );
  });

  it("keeps its screenshots in its own discord folder, and nowhere else", async () => {
    await expect(imported(LOOK, PLAYER_DISCORD, "1400000000000000001", [`discord/${OWN}/${SHOT}.avif`])).rejects.toSatisfy(
      (e) => codeOf(e) === "23514",
    );
  });

  it("is imported once per Discord message", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    await expect(imported(OWN, PLAYER_DISCORD, "1400000000000000001")).rejects.toSatisfy((e) => codeOf(e) === "23505");
  });

  it("keeps who shared it out of the public API", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select discord_id from public.discord_looks")).rejects.toSatisfy((e) => codeOf(e) === "42501");
      await db.exec("reset role");
    }
  });
});

describe("a published look's screenshots", () => {
  it("still have to sit in the author's own folder, never an imported look's", async () => {
    await db.query("insert into public.profiles (id, display_name) values ($1, 'Player')", [PLAYER]);
    await db.query("insert into public.outfits (id, author_id, title, gallery) values ($1, $2, 'Mine', $3)", [OWN, PLAYER, [`${PLAYER}/${SHOT}.avif`]]);
    await expect(
      db.query("insert into public.outfits (author_id, title, gallery) values ($1, 'Borrowed', $2)", [PLAYER, [`discord/${LOOK}/${SHOT}.avif`]]),
    ).rejects.toSatisfy((e) => codeOf(e) === "23514");
  });
});

describe("signing in with Discord", () => {
  it("hands the player every look they shared, and keeps their screenshots valid", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    await imported(OWN, PLAYER_DISCORD, "1400000000000000002");
    await signsIn(PLAYER, "discord", PLAYER_DISCORD);
    expect(await authorOf(LOOK)).toBe(PLAYER);
    expect(await authorOf(OWN)).toBe(PLAYER);
  });

  it("leaves other players' looks alone", async () => {
    await imported(LOOK, OTHER_DISCORD, "1400000000000000001");
    await signsIn(PLAYER, "discord", PLAYER_DISCORD);
    expect(await authorOf(LOOK)).toBeNull();
  });

  it("only counts a Discord account, not another provider's id that happens to match", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    await signsIn(PLAYER, "google", PLAYER_DISCORD);
    expect(await authorOf(LOOK)).toBeNull();
  });

  it("never takes a look that already has an author", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    await db.query("insert into public.profiles (id, display_name) values ($1, 'Other')", [OTHER]);
    await db.query("update public.outfits set author_id = $1 where id = $2", [OTHER, LOOK]);
    await signsIn(PLAYER, "discord", PLAYER_DISCORD);
    expect(await authorOf(LOOK)).toBe(OTHER);
  });
});

describe("reporting", () => {
  const report = async (user: string, id: string) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${user}', false);`);
    try {
      return (await db.query<{ r: boolean }>("select public.report_outfit($1, 'spam') as r", [id])).rows[0].r;
    } finally {
      await db.exec("reset role;");
    }
  };

  beforeEach(async () => {
    await db.query("insert into public.profiles (id, display_name) values ($1, 'Player'), ($2, 'Other')", [PLAYER, OTHER]);
  });

  it("works on a look nobody has claimed yet", async () => {
    await imported(LOOK, PLAYER_DISCORD, "1400000000000000001");
    expect(await report(OTHER, LOOK)).toBe(true);
  });

  it("still refuses a report on your own look", async () => {
    await db.query("insert into public.outfits (id, author_id, title) values ($1, $2, 'Mine')", [OWN, PLAYER]);
    expect(await report(PLAYER, OWN)).toBe(false);
  });
});
