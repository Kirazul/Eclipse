-- report_outfit says whether the report is new, so moderators hear about each person's
-- report once: a second click, or a second reason from the same person, counts for
-- nothing and alerts nobody. The live code ignores the result, so it runs on this too.

drop function public.report_outfit(uuid, text);

create function public.report_outfit(target uuid, why text) returns boolean
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
  return found;
end;
$$;

revoke execute on function public.report_outfit(uuid, text) from public, anon;
grant execute on function public.report_outfit(uuid, text) to authenticated;
