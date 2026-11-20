-- Moderating from Discord. A report alert in the moderators' channel carries Keep and
-- Delete buttons. Discord signs who clicked; these functions act only when that Discord
-- account signs in to a site moderator, so the site's server can never act for anyone
-- else. Only the site's server calls them, with the secret key. Purely additive.

-- The site account a Discord account signs in to, when it is a moderator's.
create function private.moderator_of_discord(player text) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.moderators m
    join auth.identities i on i.user_id = m.user_id and i.provider = 'discord'
    where i.provider_id = player
    limit 1;
$$;

create function public.discord_is_moderator(player text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.moderator_of_discord(player) is not null;
$$;

-- Keeps a reported look or comment, as /moderation's Keep does. False when it is gone.
create function public.discord_keep_reported(player text, kind text, target uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if private.moderator_of_discord(player) is null then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if kind = 'look' then
    update public.outfits set reports_cleared_at = now() where id = target;
  elsif kind = 'comment' then
    update public.outfit_comments set reports_cleared_at = now() where id = target;
  else
    raise exception 'unknown kind %', kind using errcode = '22023';
  end if;
  return found;
end;
$$;

-- Deletes a look or comment, as /moderation's Delete does. For a look it returns the
-- screenshots to remove from storage; null when it is already gone.
create function public.discord_delete_reported(player text, kind text, target uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  shots text[];
begin
  if private.moderator_of_discord(player) is null then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if kind = 'look' then
    delete from public.outfits where id = target returning gallery into shots;
  elsif kind = 'comment' then
    delete from public.outfit_comments where id = target;
    if found then shots := '{}'; end if;
  else
    raise exception 'unknown kind %', kind using errcode = '22023';
  end if;
  return shots;
end;
$$;

revoke execute on function private.moderator_of_discord(text) from public, anon, authenticated;

revoke execute on function
  public.discord_is_moderator(text),
  public.discord_keep_reported(text, text, uuid),
  public.discord_delete_reported(text, text, uuid)
  from public, anon, authenticated;

grant execute on function
  public.discord_is_moderator(text),
  public.discord_keep_reported(text, text, uuid),
  public.discord_delete_reported(text, text, uuid)
  to service_role;
