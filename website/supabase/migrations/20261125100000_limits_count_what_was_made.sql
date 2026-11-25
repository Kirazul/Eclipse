-- The publish and comment limits counted the rows still there, so publishing and deleting
-- in a loop never reached the limit, and each new look posted to the Discord feed. They
-- now count what a person made in the window, deleted or not. The limits are the same:
-- 20 looks an hour and 10 comments in ten minutes.
--
-- The live code sees only the same errcodes (EC001, EC002) it already handles, so it
-- runs unchanged on this.

-- What each person made lately, one row per look or comment, out of the API as private.*
-- is. Kept when the look or comment goes; gone with the account. Rows older than the
-- window are cleared as the person makes more, so it stays small.
create table private.recent_posts (
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('look', 'comment')),
  made_at timestamptz not null default now()
);

create index recent_posts_author_idx on private.recent_posts (author_id, kind, made_at desc);

alter table private.recent_posts enable row level security;
revoke all on private.recent_posts from public, anon, authenticated;

-- So nobody starts afresh: what the old limits would still have counted.
insert into private.recent_posts (author_id, kind, made_at)
  select author_id, 'look', created_at from public.outfits
  where author_id is not null and created_at > now() - interval '1 hour';
insert into private.recent_posts (author_id, kind, made_at)
  select author_id, 'comment', created_at from public.outfit_comments
  where created_at > now() - interval '10 minutes';

-- Security definer, to write the table no visitor can reach. Runs before the row is
-- written, in the same transaction: a look refused later, by a policy or a check,
-- takes its row here with it, so only what was really made is counted.
create or replace function public.limit_publishing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A look from the Discord showcase has no author until its player signs in.
  if new.author_id is null then
    return new;
  end if;
  delete from private.recent_posts
    where author_id = new.author_id and kind = 'look' and made_at <= now() - interval '1 hour';
  if (
    select count(*) from private.recent_posts
    where author_id = new.author_id and kind = 'look'
  ) >= 20 then
    raise exception 'too many looks this hour' using errcode = 'EC001';
  end if;
  insert into private.recent_posts (author_id, kind) values (new.author_id, 'look');
  return new;
end;
$$;

revoke execute on function public.limit_publishing() from public, anon, authenticated;

create or replace function public.limit_commenting() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.recent_posts
    where author_id = new.author_id and kind = 'comment' and made_at <= now() - interval '10 minutes';
  if (
    select count(*) from private.recent_posts
    where author_id = new.author_id and kind = 'comment'
  ) >= 10 then
    raise exception 'too many comments' using errcode = 'EC002';
  end if;
  insert into private.recent_posts (author_id, kind) values (new.author_id, 'comment');
  return new;
end;
$$;

revoke execute on function public.limit_commenting() from public, anon, authenticated;
