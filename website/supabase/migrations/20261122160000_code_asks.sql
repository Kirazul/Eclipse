-- "Ask for the code", the bot's right-click on a showcase picture that came without one. The
-- bot replies under the post once, which tells its player, and these two functions keep that
-- to once a week per post and five posts an hour per person.
--
-- Who asked is kept only as a fingerprint with the salt look_copies made, so the table holds
-- nobody's Discord account. Only the site's server calls these, with the secret key. Purely
-- additive.

create table private.discord_code_asks (
  message_id text primary key check (message_id ~ '^[0-9]{17,20}$'),
  asker bytea not null,
  asked_at timestamptz not null default now()
);

create index discord_code_asks_asker_idx on private.discord_code_asks (asker, asked_at);

-- 'ok' to post the request, 'asked' when one was posted this week, 'slow' when this person
-- has asked under five posts in the last hour.
create function public.discord_ask_code(p_message text, p_asker text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  print bytea;
begin
  select sha256(convert_to(s.salt || ':ask:' || p_asker, 'UTF8')) into print from private.copy_salt s;
  -- Two asks by one person at once count one after the other.
  perform pg_advisory_xact_lock(hashtextextended('discord_ask:' || p_asker, 0));
  if exists (
    select 1 from private.discord_code_asks a
    where a.message_id = p_message and a.asked_at > now() - interval '7 days'
  ) then
    return 'asked';
  end if;
  if (
    select count(*) from private.discord_code_asks a
    where a.asker = print and a.asked_at > now() - interval '1 hour'
  ) >= 5 then
    return 'slow';
  end if;
  insert into private.discord_code_asks (message_id, asker) values (p_message, print)
  on conflict (message_id) do update set asker = excluded.asker, asked_at = now()
    where private.discord_code_asks.asked_at <= now() - interval '7 days';
  return case when found then 'ok' else 'asked' end;
end;
$$;

-- For a request that could not be posted: nobody was asked.
create function public.discord_unask_code(p_message text) returns void
language sql security definer set search_path = '' as $$
  delete from private.discord_code_asks a where a.message_id = p_message;
$$;

revoke all on private.discord_code_asks from public, anon, authenticated;
revoke execute on function public.discord_ask_code(text, text), public.discord_unask_code(text)
  from public, anon, authenticated;
grant execute on function public.discord_ask_code(text, text), public.discord_unask_code(text) to service_role;
