-- A look published from another one in the Dressing room credits the original.
-- Deleting the original leaves the remix in place, uncredited.
alter table public.outfits
  add column remixed_from uuid references public.outfits (id) on delete set null;

create index outfits_remixed_from_idx on public.outfits (remixed_from) where remixed_from is not null;

-- Added beside the existing column grants: an author names the original once, when
-- publishing, and cannot change it afterwards.
grant insert (remixed_from) on public.outfits to authenticated;
