-- Public names, and the floor under what a direct API call can store. The site's
-- own validators are stricter; these hold for a request that skips the site.

-- No name means the person has not chosen one yet. Google's profile name is a
-- real name, so it is never copied here.
alter table public.profiles alter column display_name drop not null;

alter table public.profiles drop constraint profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check check (
  char_length(display_name) between 2 and 32
  and display_name = btrim(display_name)
  and display_name !~ '[[:cntrl:]]'
);

-- One person to a name, however it is cased. Several nulls are allowed.
create unique index profiles_display_name_key on public.profiles (lower(display_name));

-- Discord's username is already public, so a Discord sign-in keeps it. Anyone
-- else, or a Discord name that is taken or unusable, is asked to choose: a bad
-- name must never stop a signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  discord_name text := case
    when new.raw_app_meta_data ->> 'provider' = 'discord'
      then btrim(new.raw_user_meta_data ->> 'full_name')
  end;
begin
  insert into public.profiles (id, display_name) values (new.id, discord_name);
  return new;
exception
  when check_violation or unique_violation then
    insert into public.profiles (id, display_name) values (new.id, null);
    return new;
end;
$$;

-- Nothing is published without a name to show on it.
drop policy "publish as yourself" on public.outfits;
create policy "publish as yourself" on public.outfits for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.profiles p
      where p.id = author_id and p.display_name is not null
    )
  );

drop policy "publish preset as yourself" on public.world_presets;
create policy "publish preset as yourself" on public.world_presets for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.profiles p
      where p.id = author_id and p.display_name is not null
    )
  );

-- Lists of tags and links are checked joined, one entry to a line, so no helper
-- function is needed in the exposed schema.
alter table public.outfits
  add constraint outfits_class_name_length check (char_length(class_name) <= 32),
  add constraint outfits_race_length check (char_length(race) <= 32),
  add constraint outfits_tags_length check (
    array_to_string(tags, E'\n') !~ '[^\n]{25}'
  ),
  add constraint outfits_gallery_https check (
    cardinality(gallery) = 0
    or (
      E'\n' || array_to_string(gallery, E'\n') !~ E'\n(?!https://)'
      and char_length(array_to_string(gallery, E'\n')) <= 12000
    )
  );

-- Reads the rows the limit counts. Replaces the plain author index: a query on
-- author_id alone still uses this one.
create index outfits_author_created_idx on public.outfits (author_id, created_at desc);
drop index public.outfits_author_idx;

-- Enough for a real session, not for a script filling the Wardrobe.
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

revoke execute on function public.limit_publishing() from public, anon, authenticated;

create trigger limit_publishing before insert on public.outfits
  for each row execute function public.limit_publishing();
