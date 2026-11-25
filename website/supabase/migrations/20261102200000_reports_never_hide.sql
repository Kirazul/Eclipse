-- Reports no longer hide a look. They collect a count and reasons, and a moderator
-- either deletes the look or dismisses its reports. The hidden column, its policies
-- and restore_outfit go in a later migration, once the site no longer reads them.

create or replace function public.report_outfit(target uuid, why text) returns void
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
    where o.id = target and o.author_id <> reporter
    on conflict do nothing;
end;
$$;

-- Anything the old rule hid shows again.
update public.outfits set hidden = false where hidden;

-- A moderator keeps a reported look: its reports so far count as read.
create function public.dismiss_reports(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.moderators m where m.user_id = auth.uid()) then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  update public.outfits set reports_cleared_at = now() where id = target;
end;
$$;

revoke execute on function public.dismiss_reports(uuid) from public, anon;
grant execute on function public.dismiss_reports(uuid) to authenticated;
