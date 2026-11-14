-- One public look per code. The same look published on the site and then added from its
-- Discord post, or someone else's look reposted, used to show twice in the Community
-- Gallery. Now a second public look with a code already public is refused, and the
-- refusal names the look already there (errcode EC003, its id in the detail).
--
-- Private looks are not counted: an author may keep a private copy, and a look set
-- private frees its code. Setting a look public again is checked like a new one.
--
-- Looks published before this rule are left alone: one pair already shares a code, and
-- the rule fires only on an insert or on a change to the code or to is_private, so editing
-- either look still works. The live code reads nothing new, so it runs unchanged on this
-- migration; it only gains a clearer message once the code that maps EC003 ships.

create function public.one_public_look_per_code() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  other uuid;
begin
  if new.is_private then
    return new;
  end if;
  -- A public look whose code stays the same: nothing new appears in the Gallery.
  if tg_op = 'UPDATE' and not old.is_private and old.code = new.code then
    return new;
  end if;
  -- Two looks with the same code published at once: the second waits for the first.
  perform pg_advisory_xact_lock(hashtextextended('look_code:' || new.code, 0));
  select o.id into other from public.outfits o
    where o.code = new.code and not o.is_private and o.id <> new.id
    order by o.created_at
    limit 1;
  if other is not null then
    raise exception 'this look is already in the Community Gallery'
      using errcode = 'EC003', detail = other::text;
  end if;
  return new;
end;
$$;

create trigger one_public_look_per_code
  before insert or update of code, is_private on public.outfits
  for each row execute function public.one_public_look_per_code();

-- Same as 20261114090000_discord_bot_bridge, plus: a code already public gets that look's
-- id back, as a message already added does, and nothing is written. The bot then answers
-- with a link to it. No discord_looks row is written either, so the post never hands
-- someone else's look to its poster.
create or replace function public.import_discord_look(
  look uuid, player text, message text, player_name text, look_title text, look_code text,
  look_race text, look_tags text[], caption text, shots text[], shared_at timestamptz
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('discord_look:' || message, 0));
  select d.outfit_id into existing from public.discord_looks d where d.message_id = message;
  if existing is not null then
    return existing;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('look_code:' || look_code, 0));
  select o.id into existing from public.outfits o
    where o.code = look_code and not o.is_private
    order by o.created_at
    limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.outfits (id, author_id, discord_name, title, code, race, tags, description, gallery, created_at)
    values (look,
      (select i.user_id from auth.identities i where i.provider = 'discord' and i.provider_id = player limit 1),
      player_name, look_title, look_code, look_race, look_tags, caption, shots, shared_at);
  insert into public.discord_looks (outfit_id, discord_id, message_id) values (look, player, message);
  return look;
end;
$$;
