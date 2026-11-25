import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Who may say, remove and report what lives in RLS and plpgsql, so it is proved on a
// real Postgres. Only Supabase's roles, grants and auth.uid() are stubbed, with the
// columns of profiles, outfits and moderators the migration reads.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261113090000_look_comments.sql"), "utf8");

const SUPABASE = `
  create role anon; create role authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create table public.profiles (id uuid primary key, display_name text);
  create table public.outfits (id uuid primary key, author_id uuid not null references public.profiles (id), title text not null);
  create table public.moderators (user_id uuid primary key references public.profiles (id));
`;

const AUTHOR = "00000000-0000-0000-0000-000000000001";
const ME = "00000000-0000-0000-0000-000000000002";
const STRANGER = "00000000-0000-0000-0000-000000000003";
const MOD = "00000000-0000-0000-0000-000000000004";
const NAMELESS = "00000000-0000-0000-0000-000000000005";
const LOOK = "10000000-0000-0000-0000-000000000001";

type Role = "anon" | "authenticated";
let db: PGlite;

async function as<T>(role: Role, user: string | null, run: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${user ?? ""}', false);`);
  try {
    return await run();
  } finally {
    await db.exec("reset role;");
  }
}

const say = (user: string | null, body: string, author = user) =>
  as(user ? "authenticated" : "anon", user, async () =>
    (await db.query<{ id: string }>(
      "insert into public.outfit_comments (outfit_id, author_id, body) values ($1, $2, $3) returning id",
      [LOOK, author, body],
    )).rows[0].id);

const remove = (user: string, id: string) =>
  as("authenticated", user, async () =>
    (await db.query("delete from public.outfit_comments where id = $1 returning id", [id])).rows.length);

const report = (user: string | null, id: string, why = "spam") =>
  as(user ? "authenticated" : "anon", user, async () =>
    (await db.query<{ r: boolean }>("select public.report_comment($1, $2) as r", [id, why])).rows[0].r);

const queue = (user: string) =>
  as("authenticated", user, async () =>
    (await db.query<{ comment_id: string; reports: number; reasons: string[]; title: string; author: string }>(
      "select * from public.comment_moderation_queue()",
    )).rows);

const codeOf = (e: unknown) => (e as { code?: string }).code;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.profiles (id, display_name) values
      ('${AUTHOR}', 'Author'), ('${ME}', 'Me'), ('${STRANGER}', 'Stranger'), ('${MOD}', 'Mod'), ('${NAMELESS}', null);
    insert into public.outfits (id, author_id, title) values ('${LOOK}', '${AUTHOR}', 'Crystal Scholar');
    insert into public.moderators (user_id) values ('${MOD}');
  `);
});

describe("writing a comment", () => {
  it("is open to anyone signed in with a public name, and anyone reads it", async () => {
    const id = await say(ME, "Love the cape.");
    const rows = await as("anon", null, async () =>
      (await db.query<{ id: string; body: string }>("select id, body from public.outfit_comments")).rows);
    expect(rows).toEqual([{ id, body: "Love the cape." }]);
  });

  it("refuses a visitor, someone with no name yet, and a comment in someone else's name", async () => {
    await expect(say(null, "hi", ME)).rejects.toSatisfy((e) => codeOf(e) === "42501");
    await expect(say(NAMELESS, "hi")).rejects.toSatisfy((e) => codeOf(e) === "42501");
    await expect(say(ME, "hi", STRANGER)).rejects.toSatisfy((e) => codeOf(e) === "42501");
  });

  it("keeps line breaks but not empty, padded, overlong or control-character text", async () => {
    await expect(say(ME, "Two\nlines")).resolves.toBeTruthy();
    for (const body of ["", " padded", "padded\n", "x".repeat(501), "bell\u0007", "tab\there"]) {
      await expect(say(ME, body), JSON.stringify(body)).rejects.toSatisfy((e) => codeOf(e) === "23514");
    }
    await expect(say(ME, "x".repeat(500))).resolves.toBeTruthy();
  });

  it("never lets a writer pick the id, the date or the moderators' column", async () => {
    for (const [column, value] of [["id", "gen_random_uuid()"], ["created_at", "now()"], ["reports_cleared_at", "now()"]]) {
      await expect(as("authenticated", ME, () => db.query(
        `insert into public.outfit_comments (outfit_id, author_id, body, ${column}) values ($1, $2, 'hi', ${value})`,
        [LOOK, ME],
      ))).rejects.toSatisfy((e) => codeOf(e) === "42501");
    }
    await expect(as("anon", null, () => db.query("select reports_cleared_at from public.outfit_comments")))
      .rejects.toSatisfy((e) => codeOf(e) === "42501");
  });

  it("has no edit: a comment says what it said when it was posted", async () => {
    const id = await say(ME, "First take");
    await expect(as("authenticated", ME, () => db.query("update public.outfit_comments set body = 'changed' where id = $1", [id])))
      .rejects.toSatisfy((e) => codeOf(e) === "42501");
  });

  it("stops at ten comments in ten minutes", async () => {
    for (let i = 0; i < 10; i++) await say(ME, `comment ${i}`);
    await expect(say(ME, "one more")).rejects.toSatisfy((e) => codeOf(e) === "EC002");
    // Someone else still can.
    await expect(say(STRANGER, "me too")).resolves.toBeTruthy();
  });
});

describe("removing a comment", () => {
  it("is for its writer, the look's author and moderators, and nobody else", async () => {
    const a = await say(ME, "a");
    const b = await say(ME, "b");
    const c = await say(ME, "c");
    expect(await remove(STRANGER, a)).toBe(0);
    expect(await remove(ME, a)).toBe(1);
    expect(await remove(AUTHOR, b)).toBe(1);
    expect(await remove(MOD, c)).toBe(1);
  });

  it("goes with the look", async () => {
    await say(ME, "a");
    await db.exec(`delete from public.outfits where id = '${LOOK}'`);
    expect((await db.query("select 1 from public.outfit_comments")).rows).toEqual([]);
  });
});

describe("reporting a comment", () => {
  it("counts each person once, never their own comment, and needs a sign-in", async () => {
    const id = await say(ME, "buy gold at example");
    expect(await report(ME, id)).toBe(false);
    expect(await report(STRANGER, id)).toBe(true);
    expect(await report(STRANGER, id, "offensive")).toBe(false);
    await expect(report(null, id)).rejects.toSatisfy((e) => codeOf(e) === "42501");
  });

  it("refuses a reason the site does not offer", async () => {
    const id = await say(ME, "hi");
    await expect(report(STRANGER, id, "boring")).rejects.toSatisfy((e) => codeOf(e) === "23514");
  });

  it("keeps who reported what out of everyone's reach but the functions", async () => {
    const id = await say(ME, "hi");
    await report(STRANGER, id);
    for (const user of [STRANGER, MOD]) {
      await expect(as("authenticated", user, () => db.query("select * from public.outfit_comment_reports")))
        .rejects.toSatisfy((e) => codeOf(e) === "42501");
    }
  });

  it("queues for moderators only, until a moderator dismisses the reports", async () => {
    const id = await say(ME, "hi");
    await report(STRANGER, id, "spam");
    await report(AUTHOR, id, "offensive");
    await expect(queue(STRANGER)).rejects.toSatisfy((e) => codeOf(e) === "42501");
    const [row] = await queue(MOD);
    expect(row).toMatchObject({ comment_id: id, title: "Crystal Scholar", author: "Me", reasons: ["offensive", "spam"] });
    expect(Number(row.reports)).toBe(2);

    await expect(as("authenticated", STRANGER, () => db.query("select public.dismiss_comment_reports($1)", [id])))
      .rejects.toSatisfy((e) => codeOf(e) === "42501");
    await as("authenticated", MOD, () => db.query("select public.dismiss_comment_reports($1)", [id]));
    expect(await queue(MOD)).toEqual([]);
  });
});
