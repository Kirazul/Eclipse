-- The second half of 20261102200000_reports_never_hide: the site no longer reads
-- hidden or calls restore_outfit, so they go. Looks are public again by one rule.

drop function public.restore_outfit(uuid);

drop policy "authors see their hidden looks" on public.outfits;
drop policy "moderators see hidden looks" on public.outfits;
drop policy "outfits are public" on public.outfits;
create policy "outfits are public" on public.outfits for select using (true);

-- Function bodies are not tracked as dependencies, so both are redefined before the
-- column goes, or they would fail at their next call rather than here.
drop function public.moderation_queue();
create function public.moderation_queue()
returns table (outfit_id uuid, title text, reports bigint, reasons text[], last_report timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  return query
    select o.id, o.title, count(*), array_agg(distinct r.reason), max(r.created_at)
    from public.outfit_reports r
    join public.outfits o on o.id = r.outfit_id
    where r.created_at > coalesce(o.reports_cleared_at, '-infinity')
    group by o.id
    order by max(r.created_at) desc
    limit 100;
end;
$$;

revoke execute on function public.moderation_queue() from public, anon;
grant execute on function public.moderation_queue() to authenticated;

create or replace function public.look_of_the_week() returns table (outfit_id uuid, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.outfit_id, count(*) as votes
  from public.outfit_votes v
  where v.created_at > now() - interval '7 days'
  group by v.outfit_id
  -- Two votes at least: one is a single person's taste, not the week's pick.
  having count(*) >= 2
  -- A tie goes to the look that reached its count first.
  order by count(*) desc, max(v.created_at) asc
  limit 1;
$$;

alter table public.outfits drop column hidden;
