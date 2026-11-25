import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// The sync rules live in plpgsql, so they are proved on a real Postgres. Only the
// parts Supabase provides are stubbed: its roles, its default grants and auth.uid().
const migration = (name: string) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8");
const MIGRATION = migration("20261101090000_game_sync.sql");
const SEND_WINS = migration("20261108150000_game_set_send_wins.sql");

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
  create table public.profiles (id uuid primary key);
`;

const ME = "00000000-0000-0000-0000-000000000001";
const STRANGER = "00000000-0000-0000-0000-000000000002";
const TOKEN = "a".repeat(64);
const STRANGER_TOKEN = "b".repeat(64);
const OTHER_PC = "c".repeat(64);

interface SyncResult {
  status: string;
  cursor: number;
  more: boolean;
  acks: { name: string; rev: number }[];
  rejected: string[];
  sets: { name: string; icon: string; code: string | null; rev: number }[];
}

type Change = { name: string; base?: number; icon?: string; code?: string | null };
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

async function call<T>(role: Role, user: string | null, sql: string, params: unknown[]) {
  return as(role, user, async () => (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0].r);
}

// Sync calls are rate limited per link, so each test's calls look spaced out.
async function sync(token: string, cursor: number, changes: Change[], label = "") {
  await db.exec("update public.game_links set last_sync_at = null");
  return call<SyncResult>("anon", null, "public.game_sync($1, $2, $3, $4::jsonb)", [
    token, cursor, label, JSON.stringify(changes),
  ]);
}

const claim = (code: string, token: string) =>
  call<string>("anon", null, "public.game_link_claim($1, $2, $3)", [code, token, "Lee - Icecrown"]);

const issue = (user: string | null, code: string) =>
  call("authenticated", user, "public.game_link_new($1)", [code]);

async function link(user: string, token: string, code = token.replace(/./g, "d")) {
  await issue(user, code);
  return claim(code, token);
}

const put = (name: string, code: string, base = 0, icon = ""): Change => ({ name, code, base, icon });

async function liveNames() {
  const { rows } = await db.query<{ name: string }>("select name from public.game_sets where code is not null order by name");
  return rows.map((r) => r.name);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
  await db.exec(SEND_WINS);
  await db.exec(`insert into public.profiles (id) values ('${ME}'), ('${STRANGER}');`);
});

describe("linking a game", () => {
  it("trades a code for a device token once", async () => {
    expect(await link(ME, TOKEN, "e".repeat(64))).toBe("linked");
    expect(await claim("e".repeat(64), OTHER_PC)).toBe("invalid");
  });

  it("refuses an expired code", async () => {
    await issue(ME, "e".repeat(64));
    await db.exec("update public.game_link_codes set expires_at = now() - interval '1 second'");
    expect(await claim("e".repeat(64), TOKEN)).toBe("invalid");
  });

  it("keeps one live code per account", async () => {
    await issue(ME, "e".repeat(64));
    await issue(ME, "f".repeat(64));
    expect(await claim("e".repeat(64), TOKEN)).toBe("invalid");
    expect(await claim("f".repeat(64), TOKEN)).toBe("linked");
  });

  it("will not issue a code to a visitor", async () => {
    await expect(call("anon", null, "public.game_link_new($1)", ["e".repeat(64)])).rejects.toThrow();
    await expect(issue(null, "e".repeat(64))).rejects.toThrow();
  });

  it("stops at ten games and keeps the code for after one is removed", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await link(ME, String(i).repeat(64), "e".repeat(63) + i)).toBe("linked");
    }
    const code = "f".repeat(64);
    await issue(ME, code);
    expect(await claim(code, TOKEN)).toBe("full");
    await db.exec("delete from public.game_links where id = (select id from public.game_links limit 1)");
    expect(await claim(code, TOKEN)).toBe("linked");
  });

  it("ends a token when the game unlinks itself", async () => {
    await link(ME, TOKEN);
    await call("anon", null, "public.game_unlink($1)", [TOKEN]);
    expect((await sync(TOKEN, 0, [])).status).toBe("unlinked");
  });
});

describe("what a signed-in visitor can reach", () => {
  beforeEach(async () => {
    await link(ME, TOKEN);
    await link(STRANGER, STRANGER_TOKEN);
    await sync(TOKEN, 0, [put("Mine", "ECA1:AA")]);
    await sync(STRANGER_TOKEN, 0, [put("Theirs", "ECA1:BB")]);
  });

  const select = (role: Role, user: string | null, sql: string) =>
    as(role, user, async () => (await db.query<Record<string, unknown>>(sql)).rows);

  it("shows an owner their own sets and nobody else's", async () => {
    expect(await select("authenticated", ME, "select name from public.game_sets")).toEqual([{ name: "Mine" }]);
    await expect(select("anon", null, "select name from public.game_sets")).rejects.toThrow(/permission/);
  });

  it("never exposes a token hash, even to its owner", async () => {
    await expect(select("authenticated", ME, "select token_hash from public.game_links")).rejects.toThrow(/permission/);
    expect(await select("authenticated", ME, "select label from public.game_links")).toEqual([{ label: "Lee - Icecrown" }]);
  });

  it("refuses direct writes, which would skip the revision", async () => {
    await expect(
      as("authenticated", ME, () => db.query("update public.game_sets set code = 'ECA1:XX'")),
    ).rejects.toThrow(/permission/);
    await expect(
      as("authenticated", ME, () => db.query(`insert into public.game_sets (user_id, name, rev) values ('${ME}', 'x', 1)`)),
    ).rejects.toThrow(/permission/);
  });

  it("lets an owner unlink only their own game", async () => {
    const theirs = await db.query<{ id: string }>(`select id from public.game_links where user_id = '${STRANGER}'`);
    await as("authenticated", ME, () => db.query(`delete from public.game_links where id = '${theirs.rows[0].id}'`));
    expect((await sync(STRANGER_TOKEN, 0, [])).status).toBe("ok");
    const mine = await db.query<{ id: string }>(`select id from public.game_links where user_id = '${ME}'`);
    await as("authenticated", ME, () => db.query(`delete from public.game_links where id = '${mine.rows[0].id}'`));
    expect((await sync(TOKEN, 0, [])).status).toBe("unlinked");
  });

  it("keeps the codes table and the revision counter out of reach", async () => {
    await expect(select("authenticated", ME, "select * from public.game_link_codes")).rejects.toThrow(/permission/);
    await expect(select("authenticated", ME, "select * from public.game_sync_heads")).rejects.toThrow(/permission/);
  });

  it("removes every trace with the account", async () => {
    await db.exec(`delete from public.profiles where id = '${ME}'`);
    expect(await liveNames()).toEqual(["Theirs"]);
    expect((await sync(TOKEN, 0, [])).status).toBe("unlinked");
  });
});

describe("syncing", () => {
  beforeEach(async () => {
    await link(ME, TOKEN);
    await link(ME, OTHER_PC, "9".repeat(64));
  });

  it("turns away a token it does not know", async () => {
    expect((await sync(STRANGER_TOKEN, 0, [put("x", "ECA1:AA")])).status).toBe("unlinked");
    expect(await liveNames()).toEqual([]);
  });

  it("takes a new set and tells the game its revision", async () => {
    const r = await sync(TOKEN, 0, [put("Raid", "ECA1:AA", 0, "inv_helm")]);
    expect(r.acks).toEqual([{ name: "Raid", rev: 1 }]);
    expect(r.cursor).toBe(1);
    expect(r.sets).toEqual([]);
  });

  it("gives a second PC everything, which is how a reinstall restores", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA", 0, "inv_helm"), put("Town", "ECA1:BB")]);
    const r = await sync(OTHER_PC, 0, []);
    expect(r.sets.map((s) => [s.name, s.code, s.icon])).toEqual([["Raid", "ECA1:AA", "inv_helm"], ["Town", "ECA1:BB", ""]]);
    expect(r.cursor).toBe(2);
  });

  it("sends only what changed since the cursor", async () => {
    const first = await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    await sync(TOKEN, first.cursor, [put("Town", "ECA1:BB")]);
    const r = await sync(OTHER_PC, first.cursor, []);
    expect(r.sets.map((s) => s.name)).toEqual(["Town"]);
  });

  it("updates a set edited from the revision it last saw", async () => {
    const first = await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    const r = await sync(TOKEN, first.cursor, [put("Raid", "ECA1:CC", first.acks[0].rev)]);
    expect(r.acks[0].rev).toBe(2);
    expect((await sync(OTHER_PC, 0, [])).sets[0].code).toBe("ECA1:CC");
  });

  it("treats names the way the game does, without case", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    await sync(TOKEN, 1, [put("RAID", "ECA1:CC", 1)]);
    expect(await liveNames()).toEqual(["RAID"]);
  });

  it("acknowledges a set the server already holds, so a first sync never conflicts with itself", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    const r = await sync(OTHER_PC, 0, [put("Raid", "ECA1:AA")]);
    expect(r.acks).toEqual([{ name: "Raid", rev: 1 }]);
    expect(r.sets).toEqual([]);
  });

  it("keeps both looks when two PCs edit the same set, and tells the loser about both", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    await sync(TOKEN, 1, [put("Raid", "ECA1:BB", 1)]);
    const r = await sync(OTHER_PC, 1, [put("Raid", "ECA1:CC", 1)]);
    expect(await liveNames()).toEqual(["Raid", "Raid (2)"]);
    expect(r.acks).toEqual([]);
    expect(r.sets.map((s) => [s.name, s.code]).sort()).toEqual([["Raid (2)", "ECA1:CC"], ["Raid", "ECA1:BB"]]);
  });

  it("does not copy a look whose only difference is its icon", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA", 0, "inv_helm")]);
    await sync(OTHER_PC, 0, [put("Raid", "ECA1:AA", 0, "inv_chest")]);
    expect(await liveNames()).toEqual(["Raid"]);
  });

  it("numbers past copies that already exist", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA"), put("Raid (2)", "ECA1:BB")]);
    await sync(OTHER_PC, 0, [put("Raid", "ECA1:CC", 0)]);
    expect(await liveNames()).toEqual(["Raid", "Raid (2)", "Raid (3)"]);
  });

  it("deletes a set for the other PC", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    const r = await sync(TOKEN, 1, [{ name: "Raid", base: 1, code: null }]);
    expect(r.acks).toEqual([{ name: "Raid", rev: 2 }]);
    const other = await sync(OTHER_PC, 1, []);
    expect(other.sets).toEqual([{ name: "Raid", icon: "", code: null, rev: 2 }]);
    expect(await liveNames()).toEqual([]);
  });

  it("refuses a delete of something the game has not seen, and sends the newer look back", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    await sync(TOKEN, 1, [put("Raid", "ECA1:BB", 1)]);
    const r = await sync(OTHER_PC, 2, [{ name: "Raid", base: 1, code: null }]);
    expect(await liveNames()).toEqual(["Raid"]);
    expect(r.sets.map((s) => s.code)).toEqual(["ECA1:BB"]);
  });

  it("brings a deleted name back when a game saves it again", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    await sync(TOKEN, 1, [{ name: "Raid", base: 1, code: null }]);
    await sync(TOKEN, 2, [put("Raid", "ECA1:BB", 0)]);
    expect(await liveNames()).toEqual(["Raid"]);
  });

  it("does nothing on an empty sync but report the cursor", async () => {
    await sync(TOKEN, 0, [put("Raid", "ECA1:AA")]);
    const r = await sync(TOKEN, 1, []);
    expect(r).toMatchObject({ status: "ok", cursor: 1, more: false, acks: [], sets: [] });
  });

  it("stops taking sets at the cap and says which it refused", async () => {
    const full = Array.from({ length: 300 }, (_, i) => `('${ME}', 'set ${i}', 'ECA1:AA', ${i + 1})`).join(",");
    await db.exec(`insert into public.game_sets (user_id, name, code, rev) values ${full};
      insert into public.game_sync_heads (user_id, rev) values ('${ME}', 300)
        on conflict (user_id) do update set rev = 300;`);
    const r = await sync(TOKEN, 300, [put("One more", "ECA1:BB")]);
    expect(r.rejected).toEqual(["One more"]);
    expect(r.acks).toEqual([]);
  });

  it("refuses more than a batch at once", async () => {
    const many = Array.from({ length: 101 }, (_, i) => put(`set ${i}`, "ECA1:AA"));
    await expect(sync(TOKEN, 0, many)).rejects.toThrow();
  });

  it("pages a large restore without losing a set", async () => {
    const batch = (from: number) => Array.from({ length: 100 }, (_, i) => put(`set ${from + i}`, "ECA1:AA"));
    await sync(TOKEN, 0, batch(0));
    await sync(TOKEN, 100, batch(100));
    const seen = new Set<string>();
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const r = await sync(OTHER_PC, cursor, []);
      r.sets.forEach((s) => seen.add(s.name));
      cursor = r.cursor;
      pages += 1;
      if (!r.more) break;
    }
    expect(seen.size).toBe(200);
    expect(pages).toBeGreaterThan(1);
  });

  it("holds back a game that calls too fast", async () => {
    await sync(TOKEN, 0, []);
    const second = await call<SyncResult>("anon", null, "public.game_sync($1, $2, $3, $4::jsonb)", [TOKEN, 0, "", "[]"]);
    expect(second.status).toBe("busy");
  });

  it("remembers which character last synced", async () => {
    await sync(TOKEN, 0, [], "Thrall - Icecrown");
    const { rows } = await db.query<{ label: string; last_sync_at: string }>(
      `select label, last_sync_at from public.game_links where token_hash = '${TOKEN}'`,
    );
    expect(rows[0].label).toBe("Thrall - Icecrown");
    expect(rows[0].last_sync_at).not.toBeNull();
  });
});

describe("the website's own writes", () => {
  beforeEach(async () => {
    await link(ME, TOKEN);
  });

  const send = (name: string, code: string, user: string | null = ME) =>
    call<{ name: string; linked: boolean } | null>("authenticated", user, "public.game_set_send($1, $2)", [name, code]);

  it("puts a look where the next sync picks it up", async () => {
    expect(await send("Dreadful", "ECA1:AA")).toEqual({ name: "Dreadful", linked: true });
    const r = await sync(TOKEN, 0, []);
    expect(r.sets.map((s) => [s.name, s.code])).toEqual([["Dreadful", "ECA1:AA"]]);
  });

  it("does not file the same look twice", async () => {
    await send("Dreadful", "ECA1:AA");
    expect(await send("Renamed post", "ECA1:AA")).toEqual({ name: "Dreadful", linked: true });
    expect(await liveNames()).toEqual(["Dreadful"]);
  });

  it("wins over a delete the game has not reported yet, and goes back to that game", async () => {
    await send("Dreadful", "ECA1:AA");
    const first = await sync(TOKEN, 0, []);
    // Deleted in game, then sent again from the site before that game's next sync.
    await send("Dreadful", "ECA1:AA");
    const r = await sync(TOKEN, first.cursor, [{ name: "Dreadful", base: first.cursor, code: null }]);
    expect(await liveNames()).toEqual(["Dreadful"]);
    expect(r.sets.map((s) => [s.name, s.code])).toEqual([["Dreadful", "ECA1:AA"]]);
  });

  it("files a different look with the same name beside it", async () => {
    await send("Dreadful", "ECA1:AA");
    expect((await send("Dreadful", "ECA1:BB"))?.name).toBe("Dreadful (2)");
  });

  it("says when no game is linked yet", async () => {
    expect(await send("Dreadful", "ECA1:AA", STRANGER)).toEqual({ name: "Dreadful", linked: false });
  });

  it("refuses a visitor", async () => {
    await expect(send("Dreadful", "ECA1:AA", null)).rejects.toThrow();
  });

  it("removes a set from every game, and only the owner's", async () => {
    await send("Dreadful", "ECA1:AA");
    const { rows } = await db.query<{ id: string }>("select id from public.game_sets");
    await call("authenticated", STRANGER, "public.game_set_remove($1)", [rows[0].id]);
    expect(await liveNames()).toEqual(["Dreadful"]);
    await call("authenticated", ME, "public.game_set_remove($1)", [rows[0].id]);
    expect(await liveNames()).toEqual([]);
    const r = await sync(TOKEN, 1, []);
    expect(r.sets).toEqual([{ name: "Dreadful", icon: "", code: null, rev: 2 }]);
  });
});
