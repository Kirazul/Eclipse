-- Which items each look wears, for "looks using this item". The database reads them
-- from the code itself, so an author cannot list their look under items it lacks.

-- The site's decoder (src/lib/codec/outfit.ts) in SQL: ECA1: then base64 of lines
-- such as "slot 0 1339122", cut at '~', whitespace and padding ignored. Item 0 hides
-- a slot, so it is not an item. A code that will not decode wears nothing.
create function private.code_items(code text) returns integer[]
language plpgsql immutable set search_path = '' as $$
declare
  body text := regexp_replace(split_part(substr(code, 6), '~', 1), '[[:space:]=]', '', 'g');
  txt text;
begin
  body := body || repeat('=', (4 - length(body) % 4) % 4);
  begin
    txt := convert_from(decode(body, 'base64'), 'UTF8');
  exception when others then
    return '{}';
  end;
  return coalesce((
    select array_agg(distinct m[2]::integer)
    from regexp_matches(txt, '(?:^|\n)slot[ \t]+([0-9]{1,9})[ \t]+([0-9]{1,9})', 'g') as m
    where m[1]::integer < 19 and m[2]::integer > 0
  ), '{}');
end;
$$;

alter table public.outfits add column items integer[] not null default '{}';

create function private.set_outfit_items() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.items := private.code_items(new.code);
  return new;
end;
$$;

-- Runs whatever the statement says: column grants keep authors from naming items
-- themselves, and the trigger overwrites the column on every write of the code.
create trigger set_outfit_items before insert or update of code on public.outfits
  for each row execute function private.set_outfit_items();

update public.outfits set items = private.code_items(code);

create index outfits_items_idx on public.outfits using gin (items);
