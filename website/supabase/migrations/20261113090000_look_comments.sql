-- Comments on a look. Anyone reads them; signed-in people with a public name write
-- them. A comment is never edited. Its writer, the look's author and moderators can
-- remove it, and anyone signed in can report it to moderators, as with looks.
-- Purely additive: the live code reads none of it.

create table public.outfit_comments (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  -- Reports filed before this were read by a moderator, who kept the comment.
  reports_cleared_at timestamptz,
  -- Line breaks are fine; other control characters only hide or garble text.
  constraint outfit_comments_body_check check (
    char_length(body) between 1 and 500
    and body = btrim(body, E' \n')
    and body !~ '[\u0001-\u0009\u000b-\u001f\u007f]'
  )
);

-- A look's comments in order, and one person's newest for the limit and the cascade.
create index outfit_comments_outfit_idx on public.outfit_comments (outfit_id, created_at);
create index outfit_comments_author_idx on public.outfit_comments (author_id, created_at desc);

alter table public.outfit_comments enable row level security;

create policy "comments are public" on public.outfit_comments for select using (true);

-- Nothing is said without a name to show beside it, as nothing is published without one.
create policy "comment as yourself" on public.outfit_comments for insert
  to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.profiles p
      where p.id = author_id and p.display_name is not null
    )
  );

-- Three policies, which Postgres ORs.
create policy "remove own comments" on public.outfit_comments for delete
  to authenticated
  using ((select auth.uid()) = author_id);
create policy "authors remove comments on their looks" on public.outfit_comments for delete
  to authenticated
  using (exists (select 1 from public.outfits o where o.id = outfit_id and o.author_id = (select auth.uid())));
create policy "moderators remove any comment" on public.outfit_comments for delete
  to authenticated
  using (exists (select 1 from public.moderators m where m.user_id = (select auth.uid())));

-- Column grants: nobody writes an id, a date or reports_cleared_at, and nobody edits.
revoke all on public.outfit_comments from anon, authenticated;
grant select (id, outfit_id, author_id, body, created_at) on public.outfit_comments to anon, authenticated;
grant insert (outfit_id, author_id, body) on public.outfit_comments to authenticated;
grant delete on public.outfit_comments to authenticated;

-- Enough for a conversation, not for a script filling a look's page.
create function public.limit_commenting() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (
    select count(*) from public.outfit_comments
    where author_id = new.author_id and created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'too many comments' using errcode = 'EC002';
  end if;
  return new;
end;
$$;

revoke execute on function public.limit_commenting() from public, anon, authenticated;

create trigger limit_commenting before insert on public.outfit_comments
  for each row execute function public.limit_commenting();

-- Reports on comments. Nobody reads this table directly: report_comment writes it and
-- comment_moderation_queue reads it, for moderators only.
create table public.outfit_comment_reports (
  comment_id uuid not null references public.outfit_comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'offensive', 'other')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index outfit_comment_reports_user_idx on public.outfit_comment_reports (user_id);

alter table public.outfit_comment_reports enable row level security;
revoke all on public.outfit_comment_reports from anon, authenticated;

-- True when this is the person's first report of the comment, so moderators hear of
-- it once. Nobody reports their own comment.
create function public.report_comment(target uuid, why text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  reporter uuid := auth.uid();
begin
  if reporter is null then
    raise exception 'sign in to report' using errcode = '28000';
  end if;
  insert into public.outfit_comment_reports (comment_id, user_id, reason)
    select c.id, reporter, why from public.outfit_comments c
    where c.id = target and c.author_id <> reporter
    on conflict do nothing;
  return found;
end;
$$;

revoke execute on function public.report_comment(uuid, text) from public, anon;
grant execute on function public.report_comment(uuid, text) to authenticated;

-- Comments with reports a moderator has not read, newest report first.
create function public.comment_moderation_queue()
returns table (
  comment_id uuid, outfit_id uuid, title text, body text, author text,
  reports bigint, reasons text[], last_report timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  return query
    select c.id, o.id, o.title, c.body, p.display_name,
           count(*), array_agg(distinct r.reason), max(r.created_at)
    from public.outfit_comment_reports r
    join public.outfit_comments c on c.id = r.comment_id
    join public.outfits o on o.id = c.outfit_id
    join public.profiles p on p.id = c.author_id
    where r.created_at > coalesce(c.reports_cleared_at, '-infinity')
    group by c.id, o.id, p.display_name
    order by max(r.created_at) desc
    limit 100;
end;
$$;

revoke execute on function public.comment_moderation_queue() from public, anon;
grant execute on function public.comment_moderation_queue() to authenticated;

-- A moderator keeps a reported comment: its reports so far count as read.
create function public.dismiss_comment_reports(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  update public.outfit_comments set reports_cleared_at = now() where id = target;
end;
$$;

revoke execute on function public.dismiss_comment_reports(uuid) from public, anon;
grant execute on function public.dismiss_comment_reports(uuid) to authenticated;
