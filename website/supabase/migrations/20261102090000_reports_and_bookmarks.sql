-- Reports, which hide a look until a moderator reviews it, and private bookmarks.

-- Three people reporting a look hides it. A moderator either deletes it or
-- restores it, and a restore only counts reports filed after it.
alter table public.outfits
  add column hidden boolean not null default false,
  add column reports_cleared_at timestamptz;

create table public.outfit_reports (
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'offensive', 'stolen', 'broken', 'other')),
  created_at timestamptz not null default now(),
  primary key (outfit_id, user_id)
);

create index outfit_reports_user_idx on public.outfit_reports (user_id);

alter table public.outfit_reports enable row level security;

create policy "see own reports" on public.outfit_reports for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "moderators see reports" on public.outfit_reports for select
  to authenticated
  using (exists (select 1 from public.moderators m where m.user_id = (select auth.uid())));

-- Written only by report_outfit, so nobody can file one in someone else's name.
revoke all on public.outfit_reports from anon, authenticated;
grant select on public.outfit_reports to authenticated;

-- A hidden look stays visible to its author and to moderators. The column grants
-- on outfits already keep authors from writing hidden or reports_cleared_at.
-- Three policies, which Postgres ORs: anon cannot read moderators, so a single
-- policy that checked it would refuse every visitor's read of every look.
drop policy "outfits are public" on public.outfits;
create policy "outfits are public" on public.outfits for select using (not hidden);
create policy "authors see their hidden looks" on public.outfits for select
  to authenticated
  using ((select auth.uid()) = author_id);
create policy "moderators see hidden looks" on public.outfits for select
  to authenticated
  using (exists (select 1 from public.moderators m where m.user_id = (select auth.uid())));

create function public.report_outfit(target uuid, why text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  reporter uuid := auth.uid();
  open_reports integer;
begin
  if reporter is null then
    raise exception 'sign in to report' using errcode = '28000';
  end if;
  -- Nobody reports their own look, and one person's report counts once.
  insert into public.outfit_reports (outfit_id, user_id, reason)
    select o.id, reporter, why from public.outfits o
    where o.id = target and o.author_id <> reporter
    on conflict do nothing;
  if found then
    select count(*) into open_reports
      from public.outfit_reports r
      join public.outfits o on o.id = r.outfit_id
      where r.outfit_id = target
        and r.created_at > coalesce(o.reports_cleared_at, '-infinity');
    if open_reports >= 3 then
      update public.outfits set hidden = true where id = target;
    end if;
  end if;
end;
$$;

revoke execute on function public.report_outfit(uuid, text) from public, anon;
grant execute on function public.report_outfit(uuid, text) to authenticated;

-- Looks with reports a moderator has not reviewed, newest report first.
create function public.moderation_queue()
returns table (outfit_id uuid, title text, hidden boolean, reports bigint, reasons text[], last_report timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  return query
    select o.id, o.title, o.hidden, count(*), array_agg(distinct r.reason), max(r.created_at)
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

-- A moderator keeps a reported look: it shows again and its reports count as read.
create function public.restore_outfit(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  update public.outfits set hidden = false, reports_cleared_at = now() where id = target;
end;
$$;

revoke execute on function public.restore_outfit(uuid) from public, anon;
grant execute on function public.restore_outfit(uuid) to authenticated;

-- Bookmarks are private: only their owner can see, add or remove them.
create table public.outfit_bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_id)
);

-- The primary key serves "my bookmarks"; this one serves the cascade on delete.
create index outfit_bookmarks_outfit_idx on public.outfit_bookmarks (outfit_id);

alter table public.outfit_bookmarks enable row level security;

create policy "see own bookmarks" on public.outfit_bookmarks for select
  to authenticated
  using ((select auth.uid()) = user_id);
create policy "add own bookmarks" on public.outfit_bookmarks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
create policy "remove own bookmarks" on public.outfit_bookmarks for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.outfit_bookmarks from anon, authenticated;
grant select, delete on public.outfit_bookmarks to authenticated;
grant insert (user_id, outfit_id) on public.outfit_bookmarks to authenticated;
