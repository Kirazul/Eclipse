import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// One public look per code: the same look published on the site and added from Discord,
// or reposted by someone else, is refused, and the refusal names the look already there.
// Proved on a real Postgres with auth.identities stubbed and the outfits table cut to the
// columns these rules read.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261115090000_one_public_look_per_code.sql"), "utf8");

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid,
    discord_name text,
    title text not null default 'A look',
    code text not null,
    race text,
    tags text[] not null default '{}',
    description text,
    gallery text[] not null default '{}',
    is_private boolean not null default false,
    created_at timestamptz not null default now()
  );
  create table public.discord_looks (
    outfit_id uuid primary key references public.outfits (id) on delete cascade,
    discord_id text not null,
    message_id text not null unique
  );
  create function public.import_discord_look(
    look uuid, player text, message text, player_name text, look_title text, look_code text,
    look_race text, look_tags text[], caption text, shots text[], shared_at timestamptz
  ) returns uuid language sql as $$ select look $$;
`;

const AUTHOR = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const look = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

const migrate = () => db.exec(MIGRATION);
const publish = (n: number, code: string, author = AUTHOR, isPrivate = false) =>
  db.query("insert into public.outfits (id, author_id, code, is_private) values ($1, $2, $3, $4)", [look(n), author, code, isPrivate]);
const setPrivate = (n: number, isPrivate: boolean) =>
  db.query("update public.outfits set is_private = $2 where id = $1", [look(n), isPrivate]);

/** The SQLSTATE and detail a refused statement raised, or null when it went through. */
async function refusal(run: () => Promise<unknown>): Promise<{ code: string; detail: string } | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const err = e as { code?: string; detail?: string };
    return { code: err.code ?? "", detail: err.detail ?? "" };
  }
}

const importFromDiscord = async (n: number, message: string, code: string) =>
  (await db.query<{ id: string }>(
    `select public.import_discord_look($1, 'player-1', $2, 'Player', 'A look', $3, null, '{}', null, '{}', now()) as id`,
    [look(n), message, code],
  )).rows[0].id;

const count = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.outfits")).rows[0].n;

describe("one public look per code", () => {
  beforeEach(migrate);

  it("refuses a second public look with the same code and names the first", async () => {
    await publish(1, "CODE-A");
    expect(await refusal(() => publish(2, "CODE-A", OTHER))).toEqual({ code: "EC003", detail: look(1) });
    expect(await count()).toBe(1);
  });

  it("lets different codes through", async () => {
    await publish(1, "CODE-A");
    expect(await refusal(() => publish(2, "CODE-B"))).toBeNull();
  });

  it("lets a private copy be kept, but not made public while the first is", async () => {
    await publish(1, "CODE-A");
    expect(await refusal(() => publish(2, "CODE-A", AUTHOR, true))).toBeNull();
    expect(await refusal(() => setPrivate(2, false))).toEqual({ code: "EC003", detail: look(1) });
  });

  it("frees the code when the public look goes private", async () => {
    await publish(1, "CODE-A");
    await setPrivate(1, true);
    expect(await refusal(() => publish(2, "CODE-A", OTHER))).toBeNull();
    // The first look cannot come back while the second holds the code.
    expect(await refusal(() => setPrivate(1, false))).toEqual({ code: "EC003", detail: look(2) });
  });

  it("does not stop a public look changing its other columns", async () => {
    await publish(1, "CODE-A");
    expect(await refusal(() => db.query("update public.outfits set title = 'New' where id = $1", [look(1)]))).toBeNull();
  });
});

describe("looks published before the rule", () => {
  it("are left as they are and can still be edited", async () => {
    await publish(1, "CODE-A");
    await publish(2, "CODE-A", OTHER);
    await migrate();
    expect(await refusal(() => db.query("update public.outfits set title = 'New' where id = $1", [look(2)]))).toBeNull();
    expect(await count()).toBe(2);
  });
});

describe("a look added from Discord", () => {
  beforeEach(migrate);

  it("gets the public look already there back, and adds nothing", async () => {
    await publish(1, "CODE-A");
    expect(await importFromDiscord(2, "m-1", "CODE-A")).toBe(look(1));
    expect(await count()).toBe(1);
    expect((await db.query("select * from public.discord_looks")).rows).toEqual([]);
  });

  it("is added when the only look with its code is private", async () => {
    await publish(1, "CODE-A", AUTHOR, true);
    expect(await importFromDiscord(2, "m-1", "CODE-A")).toBe(look(2));
    expect(await count()).toBe(2);
  });

  it("is added once when its message is added twice", async () => {
    expect(await importFromDiscord(2, "m-1", "CODE-B")).toBe(look(2));
    expect(await importFromDiscord(3, "m-1", "CODE-B")).toBe(look(2));
    expect(await count()).toBe(1);
  });

  it("from a second post of the same code gets the first post's look back", async () => {
    await importFromDiscord(2, "m-1", "CODE-C");
    expect(await importFromDiscord(3, "m-2", "CODE-C")).toBe(look(2));
  });
});
