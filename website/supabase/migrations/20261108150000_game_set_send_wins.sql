-- "Send to game" on a look that is already a set used to do nothing, which lost a
-- race: a player who deleted the set in game and sent it again from the site
-- before the game's next sync had their send ignored, and the game's delete then
-- removed the set everywhere. Sending it now gives the set a new revision, so a
-- delete made from the older one is refused and the set goes back to the game,
-- the way game_sync already settles any delete of a look the game has not seen.
-- Only rev and updated_at change, so the set keeps its pictures.

create or replace function public.game_set_send(p_name text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  head bigint;
  filed text;
  linked boolean;
begin
  if me is null then raise exception 'sign in first'; end if;
  head := private.game_lock(me);
  linked := exists (select 1 from public.game_links l where l.user_id = me);

  update public.game_sets s set rev = head + 1, updated_at = now()
  where s.id = (select x.id from public.game_sets x where x.user_id = me and x.code = p_code limit 1)
  returning s.name into filed;
  if found then
    update public.game_sync_heads set rev = head + 1 where user_id = me;
    return jsonb_build_object('name', filed, 'linked', linked);
  end if;

  if (select count(*) from public.game_sets s where s.user_id = me and s.code is not null) >= 300 then
    return null;
  end if;

  filed := private.game_free_name(me, p_name);
  perform private.game_put(me, filed, '', p_code, head + 1);
  update public.game_sync_heads set rev = head + 1 where user_id = me;
  return jsonb_build_object('name', filed, 'linked', linked);
end;
$$;
