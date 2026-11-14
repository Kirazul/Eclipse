-- A published look can be set private by its author, and public again, from its page.
-- Private: only its author sees it. Nothing else about it changes: it keeps its date,
-- votes, comments and bookmarks, so a look made public again stands where it would have
-- stood, not on top as a new one, and toggling cannot be used to bump a look.
--
-- The live code reads no new column and every look starts public, so the site runs
-- unchanged on this migration until the code that offers the button ships.

alter table public.outfits add column is_private boolean not null default false;

-- Public looks for everyone; private ones for their author alone.
drop policy "outfits are public" on public.outfits;
create policy "public looks, and your own private ones" on public.outfits for select
  using (not is_private or (select auth.uid()) = author_id);

-- "edit own outfit" already limits updates to the author; the column needs its grant.
grant update (is_private) on public.outfits to authenticated;

-- Look of the Week counts only what the community can see. Same rule as
-- 20261114200000_look_of_the_week_needs_five, with private looks left out.
create or replace function public.look_of_the_week() returns table (outfit_id uuid, votes bigint)
language sql stable security definer set search_path = '' as $$
  with posted as (
    select o.id from public.outfits o
    where o.created_at > now() - interval '7 days'
      and not o.is_private
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

-- Wardrobe Creator means a look others can see: a player whose looks are all private
-- has none on the Community Gallery.
create or replace function public.discord_creators() returns setof text
language sql stable security definer set search_path = '' as $$
  select i.provider_id from auth.identities i
    where i.provider = 'discord'
      and exists (select 1 from public.outfits o where o.author_id = i.user_id and not o.is_private)
  union
  select d.discord_id from public.discord_looks d
    join public.outfits o on o.id = d.outfit_id
    where not o.is_private;
$$;
