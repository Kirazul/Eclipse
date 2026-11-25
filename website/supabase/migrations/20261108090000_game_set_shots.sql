-- Pictures a game sends with a saved set: the Showcase studio's "Send to website".
--
-- The route that receives them holds only the anon key, so a game uploads through a
-- ticket: game_shot_begin checks the device token and names one path, which a
-- visitor's key may store for two minutes; game_shot_attach files it on the set.
-- No new secret, and a token still cannot publish anything.
--
-- Every file has one owner. Publishing moves a set's pictures onto the look, and a
-- set whose look changes or goes loses its pictures to private.game_shot_orphans,
-- whose files the owner's own session removes (src/lib/data/supabase.ts). An
-- orphan still counts against the storage cap, so a full account clears itself the
-- next time its owner opens their sets.

-- What compress.ts writes and the bucket allows. Six a set, as MAX_SCREENSHOTS.
alter table public.game_sets add column gallery text[] not null default '{}';
alter table public.game_sets add constraint game_sets_gallery_uploads check (
  cardinality(gallery) <= 6
  and array_to_string(gallery, E'\n')
    ~ ('^(' || user_id::text || '/[0-9a-f-]{36}\.(avif|webp)(\n|$))*$')
);

alter table public.game_links add column last_shot_at timestamptz;

create table private.game_shot_tickets (
  path text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  set_id uuid not null references public.game_sets (id) on delete cascade,
  expires_at timestamptz not null
);

create index game_shot_tickets_user_idx on private.game_shot_tickets (user_id);
create index game_shot_tickets_set_idx on private.game_shot_tickets (set_id);

create table private.game_shot_orphans (
  path text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade
);

create index game_shot_orphans_user_idx on private.game_shot_orphans (user_id);

revoke all on private.game_shot_tickets, private.game_shot_orphans from public, anon, authenticated;

-- The thumbnail stored beside a picture (thumbOf in src/lib/screenshots.ts).
create function private.thumb_of(p_path text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p_path, '\.(avif|webp)$', '-thumb.\1');
$$;

-- --------------------------------------------------------------------------
-- The upload: a visitor's key may store a ticketed path and its thumbnail.
-- --------------------------------------------------------------------------

create function private.game_shot_ticketed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.game_shot_tickets t
    where t.expires_at > now()
      and (t.path = p_name or private.thumb_of(t.path) = p_name)
  );
$$;

revoke execute on function private.game_shot_ticketed(text) from public;
grant usage on schema private to anon;
grant execute on function private.game_shot_ticketed(text) to anon;

create policy "a game stores the picture it holds a ticket for" on storage.objects for insert
  to anon
  with check (bucket_id = 'showcase' and private.game_shot_ticketed(name));

-- --------------------------------------------------------------------------
-- From the game, with its device token.
-- --------------------------------------------------------------------------

create function public.game_shot_begin(p_token_hash text, p_name text, p_ext text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  target uuid;
  shown integer;
  coming integer;
  stored bigint;
  issued text;
begin
  if p_ext is null or p_ext not in ('avif', 'webp') then raise exception 'unknown picture type'; end if;

  select l.user_id into owner from public.game_links l where l.token_hash = p_token_hash;
  if owner is null then return jsonb_build_object('status', 'unlinked'); end if;

  -- One picture every few seconds a game: a picture is a few hundred kilobytes.
  update public.game_links set last_shot_at = now()
  where token_hash = p_token_hash
    and (last_shot_at is null or last_shot_at <= now() - interval '5 seconds');
  if not found then return jsonb_build_object('status', 'busy'); end if;

  -- A ticket that ran out may have stored a file nobody filed.
  with gone as (
    delete from private.game_shot_tickets t
    where t.user_id = owner and t.expires_at <= now()
    returning t.path
  )
  insert into private.game_shot_orphans (path, user_id)
  select gone.path, owner from gone
  on conflict (path) do nothing;

  select s.id, cardinality(s.gallery) into target, shown
  from public.game_sets s
  where s.user_id = owner and lower(s.name) = lower(p_name) and s.code is not null;
  if target is null then return jsonb_build_object('status', 'missing'); end if;

  select count(*) into coming from private.game_shot_tickets t where t.set_id = target;
  if shown + coming >= 6 then return jsonb_build_object('status', 'set-full'); end if;

  -- The cap the site's own uploads meet: 120 files, a picture and its thumbnail each.
  select count(*) into stored from storage.objects o
  where o.bucket_id = 'showcase' and o.name like owner::text || '/%';
  select stored + 2 * count(*) into stored from private.game_shot_tickets t where t.user_id = owner;
  if stored + 2 > 120 then return jsonb_build_object('status', 'account-full'); end if;

  issued := owner::text || '/' || gen_random_uuid()::text || '.' || p_ext;
  insert into private.game_shot_tickets (path, user_id, set_id, expires_at)
  values (issued, owner, target, now() + interval '2 minutes');
  return jsonb_build_object('status', 'ok', 'path', issued);
end;
$$;

create function public.game_shot_attach(p_token_hash text, p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  target uuid;
  shown integer;
begin
  select l.user_id into owner from public.game_links l where l.token_hash = p_token_hash;
  if owner is null then return jsonb_build_object('status', 'unlinked'); end if;

  delete from private.game_shot_tickets t
  where t.path = p_path and t.user_id = owner
  returning t.set_id into target;
  if target is null then return jsonb_build_object('status', 'missing'); end if;

  update public.game_sets s set gallery = s.gallery || p_path
  where s.id = target and s.code is not null and cardinality(s.gallery) < 6
  returning cardinality(s.gallery) into shown;
  if shown is null then
    insert into private.game_shot_orphans (path, user_id) values (p_path, owner)
    on conflict (path) do nothing;
    return jsonb_build_object('status', 'missing');
  end if;
  return jsonb_build_object('status', 'ok', 'count', shown);
end;
$$;

revoke execute on function public.game_shot_begin(text, text, text) from public;
revoke execute on function public.game_shot_attach(text, text) from public;
grant execute on function public.game_shot_begin(text, text, text) to anon;
grant execute on function public.game_shot_attach(text, text) to anon;

-- --------------------------------------------------------------------------
-- From the site, signed in.
-- --------------------------------------------------------------------------

create function public.game_set_drop_shot(p_set uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  update public.game_sets s set gallery = array_remove(s.gallery, p_path)
  where s.id = p_set and s.user_id = me and p_path = any(s.gallery);
  if found then
    insert into private.game_shot_orphans (path, user_id) values (p_path, me)
    on conflict (path) do nothing;
  end if;
end;
$$;

-- The caller's pictures waiting to be removed. A file a look or a set still shows is
-- never one of them, whatever brought it here.
create function public.game_shot_orphans() returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  delete from private.game_shot_orphans o
  where o.user_id = me
    and (
      exists (select 1 from public.outfits f where f.author_id = me and o.path = any(f.gallery))
      or exists (select 1 from public.game_sets s where s.user_id = me and o.path = any(s.gallery))
    );
  return array(
    select o.path from private.game_shot_orphans o where o.user_id = me order by o.path limit 50
  );
end;
$$;

-- Called once the files are removed: until then, a forgotten orphan would be a file
-- nothing names.
create function public.game_shot_forget(p_paths text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  delete from private.game_shot_orphans o where o.user_id = me and o.path = any(p_paths);
end;
$$;

revoke execute on function public.game_set_drop_shot(uuid, text) from public, anon;
revoke execute on function public.game_shot_orphans() from public, anon;
revoke execute on function public.game_shot_forget(text[]) from public, anon;
grant execute on function public.game_set_drop_shot(uuid, text) to authenticated;
grant execute on function public.game_shot_orphans() to authenticated;
grant execute on function public.game_shot_forget(text[]) to authenticated;

-- --------------------------------------------------------------------------
-- Where pictures go when the set changes or is published.
-- --------------------------------------------------------------------------

-- A picture shows the look it was taken of: a set whose code changes, or goes
-- (a tombstone's code is null), keeps none, and a picture still on its way is
-- refused at attach.
create function private.game_set_pictures_follow_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.code is distinct from old.code then
    insert into private.game_shot_orphans (path, user_id)
    select p, old.user_id from unnest(old.gallery) p
    on conflict (path) do nothing;
    new.gallery := '{}';

    with gone as (delete from private.game_shot_tickets t where t.set_id = old.id returning t.path)
    insert into private.game_shot_orphans (path, user_id)
    select gone.path, old.user_id from gone
    on conflict (path) do nothing;
  end if;
  return new;
end;
$$;

create trigger game_sets_pictures_follow_code
  before update of code on public.game_sets
  for each row execute function private.game_set_pictures_follow_code();

-- A look published with a set's pictures takes them: the set lets them go.
create function private.outfit_takes_set_pictures() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if cardinality(new.gallery) > 0 then
    update public.game_sets s
    set gallery = array(
      select u.p from unnest(s.gallery) with ordinality u(p, i)
      where not (u.p = any(new.gallery))
      order by u.i
    )
    where s.user_id = new.author_id and s.gallery && new.gallery;
  end if;
  return null;
end;
$$;

create trigger outfits_take_set_pictures
  after insert or update of gallery on public.outfits
  for each row execute function private.outfit_takes_set_pictures();

revoke execute on function private.thumb_of(text) from public;
revoke execute on function private.game_set_pictures_follow_code() from public;
revoke execute on function private.outfit_takes_set_pictures() from public;
