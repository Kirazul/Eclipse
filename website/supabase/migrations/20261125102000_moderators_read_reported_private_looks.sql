-- Two gaps left by private looks (20261114230000_private_looks):
--
-- 1. A moderator could not open a reported look once its author made it private, so the
--    report could not be reviewed. A moderator now reads a private look that has a report,
--    on the look or on one of its comments: what the moderation page lists.
-- 2. A private look's comments stayed readable by anyone. A comment is now read only by
--    those who can read its look.
--
-- Additive for the live code: the same queries answer the same rows for everyone except
-- a moderator, who sees reported private looks, and visitors, who no longer see the
-- comments of private looks, whose pages they cannot open anyway. It runs unchanged on this.

-- Security definer: neither kind of report is readable by every moderator's query, and
-- reading comments here, as their owner, keeps the comments rule below from looping back
-- through outfits into itself.
create function private.reported_to_moderator(look uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.moderators m where m.user_id = auth.uid())
    and (
      exists (select 1 from public.outfit_reports r where r.outfit_id = look)
      or exists (
        select 1 from public.outfit_comment_reports cr
        join public.outfit_comments c on c.id = cr.comment_id
        where c.outfit_id = look
      )
    );
$$;

revoke execute on function private.reported_to_moderator(uuid) from public, anon;
grant execute on function private.reported_to_moderator(uuid) to authenticated;

-- ORed with "public looks, and your own private ones". Only private looks reach the
-- function: everyone already reads the public ones.
create policy "moderators see reported private looks" on public.outfits for select
  to authenticated
  using (is_private and private.reported_to_moderator(id));

-- Read through outfits' own rules, so a comment is seen exactly where its look is.
drop policy "comments are public" on public.outfit_comments;
create policy "comments on looks you can see" on public.outfit_comments for select
  using (exists (select 1 from public.outfits o where o.id = outfit_id));
