-- Nothing reads or writes world_presets, but any account with a name could still add rows
-- to it, 131 KB each and as many as it liked. It is empty, and stays until a later
-- migration drops it.

drop policy if exists "publish preset as yourself" on public.world_presets;
revoke insert, update on public.world_presets from anon, authenticated;
