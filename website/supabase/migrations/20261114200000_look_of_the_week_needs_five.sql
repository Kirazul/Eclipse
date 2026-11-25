-- Look of the Week's rule since 2026-11-14: a week counts only when the community
-- posted five looks or more in it, and the pick is the most upvoted of the looks posted
-- that week, by the upvotes they drew in it. A look needs one upvote at least: with none,
-- nothing was liked and nobody is picked.
--
-- Posted means published by a player, or shared on Discord and imported (its time is the
-- Discord post's). The game's own sets have neither an author nor a Discord row, and
-- never count.
--
-- Same name, arguments and result as before, so the live site reads it unchanged.
create or replace function public.look_of_the_week() returns table (outfit_id uuid, votes bigint)
language sql stable security definer set search_path = '' as $$
  with posted as (
    select o.id from public.outfits o
    where o.created_at > now() - interval '7 days'
      and (o.author_id is not null
           or exists (select 1 from public.discord_looks d where d.outfit_id = o.id))
  )
  select v.outfit_id, count(*) as votes
  from public.outfit_votes v
  join posted p on p.id = v.outfit_id
  where v.created_at > now() - interval '7 days'
    and (select count(*) from posted) >= 5
  group by v.outfit_id
  -- A tie goes to the look that reached its count first.
  order by count(*) desc, max(v.created_at) asc
  limit 1;
$$;

revoke execute on function public.look_of_the_week() from public;
grant execute on function public.look_of_the_week() to anon, authenticated;
