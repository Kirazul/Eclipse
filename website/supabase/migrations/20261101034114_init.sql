-- Eclipse Armory. Not applied anywhere yet: run with `supabase db push` once a
-- project exists. Reads are public; every write is a signed-in Discord user's own.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  -- The site validates with src/lib/codec; the cap is the database's own floor.
  code text not null check (code ilike 'ECA1:%' and char_length(code) <= 262144),
  class_name text,
  armor text check (armor in ('cloth', 'leather', 'mail', 'plate')),
  race text,
  category text not null check (category in ('Transmog', 'Retail armor', 'Race morph', 'Creature morph', 'PvP')),
  tags text[] not null default '{}' check (cardinality(tags) <= 6),
  preview_url text check (preview_url like 'https://%'),
  upvotes integer not null default 0,
  views integer not null default 0,
  trending_score real not null default 0,
  created_at timestamptz not null default now()
);

create index outfits_author_idx on public.outfits (author_id);
create index outfits_newest_idx on public.outfits (created_at desc);
create index outfits_top_idx on public.outfits (upvotes desc);
create index outfits_trending_idx on public.outfits (trending_score desc);
create index outfits_class_idx on public.outfits (class_name) where class_name is not null;
create index outfits_race_idx on public.outfits (race) where race is not null;
create index outfits_armor_idx on public.outfits (armor) where armor is not null;
create index outfits_category_idx on public.outfits (category);

create table public.outfit_votes (
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (outfit_id, user_id)
);

create index outfit_votes_user_idx on public.outfit_votes (user_id);

create table public.world_presets (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  look text not null,
  blurb text not null default '' check (char_length(blurb) <= 200),
  code text not null check (code ilike 'ECW1:%' and char_length(code) <= 131072),
  places text[] not null check (cardinality(places) between 1 and 64),
  place_group text not null,
  copies integer not null default 0,
  created_at timestamptz not null default now()
);

create index world_presets_author_idx on public.world_presets (author_id);
create index world_presets_group_idx on public.world_presets (place_group);
create index world_presets_look_idx on public.world_presets (look);
create index world_presets_copies_idx on public.world_presets (copies desc);

alter table public.profiles enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_votes enable row level security;
alter table public.world_presets enable row level security;

-- (select auth.uid()) is evaluated once per statement, not once per row.
create policy "profiles are public" on public.profiles for select using (true);
create policy "edit own profile name" on public.profiles for update
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "outfits are public" on public.outfits for select using (true);
create policy "publish as yourself" on public.outfits for insert
  with check ((select auth.uid()) = author_id);
create policy "edit own outfit" on public.outfits for update
  using ((select auth.uid()) = author_id) with check ((select auth.uid()) = author_id);
create policy "delete own outfit" on public.outfits for delete
  using ((select auth.uid()) = author_id);

create policy "see own votes" on public.outfit_votes for select
  using ((select auth.uid()) = user_id);

create policy "presets are public" on public.world_presets for select using (true);
create policy "publish preset as yourself" on public.world_presets for insert
  with check ((select auth.uid()) = author_id);
create policy "delete own preset" on public.world_presets for delete
  using ((select auth.uid()) = author_id);

-- A user may change their name and a post's text, never the counters or the
-- verified badge. Column grants enforce that; RLS only picks the rows.
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;
revoke update on public.outfits from authenticated, anon;
grant update (title, class_name, armor, race, category, tags, preview_url)
  on public.outfits to authenticated;
revoke insert on public.outfits from authenticated, anon;
grant insert (author_id, title, code, class_name, armor, race, category, tags, preview_url)
  on public.outfits to authenticated;
revoke insert, update on public.world_presets from authenticated, anon;
grant insert (author_id, title, look, blurb, code, places, place_group)
  on public.world_presets to authenticated;

-- One vote per person, written only here, so the counter cannot be set directly.
create function public.upvote_outfit(target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  voter uuid := auth.uid();
  total integer;
begin
  if voter is null then
    raise exception 'sign in to vote' using errcode = '28000';
  end if;
  insert into public.outfit_votes (outfit_id, user_id)
    values (target, voter) on conflict do nothing;
  if found then
    -- Written with the vote, so sorting by trending stays an index scan. A post
    -- nobody votes on keeps its old score, which is what falling behind means.
    update public.outfits
      set upvotes = upvotes + 1,
          trending_score = (upvotes + 1)
            / power(extract(epoch from now() - created_at) / 86400 + 2, 1.2)
      where id = target
      returning upvotes into total;
  else
    select upvotes into total from public.outfits where id = target;
  end if;
  return total;
end;
$$;

revoke execute on function public.upvote_outfit(uuid) from public, anon;
grant execute on function public.upvote_outfit(uuid) to authenticated;

-- A Discord sign-in makes its profile row, named from Discord.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name',
                                new.raw_user_meta_data ->> 'name', 'Player'), 40));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
