-- What each look changes, read from its code rather than chosen by its author, so a
-- look can only be listed under what copying its code actually gives. The site files
-- the game's own sets the same way (src/lib/codec/categories.ts), and a test runs
-- every code the game wrote through both.
--
--   Armor           a gear slot (0..18) wearing an item; item 0 hides a slot
--   Race morph      a look or rlook line
--   Creature morph  a display line with a creature
--   Cosmetics       a worn cosmetic (cosm)
--   Mounted         a ground or flying mount
--
-- Incarnations and spell visuals are not here: the overlay keeps them in their own
-- files, so no look code carries them.

-- The value of the last "<key> <n>" line, as the decoder keeps the last one.
create function private.code_last(txt text, key text) returns bigint
language sql immutable set search_path = '' as $$
  select m.v[1]::bigint
  from regexp_matches(txt, '(?:^|\n)' || key || '[ \t]+([0-9]{1,18})(?=[ \t\r\n]|$)', 'g') with ordinality as m(v, n)
  order by m.n desc
  limit 1;
$$;

create function private.code_categories(code text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  body text := regexp_replace(split_part(substr(code, 6), '~', 1), '[[:space:]=]', '', 'g');
  txt text;
  found text[] := '{}';
begin
  if left(code, 5) <> 'ECA1:' then
    return found;
  end if;
  body := body || repeat('=', (4 - length(body) % 4) % 4);
  begin
    txt := convert_from(decode(body, 'base64'), 'UTF8');
  exception when others then
    return found;
  end;

  -- Per slot the last line wins, as in the decoder.
  if exists (
    select 1 from (
      select distinct on (m.v[1]::integer) m.v[2]::bigint as item
      from regexp_matches(txt, '(?:^|\n)slot[ \t]+([0-9]{1,9})[ \t]+([0-9]{1,18})(?=[ \t\r\n]|$)', 'g') with ordinality as m(v, n)
      where m.v[1]::integer < 19
      order by m.v[1]::integer, m.n desc
    ) last where item > 0
  ) then
    found := array_append(found, 'Armor');
  end if;
  if txt ~ '(^|\n)rlook[ \t]+[^ \t\r\n]+[ \t]+[mf]([ \t\r\n]|$)'
     or txt ~ '(^|\n)look([ \t]+[0-9]+){7}([ \t\r\n]|$)' then
    found := array_append(found, 'Race morph');
  end if;
  if coalesce(private.code_last(txt, 'display'), 0) > 0 then
    found := array_append(found, 'Creature morph');
  end if;
  -- A worn piece: a target, then its 18 fields.
  if txt ~ '(^|\n)cosm[ \t]+0*[1-9][0-9]*([ \t]+[^ \t\r\n]+){18}[ \t\r]*(\n|$)' then
    found := array_append(found, 'Cosmetics');
  end if;
  if coalesce(private.code_last(txt, 'mount'), 0) > 0
     or coalesce(private.code_last(txt, 'mountfly'), 0) > 0 then
    found := array_append(found, 'Mounted');
  end if;
  return found;
end;
$$;

alter table public.outfits add column categories text[] not null default '{}';

create function private.set_outfit_categories() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.categories := private.code_categories(new.code);
  return new;
end;
$$;

-- As with items: no grant lets an author name categories, and the trigger rewrites
-- them on every write of the code.
create trigger set_outfit_categories before insert or update of code on public.outfits
  for each row execute function private.set_outfit_categories();

update public.outfits set categories = private.code_categories(code);

create index outfits_categories_idx on public.outfits using gin (categories);

-- The author's pick is no longer asked for. The column stays, optional, until no
-- deployed code writes it; a later migration drops it.
alter table public.outfits alter column category drop not null;
