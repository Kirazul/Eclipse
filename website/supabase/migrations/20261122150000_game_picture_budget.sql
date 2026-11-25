-- A game's pictures get a budget of their own. Overlay 1.1.0 takes a picture of every set
-- whose look changes, and those counted against the same 60 pictures an account may upload
-- to publish looks. Replaced pictures counted too, until their owner opened Loadouts. A
-- player who changes sets often would have filled the account with pictures they never
-- chose to keep, and then could not publish.
--
-- Now: 60 pictures may wait on an account's sets, and the site's own uploads and published
-- looks have their 60 to themselves. Replaced pictures count against neither, and a daily
-- job removes their files (src/app/api/cron/sweep-pictures). Everything in an account's
-- folder together stops at 300 files, so a game that keeps changing looks cannot fill the
-- storage between sweeps. A picture and its thumbnail are two files.
--
-- The live code runs on this unchanged: the answers a game gets are the same words.

-- The files in an account's folder that are its game's: waiting on a set, on their way, or
-- replaced. A published look takes its pictures off the set, so they are not among these.
create function private.game_pictures(account uuid) returns setof text
language sql stable set search_path = '' as $$
  with shots as (
    select unnest(s.gallery) as path from public.game_sets s where s.user_id = account
    union select t.path from private.game_shot_tickets t where t.user_id = account
    union select o.path from private.game_shot_orphans o where o.user_id = account
  )
  select shots.path from shots
  union all
  select private.thumb_of(shots.path) from shots;
$$;

-- What the bucket's upload policy counts (the screenshot_cap migration). Same function and
-- grants, without the game's files.
create or replace function private.screenshots_stored() returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'showcase'
    and o.name like (select auth.uid())::text || '/%'
    and o.name <> all (array(select private.game_pictures((select auth.uid()))));
$$;

-- As in game_shot_begin_owner, with the caps above in place of the shared one.
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
  if stored + 2 * arriving + 2 > 300 then return jsonb_build_object('status', 'account-full'); end if;

  issued := v_owner::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.game_shot_tickets (path, user_id, set_id, expires_at)
  values (issued, v_owner, target, now() + interval '2 minutes');
  return jsonb_build_object('status', 'ok', 'path', issued);
end;
$$;

-- --------------------------------------------------------------------------
-- The daily sweep, run by the site's server with the secret key.
-- --------------------------------------------------------------------------

-- Pictures whose files may go, a batch at a time. Never one a look or a set still shows.
create function public.game_shot_sweep() returns text[]
language plpgsql security definer set search_path = '' as $$
begin
  with gone as (
    delete from private.game_shot_tickets t where t.expires_at <= now()
    returning t.path, t.user_id
  )
  insert into private.game_shot_orphans (path, user_id)
  select gone.path, gone.user_id from gone
  on conflict (path) do nothing;

  delete from private.game_shot_orphans o
  where exists (select 1 from public.outfits f where o.path = any(f.gallery))
    or exists (select 1 from public.game_sets s where o.path = any(s.gallery));

  return array(select o.path from private.game_shot_orphans o order by o.path limit 200);
end;
$$;

-- Called once the files are removed, as game_shot_forget is for an owner's own.
create function public.game_shot_swept(p_paths text[]) returns void
language sql security definer set search_path = '' as $$
  delete from private.game_shot_orphans o where o.path = any(p_paths);
$$;

revoke execute on function private.game_pictures(uuid) from public;
revoke execute on function public.game_shot_sweep() from public, anon, authenticated;
revoke execute on function public.game_shot_swept(text[]) from public, anon, authenticated;
grant execute on function public.game_shot_sweep() to service_role;
grant execute on function public.game_shot_swept(text[]) to service_role;
