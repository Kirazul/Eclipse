-- The private link between a player's account and their game. A linked game backs
-- its saved loadouts up here and receives what the website sends it. Nothing in
-- these tables is public: publishing a set stays a separate, deliberate act that
-- writes to public.outfits.

-- A game holds a device token, never a session. It can sync sets and nothing else,
-- so a token that leaks cannot publish, vote or touch the account. Only its SHA-256
-- is stored, and the website computes that, so the token never reaches the database.
create table public.game_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  -- The character and realm that last synced, shown to the owner alone.
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_sync_at timestamptz
);

create index game_links_user_idx on public.game_links (user_id);

-- The short code a player carries from the website to the game. One per account,
-- so asking for another retires the last one.
create table public.game_link_codes (
  code_hash text primary key check (char_length(code_hash) = 64),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

-- Each account's revision counter. Every writer updates this row first, and that row
-- lock is what keeps sync correct: revisions commit in the order they were issued.
-- With a global sequence a slow transaction could commit revision 10 after a client
-- had already read 11 and moved its cursor past it, and that set would never arrive.
create table public.game_sync_heads (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  rev bigint not null default 0
);

-- A null code is a deleted set. The row stays as a tombstone so a game that was
-- offline learns of the delete, and keeps no copy of the look.
create table public.game_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  icon text not null default '' check (char_length(icon) <= 64),
  code text check (code is null or (code like 'ECA1:%' and char_length(code) <= 32768)),
  rev bigint not null,
  updated_at timestamptz not null default now()
);

-- The game files loadouts without regard to case, so the database must too.
create unique index game_sets_name_idx on public.game_sets (user_id, lower(name));
create index game_sets_rev_idx on public.game_sets (user_id, rev);

alter table public.game_links enable row level security;
alter table public.game_link_codes enable row level security;
alter table public.game_sync_heads enable row level security;
alter table public.game_sets enable row level security;

-- Grants, then policies: RLS picks the rows, and these pick the columns and verbs.
-- Every write to a set goes through a function below, because a direct write would
-- skip the revision and no game would ever hear of it.
revoke all on public.game_links, public.game_link_codes, public.game_sync_heads, public.game_sets
  from public, anon, authenticated;
grant select (id, label, created_at, last_sync_at), delete on public.game_links to authenticated;
grant select on public.game_sets to authenticated;

create policy "see own games" on public.game_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "unlink own game" on public.game_links for delete to authenticated
  using ((select auth.uid()) = user_id);
create policy "see own sets" on public.game_sets for select to authenticated
  using ((select auth.uid()) = user_id);

-- --- helpers ----------------------------------------------------------------

-- Takes the account's lock and returns its current revision. The lock holds until
-- the transaction ends, so the caller owns the account's revisions until then.
create function private.game_lock(owner uuid) returns bigint
language sql set search_path = '' as $$
  insert into public.game_sync_heads (user_id) values (owner)
  on conflict (user_id) do update set rev = public.game_sync_heads.rev
  returning rev;
$$;

-- The first of "Raid", "Raid (2)", "Raid (3)", ... no live set is using.
create function private.game_free_name(owner uuid, wanted text) returns text
language plpgsql set search_path = '' as $$
declare
  n integer := 1;
  candidate text := wanted;
begin
  while exists (
    select 1 from public.game_sets s
    where s.user_id = owner and lower(s.name) = lower(candidate) and s.code is not null
  ) loop
    n := n + 1;
    candidate := left(wanted, 72) || ' (' || n || ')';
  end loop;
  return candidate;
end;
$$;

create function private.game_put(owner uuid, p_name text, p_icon text, p_code text, p_rev bigint) returns uuid
language sql set search_path = '' as $$
  insert into public.game_sets (user_id, name, icon, code, rev)
  values (owner, p_name, p_icon, p_code, p_rev)
  on conflict (user_id, lower(name)) do update
    set name = excluded.name, icon = excluded.icon, code = excluded.code,
        rev = excluded.rev, updated_at = now()
  returning id;
$$;

revoke execute on function private.game_lock(uuid) from public;
revoke execute on function private.game_free_name(uuid, text) from public;
revoke execute on function private.game_put(uuid, text, text, text, bigint) from public;

-- --- linking ----------------------------------------------------------------

create function public.game_link_new(p_code_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  expires timestamptz := now() + interval '10 minutes';
begin
  if me is null then raise exception 'sign in first'; end if;
  insert into public.game_link_codes (code_hash, user_id, expires_at)
  values (p_code_hash, me, expires)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at;
  return expires;
end;
$$;

revoke execute on function public.game_link_new(text) from public, anon;
grant execute on function public.game_link_new(text) to authenticated;

-- The game has no session to send, which is why this and the two below are open to
-- anon. Holding the code or the token is the proof, as it would be behind any API.
-- Returns 'linked', 'invalid' or 'full'. The lock makes a code single-use.
create function public.game_link_claim(p_code_hash text, p_token_hash text, p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
begin
  select c.user_id into owner from public.game_link_codes c
  where c.code_hash = p_code_hash and c.expires_at > now()
  for update;
  if not found then return 'invalid'; end if;

  if (select count(*) from public.game_links l where l.user_id = owner) >= 10 then
    return 'full';
  end if;

  delete from public.game_link_codes where code_hash = p_code_hash;
  insert into public.game_links (user_id, token_hash, label)
  values (owner, p_token_hash, left(coalesce(p_label, ''), 80));
  return 'linked';
end;
$$;

revoke execute on function public.game_link_claim(text, text, text) from public, authenticated;
grant execute on function public.game_link_claim(text, text, text) to anon;

create function public.game_unlink(p_token_hash text) returns void
language sql security definer set search_path = '' as $$
  delete from public.game_links where token_hash = p_token_hash;
$$;

revoke execute on function public.game_unlink(text) from public, authenticated;
grant execute on function public.game_unlink(text) to anon;

-- --- sync -------------------------------------------------------------------

-- One round. p_changes is up to 100 of { name, icon, code, base }: base is the
-- revision the game last saw of that set, 0 if it never did, and a null code is a
-- delete. Every conflict is settled here, so the game has no merge logic to get
-- wrong: whatever comes back in `sets` is simply applied.
--
-- Nothing is ever lost. Two edits of one set keep both looks, the second under a
-- numbered name. A delete of a set the game has not seen the latest of is refused,
-- and the newer look goes back to it.
create function public.game_sync(p_token_hash text, p_cursor bigint, p_label text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  head bigint;
  since timestamptz;
  live integer;
  change jsonb;
  v_name text;
  v_icon text;
  v_code text;
  v_base bigint;
  current public.game_sets;
  stored uuid;
  acks jsonb := '[]';
  rejected jsonb := '[]';
  acked uuid[] := '{}';    -- Already known to this game: not sent back.
  forced uuid[] := '{}';   -- Must go back, even from behind the game's cursor.
  page jsonb;
  page_size integer;
  page_end bigint;
  more boolean;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 100 then
    raise exception 'a sync carries at most 100 changes';
  end if;

  select l.user_id into owner from public.game_links l where l.token_hash = p_token_hash;
  if not found then return jsonb_build_object('status', 'unlinked'); end if;

  head := private.game_lock(owner);

  -- Read under the lock, so two calls racing each other cannot both pass.
  select l.last_sync_at into since from public.game_links l where l.token_hash = p_token_hash;
  if since > clock_timestamp() - interval '2 seconds' then
    return jsonb_build_object('status', 'busy');
  end if;

  select count(*) into live from public.game_sets s where s.user_id = owner and s.code is not null;

  for change in select value from jsonb_array_elements(p_changes) loop
    v_name := change->>'name';
    v_icon := coalesce(change->>'icon', '');
    v_code := change->>'code';
    v_base := coalesce((change->>'base')::bigint, 0);

    select * into current from public.game_sets s
    where s.user_id = owner and lower(s.name) = lower(v_name);

    if v_code is null then
      if current.id is null then
        acks := acks || jsonb_build_object('name', v_name, 'rev', 0);
      elsif current.code is null then
        acks := acks || jsonb_build_object('name', v_name, 'rev', current.rev);
        acked := acked || current.id;
      elsif current.rev = v_base then
        head := head + 1;
        update public.game_sets set code = null, icon = '', rev = head, updated_at = now()
        where id = current.id;
        live := live - 1;
        acks := acks || jsonb_build_object('name', v_name, 'rev', head);
        acked := acked || current.id;
      else
        forced := forced || current.id;
      end if;

    elsif current.code = v_code and current.icon = v_icon then
      acks := acks || jsonb_build_object('name', current.name, 'rev', current.rev);
      acked := acked || current.id;

    elsif current.code <> v_code and current.rev <> v_base then
      if live >= 300 then
        rejected := rejected || to_jsonb(v_name);
        forced := forced || current.id;
      else
        head := head + 1;
        perform private.game_put(owner, private.game_free_name(owner, v_name), v_icon, v_code, head);
        live := live + 1;
        forced := forced || current.id;
      end if;

    elsif current.code is null and live >= 300 then
      rejected := rejected || to_jsonb(v_name);

    else
      head := head + 1;
      stored := private.game_put(owner, v_name, v_icon, v_code, head);
      if current.code is null then live := live + 1; end if;
      acks := acks || jsonb_build_object('name', v_name, 'rev', head);
      acked := acked || stored;
    end if;

    current := null;
  end loop;

  update public.game_sync_heads set rev = head where user_id = owner;
  update public.game_links
  set last_sync_at = clock_timestamp(),
      label = case when coalesce(p_label, '') = '' then label else left(p_label, 80) end
  where token_hash = p_token_hash;

  -- 50 at the largest allowed code is 1.6 MB, which a game can take in one answer.
  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.rev), '[]'), count(*), max(r.rev)
  into page, page_size, page_end
  from (
    select s.name, s.icon, s.code, s.rev from public.game_sets s
    where s.user_id = owner and s.rev > p_cursor
      and not (s.id = any (acked)) and not (s.id = any (forced))
    order by s.rev
    limit 50
  ) r;

  -- Only a full page can have more behind it. Rows this round acked are skipped by
  -- the page but not by the cursor, so a follow-up page may repeat them, harmlessly.
  more := page_size = 50 and exists (
    select 1 from public.game_sets s
    where s.user_id = owner and s.rev > page_end
      and not (s.id = any (acked)) and not (s.id = any (forced))
  );

  page := page || coalesce(
    (select jsonb_agg(row_to_json(r)::jsonb)
     from (select s.name, s.icon, s.code, s.rev from public.game_sets s
           where s.id = any (forced)) r),
    '[]'
  );

  return jsonb_build_object(
    'status', 'ok',
    'cursor', case when more then page_end else head end,
    'more', more,
    'acks', acks,
    'rejected', rejected,
    'sets', page
  );
end;
$$;

revoke execute on function public.game_sync(text, bigint, text, jsonb) from public, authenticated;
grant execute on function public.game_sync(text, bigint, text, jsonb) to anon;

-- --- the website's own writes -------------------------------------------------

-- Saves a look to the signed-in player's sets, which is all "send to game" is: the
-- next sync of every linked game finds it there, with no inbox to deliver or ack.
-- The same look twice stays one set. Returns null when the account is full.
create function public.game_set_send(p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  head bigint;
  filed text;
  linked boolean;
begin
  if me is null then raise exception 'sign in first'; end if;
  head := private.game_lock(me);
  linked := exists (select 1 from public.game_links l where l.user_id = me);

  select s.name into filed from public.game_sets s where s.user_id = me and s.code = p_code limit 1;
  if found then return jsonb_build_object('name', filed, 'linked', linked); end if;

  if (select count(*) from public.game_sets s where s.user_id = me and s.code is not null) >= 300 then
    return null;
  end if;

  filed := private.game_free_name(me, p_name);
  perform private.game_put(me, filed, '', p_code, head + 1);
  update public.game_sync_heads set rev = head + 1 where user_id = me;
  return jsonb_build_object('name', filed, 'linked', linked);
end;
$$;

revoke execute on function public.game_set_send(text, text) from public, anon;
grant execute on function public.game_set_send(text, text) to authenticated;

create function public.game_set_remove(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  head bigint;
begin
  if me is null then raise exception 'sign in first'; end if;
  head := private.game_lock(me) + 1;
  update public.game_sets set code = null, icon = '', rev = head, updated_at = now()
  where id = p_id and user_id = me and code is not null;
  if found then
    update public.game_sync_heads set rev = head where user_id = me;
  end if;
end;
$$;

revoke execute on function public.game_set_remove(uuid) from public, anon;
grant execute on function public.game_set_remove(uuid) to authenticated;
