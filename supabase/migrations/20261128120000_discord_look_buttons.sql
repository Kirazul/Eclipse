-- Upvote and Send to game from the bot's look replies in Discord (/look).
--
-- The bot has no visitor session, so these run with the secret key. Each one acts as the
-- site account the clicking Discord account signed in with: Discord signs every click, so
-- that id is trusted, as the moderators' buttons already trust it. A Discord account with
-- no site account gets null and nothing happens.
--
-- They call the site's own set_outfit_vote and game_set_send, so a vote or a sent look
-- from Discord follows exactly the rules of one from the site. Purely additive.

create function private.account_of_discord(player text) returns uuid
language sql stable security definer set search_path = '' as $$
  select i.user_id from auth.identities i
    where i.provider = 'discord' and i.provider_id = player
    limit 1;
$$;

-- auth.uid() reads the request's claims. Setting them for this transaction only makes
-- the functions below see the player's account, and nothing after the call does.
create function private.act_as(account uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', account, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', account::text, true);
end;
$$;

create function public.discord_set_outfit_vote(player text, target uuid, up boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  account uuid := private.account_of_discord(player);
begin
  if account is null then
    return null;
  end if;
  perform private.act_as(account);
  return public.set_outfit_vote(target, up);
end;
$$;

create function public.discord_game_set_send(player text, p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  account uuid := private.account_of_discord(player);
begin
  if account is null then
    return jsonb_build_object('account', false);
  end if;
  perform private.act_as(account);
  return jsonb_build_object('account', true, 'sent', public.game_set_send(p_name, p_code));
end;
$$;

revoke execute on function
  private.account_of_discord(text),
  private.act_as(uuid),
  public.discord_set_outfit_vote(text, uuid, boolean),
  public.discord_game_set_send(text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.discord_set_outfit_vote(text, uuid, boolean),
  public.discord_game_set_send(text, text, text)
  to service_role;
