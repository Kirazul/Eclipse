-- An optional description an author writes when publishing, shown as the look's
-- caption. It replaces typed tags on the publish form; tags read from the code stay.
-- Purely additive: the live code selects named columns, so it never sees this one.

alter table public.outfits
  add column description text,
  -- As a comment's text (the look_comments migration): line breaks are fine, padding
  -- and other control characters are not.
  add constraint outfits_description_check check (
    char_length(description) between 1 and 500
    and description = btrim(description, E' \n')
    and description !~ '[\u0001-\u0009\u000b-\u001f\u007f]'
  );

grant insert (description) on public.outfits to authenticated;
