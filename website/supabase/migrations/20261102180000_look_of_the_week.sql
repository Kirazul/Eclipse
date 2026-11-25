-- The home page's look of the week: the most upvotes cast in the last seven days.
-- Votes are private to their voter, so this definer function returns only the
-- winner and its count, never who voted.

create index outfit_votes_created_idx on public.outfit_votes (created_at desc);

create function public.look_of_the_week() returns table (outfit_id uuid, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.outfit_id, count(*) as votes
  from public.outfit_votes v
  join public.outfits o on o.id = v.outfit_id
  where v.created_at > now() - interval '7 days'
    and not o.hidden
  group by v.outfit_id
  -- Two votes at least: one is a single person's taste, not the week's pick.
  having count(*) >= 2
  -- A tie goes to the look that reached its count first.
  order by count(*) desc, max(v.created_at) asc
  limit 1;
$$;

revoke execute on function public.look_of_the_week() from public;
grant execute on function public.look_of_the_week() to anon, authenticated;
