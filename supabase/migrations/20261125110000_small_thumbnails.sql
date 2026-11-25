-- A third, smaller copy of every picture, for phones and little thumbnails: <name>-small.avif,
-- 480 px on its long edge, stored beside <name>-thumb.avif (src/lib/data/compress.ts, smallOf
-- in src/lib/screenshots.ts). Pictures stored before it get theirs from
-- tools/backfill-small-thumbs.mts.
--
-- Every cap that counts files grows by half, so a picture being three files leaves players
-- the same number of pictures: 60 of the site's own, and the game's budget as before.
--
-- The live code runs on this unchanged: it writes two files a picture, which the larger caps
-- only leave more room for, and the ticket's new name is one it never asks to store.

-- The small copy stored beside a picture, as private.thumb_of names the thumbnail.
create function private.small_of(p_path text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p_path, '\.(avif|webp)$', '-small.\1');
$$;

revoke execute on function private.small_of(text) from public;

-- A game's ticket lets it store the small copy too (20261108090000_game_set_shots.sql).
create or replace function private.game_shot_ticketed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.game_shot_tickets t
    where t.expires_at > now()
      and (t.path = p_name or private.thumb_of(t.path) = p_name or private.small_of(t.path) = p_name)
  );
$$;

-- The game's files, small copies included, so the site's own cap never counts them
-- (20261122150000_game_picture_budget.sql).
create or replace function private.game_pictures(account uuid) returns setof text
language sql stable set search_path = '' as $$
  with shots as (
    select unnest(s.gallery) as path from public.game_sets s where s.user_id = account
    union select t.path from private.game_shot_tickets t where t.user_id = account
    union select o.path from private.game_shot_orphans o where o.user_id = account
  )
  select shots.path from shots
  union all
  select private.thumb_of(shots.path) from shots
  union all
  select private.small_of(shots.path) from shots;
$$;

-- 60 screenshots: each is stored as a full-size file, a thumbnail and a small copy.
drop policy "upload screenshots to your own folder" on storage.objects;
create policy "upload screenshots to your own folder" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.screenshots_stored()) < 180
  );

-- As in the game_picture_budget migration, with everything in the account's folder stopping
-- at 450 files, the old 300 at three files a picture, and a ticket reserving three.
create or replace function public.game_shot_begin(p_token_hash text, p_name text, p_ext text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  target uuid;
  shown integer;
  coming integer;
  waiting bigint;
  arriving bigint;
  stored bigint;
  issued text;
begin
  if p_ext is null or p_ext not in ('avif', 'webp') then raise exception 'unknown picture type'; end if;

  select l.user_id into v_owner from public.game_links l where l.token_hash = p_token_hash;
  if v_owner is null then return jsonb_build_object('status', 'unlinked'); end if;

  -- One picture every few seconds a game: a picture is a few hundred kilobytes.
  update public.game_links set last_shot_at = now()
  where token_hash = p_token_hash
    and (last_shot_at is null or last_shot_at <= now() - interval '5 seconds');
  if not found then return jsonb_build_object('status', 'busy'); end if;

  -- A ticket that ran out may have stored a file nobody filed.
  with gone as (
    delete from private.game_shot_tickets t
    where t.user_id = v_owner and t.expires_at <= now()
    returning t.path
  )
  insert into private.game_shot_orphans (path, user_id)
  select gone.path, v_owner from gone
  on conflict (path) do nothing;

  select s.id, cardinality(s.gallery) into target, shown
  from public.game_sets s
  where s.user_id = v_owner and lower(s.name) = lower(p_name) and s.code is not null;
  if target is null then return jsonb_build_object('status', 'missing'); end if;

  select count(*) into coming from private.game_shot_tickets t where t.set_id = target;
  if shown + coming >= 6 then return jsonb_build_object('status', 'set-full'); end if;

  select coalesce(sum(cardinality(s.gallery)), 0) into waiting
  from public.game_sets s where s.user_id = v_owner;
  select count(*) into arriving from private.game_shot_tickets t where t.user_id = v_owner;
  if waiting + arriving >= 60 then return jsonb_build_object('status', 'account-full'); end if;

  select count(*) into stored from storage.objects o
  where o.bucket_id = 'showcase' and o.name like v_owner::text || '/%';
  if stored + 3 * arriving + 3 > 450 then return jsonb_build_object('status', 'account-full'); end if;

  issued := v_owner::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.game_shot_tickets (path, user_id, set_id, expires_at)
  values (issued, v_owner, target, now() + interval '2 minutes');
  return jsonb_build_object('status', 'ok', 'path', issued);
end;
$$;
