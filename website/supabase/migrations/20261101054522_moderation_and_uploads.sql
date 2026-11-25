-- Moderators, and screenshots that are only ever the site's own compressed files.

-- Added by hand: there is deliberately no way to join this list through the API.
create table public.moderators (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.moderators enable row level security;

create policy "see your own moderator row" on public.moderators for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.moderators from anon, authenticated;
grant select on public.moderators to authenticated;

-- These sit beside the delete-your-own policies: either one allows the delete.
create policy "moderators delete any outfit" on public.outfits for delete
  to authenticated
  using (exists (select 1 from public.moderators m where m.user_id = (select auth.uid())));

create policy "moderators delete any preset" on public.world_presets for delete
  to authenticated
  using (exists (select 1 from public.moderators m where m.user_id = (select auth.uid())));

-- A gallery holds storage paths in the author's own folder, never outside links.
-- A thumbnail's path has a suffix, so only the full-size file can be listed.
alter table public.outfits drop constraint outfits_gallery_https;
alter table public.outfits add constraint outfits_gallery_uploads check (
  array_to_string(gallery, E'\n')
    ~ ('^(' || author_id::text || '/[0-9a-f-]{36}\.(avif|webp)(\n|$))*$')
);

-- What the site writes (src/lib/data/compress.ts). The floor for a direct upload.
update storage.buckets
  set file_size_limit = 1048576,
      allowed_mime_types = array['image/avif', 'image/webp']
  where id = 'showcase';

-- Removing a file needs select as well as delete. Reading a public file by its
-- link goes around these policies, so this only widens what the API can list.
create policy "see your own screenshots" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "moderators see screenshots" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'showcase'
    and exists (select 1 from public.moderators m where m.user_id = (select auth.uid()))
  );

create policy "moderators delete screenshots" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'showcase'
    and exists (select 1 from public.moderators m where m.user_id = (select auth.uid()))
  );

-- 60 screenshots: each is stored as a full-size file and a thumbnail.
drop policy "upload screenshots to your own folder" on storage.objects;
create policy "upload screenshots to your own folder" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'showcase'
        and o.name like (select auth.uid())::text || '/%'
    ) < 120
  );
