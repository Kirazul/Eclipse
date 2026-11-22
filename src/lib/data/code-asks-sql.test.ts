import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Asking a player for a look's code, through the bot: once a week per post and a few an
// hour per person, so a request reaches the player once and nobody can flood them. Proved
// on a real Postgres with Supabase's roles stubbed.
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const ASKS = migration("20261122160000_code_asks.sql");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create schema private;
  create table private.copy_salt (only_row boolean primary key default true, salt text not null);
  insert into private.copy_salt (salt) values ('salt');
`;

const ASKER = "354266414397390858";
const OTHER = "708022303841058907";
const post = (n: number) => `14000000000000000${String(n).padStart(2, "0")}`;

let db: PGlite;

const ask = async (n: number, asker = ASKER) =>
  (await db.query<{ r: string }>("select public.discord_ask_code($1, $2) as r", [post(n), asker])).rows[0].r;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(ASKS);
});

describe("asking for a look's code", () => {
  it("reaches the player once, whoever asks", async () => {
    expect(await ask(1)).toBe("ok");
    expect(await ask(1)).toBe("asked");
    expect(await ask(1, OTHER)).toBe("asked");
  });

  it("may be asked again a week later", async () => {
    await ask(1);
    await db.exec("update private.discord_code_asks set asked_at = now() - interval '8 days'");
    expect(await ask(1, OTHER)).toBe("ok");
    expect(await ask(1)).toBe("asked");
  });

  it("holds a person to five posts an hour", async () => {
    for (let n = 1; n <= 5; n++) expect(await ask(n)).toBe("ok");
    expect(await ask(6)).toBe("slow");
    expect(await ask(6, OTHER)).toBe("ok");
    await db.exec("update private.discord_code_asks set asked_at = now() - interval '61 minutes'");
    expect(await ask(7)).toBe("ok");
  });

  it("can be taken back when the request could not be posted", async () => {
    await ask(1);
    await db.query("select public.discord_unask_code($1)", [post(1)]);
    expect(await ask(1, OTHER)).toBe("ok");
  });

  it("keeps no one's Discord account, only a salted fingerprint", async () => {
    await ask(1);
    const { rows } = await db.query<{ row: string }>("select a::text as row from private.discord_code_asks a");
    expect(rows[0].row).not.toContain(ASKER);
  });

  it("is the server's alone", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(ask(1)).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.discord_unask_code($1)", [post(1)])).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect(await ask(1)).toBe("ok");
  });
});
