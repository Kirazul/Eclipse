-- Showcase screenshots and the Wardrobe's categories. Not applied anywhere yet:
-- run with `supabase db push` once a project exists, after 0001_init.sql.

-- A post can hold several captures, the cover first. preview_url becomes the
-- first of them, so nothing published before this is lost.
alter table public.outfits
  add column gallery text[] not null default '{}'
    check (cardinality(gallery) <= 6);

update public.outfits set gallery = array[preview_url] where preview_url is not null;

alter table public.outfits drop column preview_url;

-- Retail armor and PvP become Armor with a tag, as the site now shows them.
alter table public.outfits drop constraint outfits_category_check;

update public.outfits set tags = array_append(tags, 'retail')
  where category = 'Retail armor' and cardinality(tags) < 6;
update public.outfits set tags = array_append(tags, 'pvp')
  where category = 'PvP' and cardinality(tags) < 6;
update public.outfits set category = 'Armor'
  where category in ('Transmog', 'Retail armor', 'PvP');

alter table public.outfits add constraint outfits_category_check check (category in (
  'Armor', 'Race morph', 'Creature morph', 'Incarnations', 'Spell visuals', '3D effects'
));

-- The Mounts and Enchants filters look inside tags.
create index outfits_tags_idx on public.outfits using gin (tags);

-- The column grants are per-column, so the new column needs its own.
revoke update on public.outfits from authenticated, anon;
grant update (title, class_name, armor, race, category, tags, gallery)
  on public.outfits to authenticated;
revoke insert on public.outfits from authenticated, anon;
grant insert (author_id, title, code, class_name, armor, race, category, tags, gallery)
  on public.outfits to authenticated;

-- Screenshots. Public to read; each user writes only under a folder named for
-- their own id, which is the path the site uploads to (src/lib/data/supabase.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('showcase', 'showcase', true, 4194304, array['image/png', 'image/jpeg', 'image/webp']);

create policy "upload screenshots to your own folder" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "delete your own screenshots" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'showcase'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
