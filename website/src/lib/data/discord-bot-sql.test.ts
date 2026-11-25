import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// The Discord bot's database side: the right-click import, the role holder and who
// counts as a creator. Proved on a real Postgres, with Supabase's roles, auth.identities
// and the outfit columns the migrations read stubbed. service_role skips row security,
// as on Supabase.
const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const SHOWCASE = read("20261113180000_discord_showcase_looks.sql");
const BRIDGE = read("20261114090000_discord_bot_bridge.sql");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create schema private;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null references public.profiles (id),
    title text not null,
    code text not null default 'ECA1:',
    race text,
    tags text[] not null default '{}',
    description text,
    created_at timestamptz not null default now(),
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
const LOOK = "10000000-0000-0000-0000-000000000001";
const SECOND = "10000000-0000-0000-0000-000000000002";
const PLAYER_DISCORD = "354266414397390858";
const STRANGER_DISCORD = "708022303841058907";
const MESSAGE = "1400000000000000001";
const SHOT = "aaaaaaaa-0000-0000-0000-000000000001";

let db: PGlite;

const codeOf = (e: unknown) => (e as { code?: string }).code;

async function signsIn(user: string, discordId: string) {
  await db.query("insert into public.profiles (id, display_name) values ($1, 'Someone') on conflict do nothing", [user]);
  await db.query("insert into auth.identities (user_id, provider, provider_id) values ($1, 'discord', $2)", [user, discordId]);
}

/** The right-click import, as the site's server calls it. */
async function importLook(id: string, discordId: string, message: string) {
  const { rows } = await db.query<{ id: string }>(
    `select public.import_discord_look($1, $2, $3, 'Shadow', 'Ice knight', 'ECA1:abc', null, '{mount}', 'From the fens',
       array[$4], '2026-11-10T00:00:00Z') as id`,
    [id, discordId, message, `discord/${id}/${SHOT}.avif`],
  );
  return rows[0].id;
}

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(SHOWCASE);
  await db.exec(BRIDGE);
  await db.exec("set role service_role");
});

describe("adding a showcase post at a right-click", () => {
  it("credits the player by name, with the post's code, caption and pictures", async () => {
    expect(await importLook(LOOK, PLAYER_DISCORD, MESSAGE)).toBe(LOOK);
    const row = await one<Record<string, unknown>>(
      "select author_id, discord_name, title, code, tags, description, gallery from public.outfits where id = $1", [LOOK],
    );
    expect(row).toEqual({
      author_id: null,
      discord_name: "Shadow",
      title: "Ice knight",
      code: "ECA1:abc",
      tags: ["mount"],
      description: "From the fens",
      gallery: [`discord/${LOOK}/${SHOT}.avif`],
    });
    expect(await one("select discord_id, message_id from public.discord_looks where outfit_id = $1", [LOOK]))
      .toEqual({ discord_id: PLAYER_DISCORD, message_id: MESSAGE });
  });

  it("gives the look to a player who already has an account", async () => {
    await db.exec("reset role");
    await signsIn(PLAYER, PLAYER_DISCORD);
    await db.exec("set role service_role");
    await importLook(LOOK, PLAYER_DISCORD, MESSAGE);
    expect(await one("select author_id from public.outfits where id = $1", [LOOK])).toEqual({ author_id: PLAYER });
  });

  it("adds a message once, and hands the first look back to a second click", async () => {
    await importLook(LOOK, PLAYER_DISCORD, MESSAGE);
    expect(await importLook(SECOND, PLAYER_DISCORD, MESSAGE)).toBe(LOOK);
    expect(await one("select count(*)::int as n from public.outfits")).toEqual({ n: 1 });
  });

  it("is closed to visitors, signed in or not", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      const tried = importLook(LOOK, PLAYER_DISCORD, MESSAGE).catch((e: unknown) => codeOf(e));
      expect(await tried).toBe("42501");
      expect(await db.query("select public.discord_creators()").catch((e: unknown) => codeOf(e))).toBe("42501");
      expect(await db.query("select public.swap_discord_role_holder('look_of_the_week', null)").catch((e: unknown) => codeOf(e))).toBe("42501");
    }
  });
});

describe("who counts as a creator", () => {
  it("is everyone whose Discord account has a look, claimed or not", async () => {
    await importLook(LOOK, STRANGER_DISCORD, MESSAGE);
    await db.exec("reset role");
    await signsIn(PLAYER, PLAYER_DISCORD);
    await db.query("insert into public.outfits (id, author_id, title) values ($1, $2, 'Own look')", [SECOND, PLAYER]);
    await db.exec("set role service_role");

    const creators = (await db.query<{ id: string }>("select public.discord_creators() as id")).rows.map((r) => r.id);
    expect(creators.sort()).toEqual([PLAYER_DISCORD, STRANGER_DISCORD].sort());
    expect(await one("select public.discord_id_of_look($1) as id", [SECOND])).toEqual({ id: PLAYER_DISCORD });
    expect(await one("select public.discord_id_of_look($1) as id", [LOOK])).toEqual({ id: STRANGER_DISCORD });
  });

  it("stops counting a player once their last look is gone", async () => {
    await importLook(LOOK, PLAYER_DISCORD, MESSAGE);
    expect(await one("select public.discord_has_looks($1) as has", [PLAYER_DISCORD])).toEqual({ has: true });
    await db.exec("reset role");
    await db.query("delete from public.outfits where id = $1", [LOOK]);
    await db.exec("set role service_role");
    expect(await one("select public.discord_has_looks($1) as has", [PLAYER_DISCORD])).toEqual({ has: false });
  });
});

describe("the Look of the Week role's holder", () => {
  const swap = async (holder: string | null) =>
    (await one<{ previous: string | null }>("select public.swap_discord_role_holder('look_of_the_week', $1) as previous", [holder])).previous;

  it("passes from one winner to the next, saying who held it", async () => {
    expect(await swap(PLAYER_DISCORD)).toBeNull();
    expect(await swap(STRANGER_DISCORD)).toBe(PLAYER_DISCORD);
    expect(await swap(null)).toBe(STRANGER_DISCORD);
    expect(await swap(null)).toBeNull();
  });
});
