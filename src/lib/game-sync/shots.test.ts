import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Pictures a game sends with a saved set. Proved on a real Postgres with Supabase's
// parts stubbed: its roles, auth.uid(), storage.objects and the outfits a set's
// pictures move to when it is published.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const SYNC = migration("20261101090000_game_sync.sql");
const SHOTS = migration("20261108090000_game_set_shots.sql");
const SHOT_OWNER = migration("20261108120000_game_shot_begin_owner.sql");
const BUDGET = migration("20261122150000_game_picture_budget.sql");
const CAP = migration("20261101054813_screenshot_cap.sql");
const SMALL = migration("20261125110000_small_thumbnails.sql");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema private;
  create table public.profiles (id uuid primary key);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null,
    gallery text[] not null default '{}'
  );
  create schema storage;
  grant usage on schema storage to anon, authenticated;
  -- The real table's columns, not just the two these functions read: a plpgsql
  -- variable named like one of them (owner) is ambiguous in production.
  create table storage.objects (
    id uuid not null default gen_random_uuid(),
    bucket_id text not null,
    name text not null,
    owner uuid,
    owner_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    last_accessed_at timestamptz default now(),
    metadata jsonb,
    version text,
    user_metadata jsonb,
    primary key (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  -- The bucket's first upload policy, which the screenshot_cap migration replaces.
  create policy "upload screenshots to your own folder" on storage.objects for insert
    to authenticated with check (false);
`;

const ME = "00000000-0000-0000-0000-000000000001";
const STRANGER = "00000000-0000-0000-0000-000000000002";
const TOKEN = "a".repeat(64);
const STRANGER_TOKEN = "b".repeat(64);
const PATH = new RegExp(`^${ME}/[0-9a-f-]{36}\\.avif$`);

type Role = "anon" | "authenticated";
type Begin = { status: string; path?: string };
type Attach = { status: string; count?: number };

let db: PGlite;

async function as<T>(role: Role, user: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

async function call<T>(role: Role, user: string | null, sql: string, params: unknown[] = []) {
  return as(role, user, async () => (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0].r);
}

async function link(user: string, token: string) {
  const code = token.replace(/./g, "d");
  await call("authenticated", user, "public.game_link_new($1)", [code]);
  await call("anon", null, "public.game_link_claim($1, $2, $3)", [code, token, "PC"]);
}

// Each change is based on the set's current revision, as a game that is up to date sends it.
async function sync(token: string, changes: { name: string; code: string | null; icon?: string }[]) {
  await db.exec("update public.game_links set last_sync_at = null");
  const { rows } = await db.query<{ name: string; rev: string }>("select name, rev from public.game_sets");
  const base = (name: string) => Number(rows.find((r) => r.name === name)?.rev ?? 0);
  await call("anon", null, "public.game_sync($1, 0, '', $2::jsonb)", [
    token,
    JSON.stringify(changes.map((c) => ({ icon: "", base: base(c.name), ...c }))),
  ]);
}

// Each picture is its own request, so each test's look spaced out, as sync's are.
async function begin(name: string, token = TOKEN) {
  await db.exec("update public.game_links set last_shot_at = null");
  return call<Begin>("anon", null, "public.game_shot_begin($1, $2, 'avif')", [token, name]);
}

const attach = (path: string, token = TOKEN) =>
  call<Attach>("anon", null, "public.game_shot_attach($1, $2)", [token, path]);

const thumb = (path: string) => path.replace(/\.avif$/, "-thumb.avif");
const small = (path: string) => path.replace(/\.avif$/, "-small.avif");

const store = (role: Role, user: string | null, name: string) =>
  as(role, user, () => db.query("insert into storage.objects (bucket_id, name) values ('showcase', $1)", [name]));

/** Files the site's own forms stored for the account. */
const fill = (n: number) => db.exec(`
  insert into storage.objects (bucket_id, name)
  select 'showcase', '${ME}/' || gen_random_uuid() || '.avif' from generate_series(1, ${n})`);

/** A picture all the way onto the set, as the route sends it. */
async function shoot(name = "Charnel") {
  const { path } = await begin(name);
  await store("anon", null, thumb(path!));
  await store("anon", null, small(path!));
  await store("anon", null, path!);
  expect((await attach(path!)).status).toBe("ok");
  return path!;
}

async function gallery(name = "Charnel", user = ME) {
  const { rows } = await db.query<{ gallery: string[] }>(
    "select gallery from public.game_sets where user_id = $1 and name = $2",
    [user, name],
  );
  return rows[0]?.gallery;
}

const orphans = (user = ME) => call<string[]>("authenticated", user, "public.game_shot_orphans()");

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(CAP);
  await db.exec(SYNC);
  await db.exec(SHOTS);
  await db.exec(SHOT_OWNER);
  await db.exec(BUDGET);
  await db.exec(SMALL);
  await db.exec(`insert into public.profiles (id) values ('${ME}'), ('${STRANGER}');`);
  await link(ME, TOKEN);
  await link(STRANGER, STRANGER_TOKEN);
  await sync(TOKEN, [{ name: "Charnel", code: "ECA1:AA" }]);
});

describe("sending a picture from the game", () => {
  it("files the picture on the saved set it was taken of", async () => {
    const path = await shoot();
    expect(path).toMatch(PATH);
    expect(await gallery()).toEqual([path]);
  });

  it("finds the set whatever the case of its name", async () => {
    expect((await begin("CHARNEL")).status).toBe("ok");
  });

  it("answers an unlinked game, a set the site does not have, and a removed set", async () => {
    expect((await begin("Charnel", "c".repeat(64))).status).toBe("unlinked");
    expect((await begin("Nope")).status).toBe("missing");
    await sync(TOKEN, [{ name: "Charnel", code: null }]);
    expect((await begin("Charnel")).status).toBe("missing");
  });

  it("never reaches another player's set", async () => {
    await sync(STRANGER_TOKEN, [{ name: "Theirs", code: "ECA1:BB" }]);
    expect((await begin("Theirs")).status).toBe("missing");
    const { path } = await begin("Charnel");
    expect((await attach(path!, STRANGER_TOKEN)).status).toBe("missing");
    expect(await gallery()).toEqual([]);
  });

  it("holds a game to one picture every few seconds", async () => {
    expect((await begin("Charnel")).status).toBe("ok");
    expect((await call<Begin>("anon", null, "public.game_shot_begin($1, 'Charnel', 'avif')", [TOKEN])).status).toBe(
      "busy",
    );
  });

  it("stops at six pictures a set, counting ones still on the way", async () => {
    for (let i = 0; i < 5; i++) await shoot();
    expect((await begin("Charnel")).status).toBe("ok");
    expect((await begin("Charnel")).status).toBe("set-full");
  });

  it("stops at sixty pictures waiting on sets, counting ones still on the way", async () => {
    await sync(TOKEN, Array.from({ length: 9 }, (_, i) => ({ name: `Set ${i}`, code: "ECA1:AA" })));
    await db.exec(`update public.game_sets set gallery = array(
      select '${ME}/' || gen_random_uuid() || '.avif' from generate_series(1, 6)) where name <> 'Charnel'`);
    for (let i = 0; i < 5; i++) await shoot();
    expect((await begin("Charnel")).status).toBe("ok");
    await sync(TOKEN, [{ name: "One more", code: "ECA1:BB" }]);
    expect((await begin("One more")).status).toBe("account-full");
  });

  it("goes on when the site's own uploads are at their limit", async () => {
    await fill(180);
    expect((await begin("Charnel")).status).toBe("ok");
  });

  // A picture is three files, so 450 is the old 300 at two files a picture.
  it("stops when everything the account stores, swept or not, is too much", async () => {
    await fill(447);
    expect((await begin("Charnel")).status).toBe("ok");
    expect((await begin("Charnel")).status).toBe("account-full");
  });

  it("refuses an extension the bucket does not hold", async () => {
    await expect(call("anon", null, "public.game_shot_begin($1, 'Charnel', 'exe')", [TOKEN])).rejects.toThrow();
  });
});

describe("the upload ticket", () => {
  it("lets a visitor's key store exactly the ticketed picture and its smaller copies", async () => {
    const { path } = await begin("Charnel");
    await store("anon", null, thumb(path!));
    await store("anon", null, small(path!));
    await store("anon", null, path!);
    await expect(store("anon", null, `${ME}/00000000-0000-0000-0000-00000000dead.avif`)).rejects.toThrow(/policy/);
  });

  it("ends with the attach", async () => {
    const path = await shoot();
    await db.exec("delete from storage.objects");
    await expect(store("anon", null, path)).rejects.toThrow(/policy/);
    expect((await attach(path)).status).toBe("missing");
  });

  it("runs out, and what it may have stored is cleared away", async () => {
    const { path } = await begin("Charnel");
    await db.exec("update private.game_shot_tickets set expires_at = now() - interval '1 second'");
    await expect(store("anon", null, path!)).rejects.toThrow(/policy/);
    await begin("Charnel");
    expect(await orphans()).toEqual([path]);
  });
});

describe("pictures that no longer show the set", () => {
  it("go when the set's look changes", async () => {
    const path = await shoot();
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:CC" }]);
    expect(await gallery()).toEqual([]);
    expect(await orphans()).toEqual([path]);
  });

  it("stay when only the icon changes", async () => {
    const path = await shoot();
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:AA", icon: "inv_helm" }]);
    const { rows } = await db.query<{ icon: string }>("select icon from public.game_sets");
    expect(rows[0].icon).toBe("inv_helm");
    expect(await gallery()).toEqual([path]);
  });

  it("go when the set is removed, from the game or the site", async () => {
    const path = await shoot();
    const { rows } = await db.query<{ id: string }>("select id from public.game_sets");
    await call("authenticated", ME, "public.game_set_remove($1)", [rows[0].id]);
    expect(await orphans()).toEqual([path]);
  });

  it("go when the owner removes one on the site, and nobody else can", async () => {
    const [first, second] = [await shoot(), await shoot()];
    const { rows } = await db.query<{ id: string }>("select id from public.game_sets");
    await call("authenticated", STRANGER, "public.game_set_drop_shot($1, $2)", [rows[0].id, first]);
    expect(await gallery()).toEqual([first, second]);
    await call("authenticated", ME, "public.game_set_drop_shot($1, $2)", [rows[0].id, first]);
    expect(await gallery()).toEqual([second]);
    expect(await orphans()).toEqual([first]);
  });

  it("are listed only to their owner, who forgets them once the files are gone", async () => {
    const path = await shoot();
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:CC" }]);
    expect(await orphans(STRANGER)).toEqual([]);
    await expect(call("anon", null, "public.game_shot_orphans()")).rejects.toThrow();
    await call("authenticated", STRANGER, "public.game_shot_forget($1)", [[path]]);
    expect(await orphans()).toEqual([path]);
    await call("authenticated", ME, "public.game_shot_forget($1)", [[path]]);
    expect(await orphans()).toEqual([]);
  });
});

describe("publishing a set", () => {
  it("moves its pictures onto the look, so a later change cannot take them", async () => {
    const [first, second] = [await shoot(), await shoot()];
    await db.query("insert into public.outfits (author_id, gallery) values ($1, $2)", [ME, [first]]);
    expect(await gallery()).toEqual([second]);
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:CC" }]);
    expect(await orphans()).toEqual([second]);
  });

  it("never offers a file a look shows for removal", async () => {
    const path = await shoot();
    await db.query("insert into private.game_shot_orphans (path, user_id) values ($1, $2)", [path, ME]);
    await db.query("insert into public.outfits (author_id, gallery) values ($1, $2)", [ME, [path]]);
    expect(await orphans()).toEqual([]);
  });
});

describe("the site's own upload limit", () => {
  /** What the bucket's upload policy counts for the signed-in account. */
  async function stored(user = ME) {
    await db.query("select set_config('request.jwt.sub', $1, false)", [user]);
    return Number((await db.query<{ n: string }>("select private.screenshots_stored() as n")).rows[0].n);
  }

  it("leaves out a game's pictures, on a set or replaced, so they never stop a look being published", async () => {
    await shoot();
    await shoot();
    expect(await stored()).toBe(0);
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:CC" }]);
    expect(await stored()).toBe(0);
    await fill(1);
    expect(await stored()).toBe(1);
  });

  it("counts a picture once its look is published, as its three files", async () => {
    const path = await shoot();
    await db.query("insert into public.outfits (author_id, gallery) values ($1, $2)", [ME, [path]]);
    expect(await stored()).toBe(3);
  });

  it("still stops at sixty pictures, now that each is three files", async () => {
    const upload = (user = ME) =>
      as("authenticated", user, () =>
        db.query("insert into storage.objects (bucket_id, name) values ('showcase', $1 || '/' || gen_random_uuid() || '.avif')", [user]),
      );
    await fill(179);
    await upload();
    await expect(upload()).rejects.toThrow(/policy/);
    await expect(upload(STRANGER)).resolves.toBeDefined();
    await expect(as("authenticated", ME, () => db.query("insert into storage.objects (bucket_id, name) values ('showcase', $1)", [`${STRANGER}/x.avif`]))).rejects.toThrow(/policy/);
  });

  it("leaves out a game's pictures there too, so a full set never stops an upload", async () => {
    for (let i = 0; i < 6; i++) await shoot();
    await fill(179);
    await expect(
      as("authenticated", ME, () => db.query("insert into storage.objects (bucket_id, name) values ('showcase', $1)", [`${ME}/last.avif`])),
    ).resolves.toBeDefined();
  });

  it("counts only the account's own folder", async () => {
    await fill(3);
    expect(await stored(STRANGER)).toBe(0);
  });
});

describe("the daily sweep", () => {
  const sweep = async () => (await db.query<{ r: string[] }>("select public.game_shot_sweep() as r")).rows[0].r;

  it("lists every player's replaced pictures, and forgets the ones removed", async () => {
    await sync(STRANGER_TOKEN, [{ name: "Theirs", code: "ECA1:BB" }]);
    const mine = await shoot();
    const { path: theirs } = await begin("Theirs", STRANGER_TOKEN);
    await attach(theirs!, STRANGER_TOKEN);
    await sync(TOKEN, [{ name: "Charnel", code: "ECA1:CC" }]);
    await sync(STRANGER_TOKEN, [{ name: "Theirs", code: null }]);
    expect((await sweep()).sort()).toEqual([mine, theirs].sort());
    await db.query("select public.game_shot_swept($1)", [[mine]]);
    expect(await sweep()).toEqual([theirs]);
  });

  it("takes a picture that never arrived, once its ticket has run out", async () => {
    const { path } = await begin("Charnel");
    expect(await sweep()).toEqual([]);
    await db.exec("update private.game_shot_tickets set expires_at = now() - interval '1 second'");
    expect(await sweep()).toEqual([path]);
  });

  it("never takes a picture a set or a look still shows", async () => {
    const [kept, published] = [await shoot(), await shoot()];
    await db.query("insert into public.outfits (author_id, gallery) values ($1, $2)", [ME, [published]]);
    for (const path of [kept, published]) {
      await db.query("insert into private.game_shot_orphans (path, user_id) values ($1, $2)", [path, ME]);
    }
    expect(await sweep()).toEqual([]);
  });

  it("is the server's alone", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(call(role, ME, "public.game_shot_sweep()")).rejects.toThrow(/permission denied/);
      await expect(call(role, ME, "public.game_shot_swept('{}')")).rejects.toThrow(/permission denied/);
    }
  });
});
