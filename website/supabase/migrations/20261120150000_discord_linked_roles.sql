-- Discord Linked Roles: a player connects their Discord to Eclipse once, and the server
-- can then grant roles such as "10 looks published" from what the site recorded. To
-- keep those numbers current, the site holds the player's Discord token for this app.
-- Its scope is role_connections.write and identify only: it can set this app's role
-- data for that player and read their Discord name, nothing else. The table lives in
-- private.*, out of the API; only the site's server reaches it, through the functions
-- below, with the secret key. Purely additive.

create table private.discord_role_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discord_id text not null unique check (discord_id ~ '^[0-9]{17,20}$'),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- What a player's roles are judged on: their public looks and the upvotes those earned,
-- as their profile counts them.
create function private.linked_role_stats(account uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'looks', count(*),
    'upvotes', coalesce(sum(o.upvotes), 0),
    'name', (select p.display_name from public.profiles p where p.id = account)
  )
  from public.outfits o
  where o.author_id = account and not o.is_private;
$$;

-- Keeps a player's connection, found by the Discord account they signed in to the site
-- with. Null when no site account signs in with it: there is nothing to judge yet.
create function public.discord_link_save(player text, access text, refresh text, expires timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  account uuid;
begin
  select i.user_id into account from auth.identities i
    where i.provider = 'discord' and i.provider_id = player limit 1;
  if account is null then
    return null;
  end if;
  insert into private.discord_role_connections (user_id, discord_id, access_token, refresh_token, expires_at)
    values (account, player, access, refresh, expires)
    on conflict (user_id) do update set
      discord_id = excluded.discord_id, access_token = excluded.access_token,
      refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, updated_at = now();
  return private.linked_role_stats(account);
end;
$$;

-- Every connection with its current numbers, for the scheduled refresh.
create function public.discord_links() returns table (
  discord_id text, access_token text, refresh_token text, expires_at timestamptz, stats jsonb
)
language sql stable security definer set search_path = '' as $$
  select c.discord_id, c.access_token, c.refresh_token, c.expires_at, private.linked_role_stats(c.user_id)
  from private.discord_role_connections c;
$$;

-- A refreshed token replaces the old one.
create function public.discord_link_tokens(player text, access text, refresh text, expires timestamptz) returns void
language sql security definer set search_path = '' as $$
  update private.discord_role_connections
    set access_token = access, refresh_token = refresh, expires_at = expires, updated_at = now()
    where discord_id = player;
$$;

-- A connection Discord no longer honours (the player removed it there) is forgotten.
create function public.discord_link_forget(player text) returns void
language sql security definer set search_path = '' as $$
  delete from private.discord_role_connections where discord_id = player;
$$;

revoke execute on function private.linked_role_stats(uuid) from public, anon, authenticated;

revoke execute on function
  public.discord_link_save(text, text, text, timestamptz),
  public.discord_links(),
  public.discord_link_tokens(text, text, text, timestamptz),
  public.discord_link_forget(text)
  from public, anon, authenticated;

grant execute on function
  public.discord_link_save(text, text, text, timestamptz),
  public.discord_links(),
  public.discord_link_tokens(text, text, text, timestamptz),
  public.discord_link_forget(text)
  to service_role;
