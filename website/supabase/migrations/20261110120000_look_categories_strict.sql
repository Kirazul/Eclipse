-- Cosmetics are filed only when the site's decoder would wear them (readCosmetic in
-- src/lib/codec/outfit.ts). The first version took any cosm line with 19 values, so
-- a hand-edited code could be listed under Cosmetics while wearing none.

-- JavaScript's Number(t), or null where that is not a finite number: decimals with an
-- optional sign and exponent, and unsigned 0x, 0o and 0b integers.
create function private.js_number(t text) returns double precision
language plpgsql immutable set search_path = '' as $$
declare
  v double precision := 0;
  base integer;
  digits text;
begin
  if t ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
    begin
      v := t::double precision;
    exception when others then
      return null; -- past the range of a double, which JavaScript reads as Infinity
    end;
    return v;
  end if;
  if t ~ '^0[xX][0-9a-fA-F]+$' then base := 16;
  elsif t ~ '^0[oO][0-7]+$' then base := 8;
  elsif t ~ '^0[bB][01]+$' then base := 2;
  else return null;
  end if;
  digits := lower(substr(t, 3));
  for i in 1..length(digits) loop
    v := v * base + (position(substr(digits, i, 1) in '0123456789abcdef') - 1);
  end loop;
  return v;
end;
$$;

-- A worn piece, as readCosmetic reads it: "cosm <target>" and exactly 18 numbers,
-- a catalog flag and colour flag that are whole numbers, a size above 0, one of the
-- two colour modes and a scope of 0 or 1. Lines are cut at '\n' and lose trailing
-- '\r' and spaces first, as in parseOutfit.
create function private.code_has_cosmetic(txt text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1
    from regexp_split_to_table(txt, E'\n') as raw(line),
         lateral (select regexp_split_to_array(regexp_replace(raw.line, E'[\r ]+$', ''), '\s+') as p) s
    where s.p[1] = 'cosm'
      and cardinality(s.p) = 20
      and s.p[2] ~ '^[0-9]+$' and s.p[2] ~ '[1-9]'
      and not exists (select 1 from unnest(s.p[3:20]) f where private.js_number(f) is null)
      and s.p[3] ~ '^[0-9]+$'
      and private.js_number(s.p[4]) > 0
      and s.p[11] ~ '^[0-9]+$'
      and s.p[12] ~ '^0*[01]$'
      and s.p[20] ~ '^0*[01]$'
  );
$$;

create or replace function private.code_categories(code text) returns text[]
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
  if private.code_has_cosmetic(txt) then
    found := array_append(found, 'Cosmetics');
  end if;
  if coalesce(private.code_last(txt, 'mount'), 0) > 0
     or coalesce(private.code_last(txt, 'mountfly'), 0) > 0 then
    found := array_append(found, 'Mounted');
  end if;
  return found;
end;
$$;

update public.outfits set categories = private.code_categories(code);
