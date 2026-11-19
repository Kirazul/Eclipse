-- How many visitors copied a look's code, shown on its Gallery card. One count per
-- visitor per look, ever: copying again changes nothing.
--
-- A visitor is the site server's view of their IP address and browser, which the
-- visitor cannot set. Only the server records a copy, with the secret key, so nobody can
-- call this from the public API with made-up visitors. What is kept is a fingerprint:
-- sha256 of a salt, the look and the visitor. The salt is made here, by the database, and
-- never leaves it, so the fingerprint cannot be traced back to an address.
--
-- Purely additive: the live code reads no new column, so it runs unchanged on this.

-- Counted only by record_copy below: clients hold no update grant on outfits' columns
-- beyond the ones granted by name in earlier migrations.
alter table public.outfits add column copies integer not null default 0;

-- One row, out of the API, as private.* is.
create table private.copy_salt (
  only_row boolean primary key default true check (only_row),
  salt text not null
);
insert into private.copy_salt (salt) values (gen_random_uuid()::text || gen_random_uuid()::text);

create table private.outfit_copies (
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  visitor bytea not null,
  primary key (outfit_id, visitor)
);

-- Counts a copy of a public look, once per visitor. A private look, or one that is not
-- there, counts nothing and raises nothing: a copy is never worth an error.
create function public.record_copy(look uuid, visitor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.outfit_copies (outfit_id, visitor)
    select o.id, sha256(convert_to(s.salt || ':' || look::text || ':' || visitor, 'UTF8'))
    from public.outfits o, private.copy_salt s
    where o.id = look and not o.is_private
    on conflict do nothing;
  if found then
    update public.outfits set copies = copies + 1 where id = look;
  end if;
end;
$$;

revoke execute on function public.record_copy(uuid, text) from public, anon, authenticated;
grant execute on function public.record_copy(uuid, text) to service_role;
