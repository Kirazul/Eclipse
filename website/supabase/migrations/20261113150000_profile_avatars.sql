-- A person's Discord picture beside their comments and captions, as on any social app.
-- Discord pictures are already public on Discord. Purely additive: the live code selects
-- named columns, so it never sees this one.
--
-- The picture is read from the sign-in identity (auth.identities.identity_data), which
-- only the auth server writes, and never from user metadata, which a signed-in user can
-- rewrite through the API to point at any address. It must be a Discord avatar address,
-- so a picture shown to everyone can only ever come from Discord.

alter table public.profiles
  add column avatar_url text,
  add constraint profiles_avatar_url_check check (
    avatar_url ~ '^https://cdn\.discordapp\.com/avatars/[0-9]+/(a_)?[0-9a-f]+\.(png|gif|webp|jpg)$'
  );
-- No grant: the update grant covers display_name only, so nobody can set this by hand.

-- A Discord identity's picture, or null for anything that is not one.
create function public.discord_avatar(provider text, identity_data jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when provider = 'discord'
      and identity_data ->> 'avatar_url' ~ '^https://cdn\.discordapp\.com/avatars/[0-9]+/(a_)?[0-9a-f]+\.(png|gif|webp|jpg)$'
      then identity_data ->> 'avatar_url'
  end;
$$;

-- The auth server rewrites a Discord identity's data at every sign-in, so a changed or
-- removed picture follows. A picture must never stop a sign-in.
create function public.sync_profile_avatar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'discord' then
    update public.profiles
      set avatar_url = public.discord_avatar(new.provider, new.identity_data)
      where id = new.user_id
        and avatar_url is distinct from public.discord_avatar(new.provider, new.identity_data);
  end if;
  return new;
exception
  when others then
    return new;
end;
$$;

revoke execute on function public.sync_profile_avatar() from public, anon, authenticated;

create trigger on_auth_identity_saved after insert or update of identity_data on auth.identities
  for each row execute function public.sync_profile_avatar();

-- Everyone who has signed in with Discord already.
update public.profiles p
  set avatar_url = public.discord_avatar(i.provider, i.identity_data)
  from auth.identities i
  where i.user_id = p.id and i.provider = 'discord';
