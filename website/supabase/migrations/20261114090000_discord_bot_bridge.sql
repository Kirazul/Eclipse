-- What the Discord bot needs from the database: adding a showcase post to the Wardrobe
-- at a right-click, and keeping the Wardrobe Creator and Look of the Week roles on the
-- right people. Only the site's server runs these, with the secret key: nothing here is
-- granted to visitors, signed in or not. Purely additive, so the live code runs on it.

-- Who holds a role the bot hands to one person at a time, so the next holder takes it
-- over. Out of the API, as private.* is.
create table private.discord_role_holders (
  role text primary key check (role in ('look_of_the_week')),
  discord_id text not null check (discord_id ~ '^[0-9]{17,20}$')
);

-- The Discord account behind a look: its author's, or for a look its player has not
-- claimed yet, the player who shared it. Null for one of the game's own sets.
create function public.discord_id_of_look(look uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select i.provider_id from public.outfits o
       join auth.identities i on i.user_id = o.author_id and i.provider = 'discord'
       where o.id = look limit 1),
    (select d.discord_id from public.discord_looks d where d.outfit_id = look)
  );
$$;

-- Every Discord account with at least one look on the Wardrobe.
create function public.discord_creators() returns setof text
language sql stable security definer set search_path = '' as $$
  select i.provider_id from auth.identities i
    where i.provider = 'discord'
      and exists (select 1 from public.outfits o where o.author_id = i.user_id)
  union
  select d.discord_id from public.discord_looks d;
$$;

create function public.discord_has_looks(player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.discord_creators() c where c = player);
$$;

-- Hands a role to its next holder (or to nobody) and says who held it before.
create function public.swap_discord_role_holder(which text, holder text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  previous text;
begin
  select h.discord_id into previous from private.discord_role_holders h where h.role = which for update;
  if holder is null then
    delete from private.discord_role_holders h where h.role = which;
  else
    insert into private.discord_role_holders (role, discord_id) values (which, holder)
      on conflict (role) do update set discord_id = excluded.discord_id;
  end if;
  return previous;
end;
$$;

-- What tools/import-discord-showcase.mts writes, for one post. A player who already has
-- an account gets the look now; the rest at their first sign-in. One message makes one
-- look, also when two right-clicks race: the second gets the first one's id back.
create function public.import_discord_look(
  look uuid, player text, message text, player_name text, look_title text, look_code text,
  look_race text, look_tags text[], caption text, shots text[], shared_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('discord_look:' || message, 0));
  select d.outfit_id into existing from public.discord_looks d where d.message_id = message;
  if existing is not null then
    return existing;
  end if;
  insert into public.outfits (id, author_id, discord_name, title, code, race, tags, description, gallery, created_at)
    values (look,
      (select i.user_id from auth.identities i where i.provider = 'discord' and i.provider_id = player limit 1),
      player_name, look_title, look_code, look_race, look_tags, caption, shots, shared_at);
  insert into public.discord_looks (outfit_id, discord_id, message_id) values (look, player, message);
  return look;
end;
$$;

revoke execute on function
  public.discord_id_of_look(uuid),
  public.discord_creators(),
  public.discord_has_looks(text),
  public.swap_discord_role_holder(text, text),
  public.import_discord_look(uuid, text, text, text, text, text, text, text[], text, text[], timestamptz)
  from public, anon, authenticated;

grant execute on function
  public.discord_id_of_look(uuid),
  public.discord_creators(),
  public.discord_has_looks(text),
  public.swap_discord_role_holder(text, text),
  public.import_discord_look(uuid, text, text, text, text, text, text, text[], text, text[], timestamptz)
  to service_role;
