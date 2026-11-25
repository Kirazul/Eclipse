-- The cap in the last migration stopped every upload: a policy on storage.objects
-- cannot read storage.objects, and Postgres refuses it as infinite recursion
-- (42P17). The count moves into a function, which runs outside the policy.

-- Not in the API's exposed schemas, so this can only be reached from a policy.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Definer rights are what break the recursion. It only ever counts the caller's
-- own folder, so it reveals nothing about anyone else.
create function private.screenshots_stored() returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from storage.objects
  where bucket_id = 'showcase'
    and name like (select auth.uid())::text || '/%';
$$;

revoke execute on function private.screenshots_stored() from public, anon;
grant execute on function private.screenshots_stored() to authenticated;

-- 60 screenshots: each is stored as a full-size file and a thumbnail.
drop policy "upload screenshots to your own folder" on storage.objects;
create policy "upload screenshots to your own folder" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.screenshots_stored()) < 120
  );
