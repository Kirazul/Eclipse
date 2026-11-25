-- Looks first shared in the Discord showcase, credited to the player who shared them.
-- Such a look has no site account behind it until its player signs in with Discord;
-- then it becomes theirs like any look they published. The live code reads no new
-- column, so it runs on this unchanged: it shows such a look as nobody's until the
-- code that reads discord_name ships, and nothing is imported before then.

alter table public.outfits alter column author_id drop not null;

-- The name the player had on Discord. Nothing grants it for insert or update, so only
-- the import writes it, and a published look never has one.
alter table public.outfits
  add column discord_name text check (char_length(discord_name) between 1 and 40),
  add constraint outfits_credited check (author_id is not null or discord_name is not null);

-- Who shared it, by Discord account, so the look finds its player at sign-in. Kept out
-- of the API: no policy, and nothing granted to anon or authenticated.
create table public.discord_looks (
  outfit_id uuid primary key references public.outfits (id) on delete cascade,
  discord_id text not null check (discord_id ~ '^[0-9]{17,20}$'),
  -- The showcase message the code came from, so the import adds each one once.
  message_id text not null unique check (message_id ~ '^[0-9]{17,20}$')
);
create index discord_looks_discord_idx on public.discord_looks (discord_id);
alter table public.discord_looks enable row level security;
revoke all on public.discord_looks from anon, authenticated;

-- A gallery still holds only uploads: the author's own folder, or for an imported look
-- its own discord/<look> folder, which stays valid after its player claims it. A
-- published look has no discord_name, so it can never name an imported look's files.
alter table public.outfits drop constraint outfits_gallery_uploads;
alter table public.outfits add constraint outfits_gallery_uploads check (
  array_to_string(gallery, E'\n')
    ~ ('^(('
      || concat_ws('|', author_id::text, case when discord_name is not null then 'discord/' || id::text end)
      || ')/[0-9a-f-]{36}\.(avif|webp)(\n|$))*$')
);

-- Supabase writes the profile with the user and the identity after them, so the
-- player's profile exists by the time this runs. A look that already has an author
-- keeps it.
create function public.claim_discord_looks() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'discord' then
    update public.outfits o set author_id = new.user_id
      from public.discord_looks d
      where d.outfit_id = o.id and d.discord_id = new.provider_id and o.author_id is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.claim_discord_looks() from public, anon, authenticated;

create trigger claim_discord_looks after insert on auth.identities
  for each row execute function public.claim_discord_looks();

-- `<>` is unknown against a look with no author, which refused every report on one.
-- Same function otherwise; replacing it keeps its grants.
create or replace function public.report_outfit(target uuid, why text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  reporter uuid := auth.uid();
begin
  if reporter is null then
    raise exception 'sign in to report' using errcode = '28000';
  end if;
  -- Nobody reports their own look, and one person's report counts once.
  insert into public.outfit_reports (outfit_id, user_id, reason)
    select o.id, reporter, why from public.outfits o
    where o.id = target and o.author_id is distinct from reporter
    on conflict do nothing;
  return found;
end;
$$;
