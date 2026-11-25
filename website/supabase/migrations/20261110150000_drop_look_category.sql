-- The second step of replacing an author's chosen category with what the code changes
-- (the look_categories migration). Since f92824a no deployed code writes or reads
-- category, so the column, its index, its check and its column grants go together.
drop index if exists public.outfits_category_idx;
alter table public.outfits drop column category;
