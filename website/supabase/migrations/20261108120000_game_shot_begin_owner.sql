-- game_shot_begin failed on every call in production: its variable `owner` is also
-- a column of storage.objects, which it counts for the account cap, so Postgres
-- refused "column reference owner is ambiguous" and the game was told
-- `unavailable`. The same function, with the variable renamed. Grants carry over.

create or replace function public.game_shot_begin(p_token_hash text, p_name text, p_ext text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  target uuid;
  shown integer;
  coming integer;
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

  -- The cap the site's own uploads meet: 120 files, a picture and its thumbnail each.
  select count(*) into stored from storage.objects o
  where o.bucket_id = 'showcase' and o.name like v_owner::text || '/%';
  select stored + 2 * count(*) into stored from private.game_shot_tickets t where t.user_id = v_owner;
  if stored + 2 > 120 then return jsonb_build_object('status', 'account-full'); end if;

  issued := v_owner::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.game_shot_tickets (path, user_id, set_id, expires_at)
  values (issued, v_owner, target, now() + interval '2 minutes');
  return jsonb_build_object('status', 'ok', 'path', issued);
end;
$$;
