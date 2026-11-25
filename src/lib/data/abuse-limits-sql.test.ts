import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// The publish and comment limits count what a person made in the window, deleted or not, so
// publishing and deleting in a loop cannot post to the Discord feed without end. Proved on a
// real Postgres with the comments migration as it is live, Supabase's roles and auth.uid()
// stubbed, and the outfits table cut to the columns the limit reads.
const read = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const COMMENTS = read("20261113090000_look_comments.sql");
const MIGRATION = read("20261125100000_limits_count_what_was_made.sql");

const SUPABASE = `
  create role anon; create role authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema private;
  grant usage on schema private to anon, authenticated;
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references public.profiles (id) on delete cascade,
    title text not null default 'A look',
    created_at timestamptz not null default now()
  );
  alter table public.outfits enable row level security;
  create policy "outfits are public" on public.outfits for select using (true);
  create policy "publish as yourself" on public.outfits for insert to authenticated
    with check ((select auth.uid()) = author_id);
  create policy "delete own outfit" on public.outfits for delete to authenticated
    using ((select auth.uid()) = author_id);
  create table public.moderators (user_id uuid primary key references public.profiles (id));
  -- As live (20261101051349_names_and_limits): counts the looks still there.
  create function public.limit_publishing() returns trigger
  language plpgsql set search_path = '' as $$
  begin
    if (
      select count(*) from public.outfits
      where author_id = new.author_id and created_at > now() - interval '1 hour'
    ) >= 20 then
      raise exception 'too many looks this hour' using errcode = 'EC001';
    end if;
    return new;
  end;
  $$;
  create trigger limit_publishing before insert on public.outfits
    for each row execute function public.limit_publishing();
`;

const ME = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

let db: PGlite;

async function as<T>(user: string, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.sub', '${user}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

const publish = (user = ME) =>
  as(user, async () =>
    (await db.query<{ id: string }>("insert into public.outfits (author_id) values ($1) returning id", [user])).rows[0].id);
const unpublish = (id: string, user = ME) => as(user, () => db.query("delete from public.outfits where id = $1", [id]));
const say = (look: string, user = ME) =>
  as(user, async () =>
    (await db.query<{ id: string }>(
      "insert into public.outfit_comments (outfit_id, author_id, body) values ($1, $2, 'Nice') returning id",
      [look, user],
    )).rows[0].id);
const unsay = (id: string, user = ME) => as(user, () => db.query("delete from public.outfit_comments where id = $1", [id]));
/** Moves everything recorded so far back in time, as the hour passing would. */
const later = (by: string) => db.exec(`
  update private.recent_posts set made_at = made_at - interval '${by}';
  update public.outfits set created_at = created_at - interval '${by}';
  update public.outfit_comments set created_at = created_at - interval '${by}';
`);
const codeOf = (e: unknown) => (e as { code?: string }).code;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(COMMENTS);
  await db.exec(`insert into public.profiles (id, display_name) values ('${ME}', 'Me'), ('${OTHER}', 'Other');`);
});

describe("the publishing limit", () => {
  beforeEach(() => db.exec(MIGRATION));

  it("still lets an honest player publish twenty looks an hour", async () => {
    for (let i = 0; i < 20; i++) await publish();
    await expect(publish()).rejects.toSatisfy((e) => codeOf(e) === "EC001");
  });

  it("counts a look its author deleted, so publish and delete cannot loop", async () => {
    for (let i = 0; i < 20; i++) await unpublish(await publish());
    expect((await db.query("select 1 from public.outfits")).rows).toHaveLength(0);
    await expect(publish()).rejects.toSatisfy((e) => codeOf(e) === "EC001");
  });

  it("opens again once the hour has passed, and forgets what is older", async () => {
    for (let i = 0; i < 20; i++) await unpublish(await publish());
    await later("61 minutes");
    await expect(publish()).resolves.toBeTruthy();
    expect((await db.query("select 1 from private.recent_posts")).rows).toHaveLength(1);
  });

  it("is one person's alone", async () => {
    for (let i = 0; i < 20; i++) await publish();
    await expect(publish(OTHER)).resolves.toBeTruthy();
  });

  it("leaves out a look from the Discord showcase, which has no author yet", async () => {
    for (let i = 0; i < 25; i++) await db.query("insert into public.outfits (author_id) values (null)");
    expect((await db.query("select 1 from private.recent_posts")).rows).toHaveLength(0);
  });

  it("counts nothing for a look that was refused", async () => {
    await expect(as(ME, () => db.query("insert into public.outfits (author_id) values ($1)", [OTHER]))).rejects.toThrow();
    expect((await db.query("select 1 from private.recent_posts")).rows).toHaveLength(0);
  });

  it("is out of everyone's reach", async () => {
    await publish();
    await expect(as(ME, () => db.query("select * from private.recent_posts"))).rejects.toSatisfy((e) => codeOf(e) === "42501");
    await expect(as(ME, () => db.query("delete from private.recent_posts"))).rejects.toSatisfy((e) => codeOf(e) === "42501");
  });
});

describe("the commenting limit", () => {
  let look: string;
  beforeEach(async () => {
    look = await publish(OTHER);
    await db.exec(MIGRATION);
  });

  it("still lets ten comments through in ten minutes", async () => {
    for (let i = 0; i < 10; i++) await say(look);
    await expect(say(look)).rejects.toSatisfy((e) => codeOf(e) === "EC002");
  });

  it("counts comments their writer removed", async () => {
    for (let i = 0; i < 10; i++) await unsay(await say(look));
    await expect(say(look)).rejects.toSatisfy((e) => codeOf(e) === "EC002");
    await later("11 minutes");
    await expect(say(look)).resolves.toBeTruthy();
  });
});

describe("the switch to counting what was made", () => {
  it("counts what was published in the last hour before it, so nobody starts afresh", async () => {
    for (let i = 0; i < 20; i++) await publish();
    await db.exec(MIGRATION);
    await expect(publish()).rejects.toSatisfy((e) => codeOf(e) === "EC001");
  });

  it("counts the last ten minutes' comments too", async () => {
    const look = await publish(OTHER);
    for (let i = 0; i < 10; i++) await say(look);
    await db.exec(MIGRATION);
    await expect(say(look)).rejects.toSatisfy((e) => codeOf(e) === "EC002");
  });
});
