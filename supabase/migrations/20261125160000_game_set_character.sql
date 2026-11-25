-- The character a set was saved on, as its game reports it in a sync's `who` line: the
-- class and race the publish form offers, because a look's code carries neither unless
-- the look changes the race. Purely additive: the live code reads neither column and
-- never calls the function, so it runs unchanged on this migration.

alter table public.game_sets
  add column class_name text check (class_name in (
    'Death Knight', 'Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior'
  )),
  add column race text check (race ~ '^[a-z]{1,20}$');

-- Called by /api/game/sync right after game_sync, with the names it acknowledged. It
-- touches only the live sets of the token's owner, and nothing for a token it does not
-- know. Nothing else writes these columns, and the code trigger does not fire for them.
create function public.game_set_character(p_token_hash text, p_names text[], p_class text, p_race text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  touched integer;
begin
  if coalesce(array_length(p_names, 1), 0) > 100 then
    raise exception 'a sync carries at most 100 changes';
  end if;
  select l.user_id into owner from public.game_links l where l.token_hash = p_token_hash;
  if not found then
    return 0;
  end if;
  update public.game_sets s set class_name = p_class, race = p_race
    where s.user_id = owner and s.code is not null
      and lower(s.name) in (select lower(n) from unnest(p_names) as n);
  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke execute on function public.game_set_character(text, text[], text, text) from public, authenticated;
grant execute on function public.game_set_character(text, text[], text, text) to anon;
