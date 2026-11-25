-- A new look's code is at most 32768 characters, a game set's own limit (game_sync), so
-- every new look can be sent to the game. A 262 KB code cost 53 ms on every card that
-- showed it. The site checks this first (CODE_MAX in src/lib/limits.ts); this holds for
-- every other way a look is written, the Discord bot and imports included.
--
-- Not a CHECK constraint: that is tested again on every update of the row, and a vote
-- updates it (its trending score), so looks published before with longer codes would stop
-- being votable. This looks only at a code being written. Those older looks keep showing
-- and keep their votes.
--
-- The live code already refuses nothing shorter than the old 262144 limit that it would
-- have written, and a refusal here reaches it as an ordinary failed write, so it runs
-- unchanged on this.

create function private.cap_new_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if char_length(new.code) > 32768 and (tg_op = 'INSERT' or new.code is distinct from old.code) then
    raise exception 'a look''s code is at most 32768 characters' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.cap_new_code() from public, anon, authenticated;

create trigger cap_new_code before insert or update of code on public.outfits
  for each row execute function private.cap_new_code();
