-- An upvote can be taken back: the vote button sets the vote the visitor wants, on or
-- off, rather than only adding one. Saying which state is wanted, instead of flipping,
-- keeps a double click or a retried request from undoing itself.
--
-- Purely additive: the live code still calls upvote_outfit, which stays until the code
-- that calls this one has shipped.

create function public.set_outfit_vote(target uuid, up boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  voter uuid := auth.uid();
  total integer;
begin
  if voter is null then
    raise exception 'sign in to vote' using errcode = '28000';
  end if;
  if up then
    -- Only a look the voter can see: a public one, or their own private one.
    insert into public.outfit_votes (outfit_id, user_id)
      select o.id, voter from public.outfits o
      where o.id = target and (not o.is_private or o.author_id = voter)
      on conflict do nothing;
  else
    delete from public.outfit_votes where outfit_id = target and user_id = voter;
  end if;
  if found then
    -- Written with the vote, so sorting by trending stays an index scan.
    update public.outfits
      set upvotes = greatest(upvotes + case when up then 1 else -1 end, 0),
          trending_score = greatest(upvotes + case when up then 1 else -1 end, 0)
            / power(extract(epoch from now() - created_at) / 86400 + 2, 1.2)
      where id = target
      returning upvotes into total;
  else
    select o.upvotes into total from public.outfits o
      where o.id = target and (not o.is_private or o.author_id = voter);
  end if;
  return coalesce(total, 0);
end;
$$;

revoke execute on function public.set_outfit_vote(uuid, boolean) from public, anon;
grant execute on function public.set_outfit_vote(uuid, boolean) to authenticated;
