-- A look's "mount" and "enchant" tags, which the Gallery filters by, read from its code
-- rather than sent by the client. They were worked out by the site before publishing, so a
-- direct call could claim either, and "enchant" was given to every look whose code mentions
-- a weapon's glow at all: the game writes `glow 0 0 0 0 ...` for a weapon with none, so 22
-- looks were tagged and 7 had one.
--
-- The live code still sends its own two tags; the trigger replaces them, so it runs on this
-- unchanged. Anything else an author tagged stays.

-- The code's text, as the decoder reads it (src/lib/codec/outfit.ts). Null when it will not decode.
create function private.code_text(code text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  body text := regexp_replace(split_part(substr(code, 6), '~', 1), '[[:space:]=]', '', 'g');
begin
  if left(code, 5) <> 'ECA1:' then
    return null;
  end if;
  body := body || repeat('=', (4 - length(body) % 4) % 4);
  return convert_from(decode(body, 'base64'), 'UTF8');
exception when others then
  return null;
end;
$$;

-- A hand has an enchant when its last glow line names one and says it is the look's own
-- (enchanted in src/lib/codec/outfit.ts). "glow <hand> <enchant> <managed> <tinted> <colour>".
create function private.code_has_enchant(txt text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1 from (
      select distinct on (m.v[1]::integer) m.v[2] as enchant, m.v[3] as managed
      from regexp_matches(
        txt,
        '(?:^|\n)glow[ \t]+0*([01])[ \t]+([0-9]+)[ \t]+([^ \t\r\n]+)[ \t]+[^ \t\r\n]+[ \t]+[0-9a-fA-F]{1,8}(?=[ \t\r\n]|$)',
        'g'
      ) with ordinality as m(v, n)
      order by m.v[1]::integer, m.n desc
    ) last
    where last.managed <> '0' and last.enchant ~ '[1-9]'
  );
$$;

create function private.code_tags(code text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  txt text := private.code_text(code);
  found text[] := '{}';
begin
  if txt is null then
    return found;
  end if;
  if coalesce(private.code_last(txt, 'mount'), 0) > 0
     or coalesce(private.code_last(txt, 'mountfly'), 0) > 0 then
    found := array_append(found, 'mount');
  end if;
  if private.code_has_enchant(txt) then
    found := array_append(found, 'enchant');
  end if;
  return found;
end;
$$;

create function private.set_outfit_tags() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.tags := (
    private.code_tags(new.code)
    || array(
      select u.t from unnest(new.tags) with ordinality u(t, i)
      where u.t not in ('mount', 'enchant')
      order by u.i
    )
  )[1:6];
  return new;
end;
$$;

create trigger set_outfit_tags before insert or update of code, tags on public.outfits
  for each row execute function private.set_outfit_tags();

-- Put the looks already there right.
update public.outfits set tags = tags;
