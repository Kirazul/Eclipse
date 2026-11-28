import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

// Upvote and Send to game from Discord, proved on a real Postgres. set_outfit_vote and
// game_set_send are stubbed to record who auth.uid() says is asking, which is the whole
// point: the click must act as the clicking player's site account, and nobody else.
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261128120000_discord_look_buttons.sql"), "utf8");

const SUPABASE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create schema private;
  create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create table public.seen (who uuid, what text);
  create function public.set_outfit_vote(target uuid, up boolean) returns integer language plpgsql as $$
  begin
    insert into public.seen values (auth.uid(), target::text || ':' || up::text);
    return 7;
  end $$;
  create function public.game_set_send(p_name text, p_code text) returns jsonb language plpgsql as $$
  begin
    insert into public.seen values (auth.uid(), p_name);
    return jsonb_build_object('name', p_name, 'linked', true);
  end $$;
`;

const PLAYER = "00000000-0000-0000-0000-000000000002";
const PLAYER_DISCORD = "708022303841058907";
const STRANGER_DISCORD = "111111111111111111";
const LOOK = "10000000-0000-0000-0000-000000000001";

let db: PGlite;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE);
  await db.exec(MIGRATION);
  await db.query("insert into auth.identities values ($1, 'discord', $2), ($1, 'google', $3)", [PLAYER, PLAYER_DISCORD, STRANGER_DISCORD]);
});

describe("look buttons in Discord", () => {
  it("votes as the clicking player's site account", async () => {
    const r = await one<{ n: number }>("select public.discord_set_outfit_vote($1, $2, true) as n", [PLAYER_DISCORD, LOOK]);
    expect(r.n).toBe(7);
    expect(await one("select who, what from public.seen")).toEqual({ who: PLAYER, what: `${LOOK}:true` });
  });

  it("does nothing for a Discord account with no site account, even one matching another provider's id", async () => {
    const r = await one<{ n: number | null }>("select public.discord_set_outfit_vote($1, $2, true) as n", [STRANGER_DISCORD, LOOK]);
    expect(r.n).toBeNull();
    const sent = await one<{ r: unknown }>("select public.discord_game_set_send($1, 'x', 'y') as r", [STRANGER_DISCORD]);
    expect(sent.r).toEqual({ account: false });
    expect((await one<{ n: number }>("select count(*)::int as n from public.seen")).n).toBe(0);
  });

  it("sends a look to the clicking player's sets", async () => {
    const sent = await one<{ r: unknown }>("select public.discord_game_set_send($1, 'Dark Ranger', 'ECA1:abc') as r", [PLAYER_DISCORD]);
    expect(sent.r).toEqual({ account: true, sent: { name: "Dark Ranger", linked: true } });
    expect(await one("select who, what from public.seen")).toEqual({ who: PLAYER, what: "Dark Ranger" });
  });

  it("leaves no identity behind for the next statement", async () => {
    await db.query("select public.discord_set_outfit_vote($1, $2, true)", [PLAYER_DISCORD, LOOK]);
    expect((await one<{ u: string | null }>("select auth.uid() as u")).u).toBeNull();
  });

  it("is callable by the service role only", async () => {
    for (const role of ["anon", "authenticated"]) {
      const error = await db.exec(`set role ${role}; select public.discord_set_outfit_vote('${PLAYER_DISCORD}', '${LOOK}', true);`).catch((e) => e);
      await db.exec("reset role");
      expect((error as { code?: string }).code).toBe("42501");
    }
  });
});
