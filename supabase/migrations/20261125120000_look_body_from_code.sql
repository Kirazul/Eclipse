-- A look's race and body (male or female), read from its code rather than chosen by its
-- author, so the Gallery's race filter lists a look only under what copying its code
-- actually gives. Until now race was the author's pick on the publish form and the
-- import's reading of the code for Discord looks, and nothing gave a look's body.
--
-- The live code still sends a race; the trigger replaces it, so it runs on this unchanged.
-- A look whose code changes no race (armor alone) has none, as copying it gives none.
--
-- Mirrors the decoder (readLook and parseOutfit in src/lib/codec/outfit.ts) and the race
-- keys of src/lib/domain.ts, and look-body-sql.test.ts runs every code the game wrote
-- through both:
--
--   rlook <race> <m|f> ...      a retail race; the last one wins over any classic line
--   look <race> <gender> + 5    a classic body; the race byte is a ChrRaces id

-- {race key or null, 'male' | 'female'} of the look a code wears, or null when it wears none.
create function private.code_body(code text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  txt text := private.code_text(code);
  hit text[];
  race text;
begin
  if txt is null then
    return null;
  end if;
  select m.v into hit
  from regexp_matches(txt, '(?:^|\n)rlook[ \t]+([^ \t\r\n]+)[ \t]+([mf])(?=[ \t\r\n]|$)', 'g') with ordinality as m(v, n)
  order by m.n desc
  limit 1;
  if hit is not null then
    race := case when hit[1] = any (array['human', 'orc', 'dwarf', 'nightelf', 'undead', 'tauren', 'gnome', 'troll', 'goblin', 'bloodelf', 'draenei', 'worgen', 'gilnean', 'pandaren', 'nightborne', 'highmountain', 'voidelf', 'lightforged', 'zandalari', 'kultiran', 'darkiron', 'vulpera', 'maghar', 'mechagnome', 'dracthyr', 'visage', 'earthen', 'haranir', 'orcupright', 'magharupright']) then hit[1] end;
    return array[race, case hit[2] when 'f' then 'female' else 'male' end];
  end if;
  select m.v into hit
  from regexp_matches(txt, '(?:^|\n)look[ \t]+([0-9]+)[ \t]+([0-9]+)(?:[ \t]+[0-9]+){5}(?=[ \t\r\n]|$)', 'g') with ordinality as m(v, n)
  order by m.n desc
  limit 1;
  if hit is null then
    return null;
  end if;
  -- The decoder keeps the race's low byte (race & 0xff).
  race := case (hit[1]::numeric % 256)::integer
    when 1 then 'human' when 2 then 'orc' when 3 then 'dwarf' when 4 then 'nightelf'
    when 5 then 'undead' when 6 then 'tauren' when 7 then 'gnome' when 8 then 'troll'
    when 10 then 'bloodelf' when 11 then 'draenei'
  end;
  return array[race, case when hit[2]::numeric <> 0 then 'female' else 'male' end];
end;
$$;

alter table public.outfits add column sex text check (sex in ('male', 'female'));

create function private.set_outfit_body() returns trigger
language plpgsql set search_path = '' as $$
declare
  body text[] := private.code_body(new.code);
begin
  new.race := body[1];
  new.sex := body[2];
  return new;
end;
$$;

-- As with categories and tags: whatever a client writes to race or sex, the code decides.
create trigger set_outfit_body before insert or update of code, race, sex on public.outfits
  for each row execute function private.set_outfit_body();

-- Put the looks already there right. Only this trigger fires: the others watch other columns.
update public.outfits set race = race;

create index outfits_sex_idx on public.outfits (sex) where sex is not null;

-- The values the Gallery's filters can offer: those some public look has, so no choice
-- leads to an empty page. Only the values leave, never which look has them.
create function public.gallery_filter_values() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'classes', coalesce(jsonb_agg(distinct o.class_name order by o.class_name) filter (where o.class_name is not null), '[]'),
    'armor', coalesce(jsonb_agg(distinct o.armor order by o.armor) filter (where o.armor is not null), '[]'),
    'races', coalesce(jsonb_agg(distinct o.race order by o.race) filter (where o.race is not null), '[]'),
    'sexes', coalesce(jsonb_agg(distinct o.sex order by o.sex) filter (where o.sex is not null), '[]')
  )
  from public.outfits o
  where not o.is_private;
$$;

revoke execute on function public.gallery_filter_values() from public;
grant execute on function public.gallery_filter_values() to anon, authenticated;
