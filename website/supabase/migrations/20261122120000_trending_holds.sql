-- Trending, so an upvote can only raise a look. The score used to be votes over age to the
-- power 1.2, worked out at the moment of a vote and then left alone: a look upvoted while
-- new kept that score for good, and upvoting an old look worked it out again at its full
-- age and sank it (ten votes on day 0 scored 4.35; an eleventh on day 30 made it 0.17).
--
-- Now a vote is worth half as much a week later. Halving at a steady rate keeps any two
-- looks in the same order as time passes, so a score written once stays right: it is
-- log2(votes + 1) plus the weeks since a fixed day the look was posted. One upvote is worth
-- a week of newness, three are worth two, seven three. Looks nobody voted on list newest
-- first.
--
-- The live code reads only the column, so it runs on this unchanged.

create function private.trending(votes integer, posted timestamptz) returns real
language sql immutable set search_path = '' as $$
  select (
    ln((greatest(votes, 0) + 1)::double precision) / ln(2::double precision)
    + extract(epoch from posted - timestamptz '2026-10-01 00:00:00+00')::double precision / 604800
  )::real;
$$;

create function private.set_trending() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.trending_score := private.trending(new.upvotes, new.created_at);
  return new;
end;
$$;

-- Whatever the statement says, as with items and categories.
create trigger set_trending
  before insert or update of upvotes, created_at, trending_score on public.outfits
  for each row execute function private.set_trending();

-- The same vote, leaving the score to the trigger. Replacing it keeps its grants.
create or replace function public.set_outfit_vote(target uuid, up boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  voter uuid := auth.uid();
  total integer;
begin
  if voter is null then
    raise exception 'sign in to vote' using errcode = '28000';
  end if;
  if up then
    -- Only a look the voter can see: a public one, or their own private one.
    insert into public.outfit_votes (outfit_id, user_id)
      select o.id, voter from public.outfits o
      where o.id = target and (not o.is_private or o.author_id = voter)
      on conflict do nothing;
  else
    delete from public.outfit_votes where outfit_id = target and user_id = voter;
  end if;
  if found then
    update public.outfits
      set upvotes = greatest(upvotes + case when up then 1 else -1 end, 0)
      where id = target
      returning upvotes into total;
  else
    select o.upvotes into total from public.outfits o
      where o.id = target and (not o.is_private or o.author_id = voter);
  end if;
  return coalesce(total, 0);
end;
$$;

-- No deployed code has called this since set_outfit_vote shipped (2026-11-20), and it
-- counts votes on private looks.
drop function if exists public.upvote_outfit(uuid);

update public.outfits set trending_score = private.trending(upvotes, created_at);
