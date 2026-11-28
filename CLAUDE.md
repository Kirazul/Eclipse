# Eclipse Web

The official site for the Eclipse overlay: landing page, the Community Gallery (the Wardrobe until 2026-11-14), Loadouts, the Dressing room and game sync. It replaced `kirazul.github.io/Eclipse`, so nothing here may depend on that host.

This repo is public. Keep secrets, project IDs and personal details out of commits and this file.

`.notes/` holds local notes (product intent in `GOALS.md`, open work in `TASKS.md`, past prompts), linked in from the private dev-notes repo and excluded from git. The index below loads every session; open a note only when the task needs it. Notes can lag the code, so confirm a claim against the code before acting on it.

@.notes/README.md

## Verify

A change is done when all four pass:

```bash
pnpm test
pnpm typecheck
pnpm exec eslint src
NEXT_DIST_DIR=.next-build pnpm build   # then delete .next-build
```

Always set `NEXT_DIST_DIR` for a build, and run only one Next server in this repo. A bare build or a second `next dev` shares `.next` with a running dev server and leaves it returning 500.

## Ship

Production is `eclipsewow.vercel.app`, and every push to `main` deploys it. `eclipse-web.vercel.app` is a stranger's site. Any domain we add stays free of personal names.

`dev` is the last known-good `main`, kept as the backup. It moves only to commits `main` already has, so it never receives its own commits. Updates run in this order:

1. Branch from `main` and open the PR into `main`.
2. Before merging, confirm `dev` equals `origin/main`.
3. Merge, with seolyam's go-ahead for that specific merge.
4. Verify live: the Vercel status is `success`, the changed routes answer on production, and the changed behaviour works in a real browser. A green build alone proves only that it built.
5. Healthy: fast-forward with `git push origin main:dev`. A rejected push means `dev` diverged, so stop and find out why.
6. Broken: leave `dev` alone. Roll production back in Vercel if the site is down, then restore `main` with `git revert -m 1 <merge>`.

Preview deployments sit behind protection, so test them with `vercel curl <path> --deployment <url>`.

Commit subjects are `feat:`, `fix:` or `perf:` plus a plain sentence about the visitor-facing result.

`.github/workflows/mirror.yml` copies `main` into `Kirazul/Eclipse` under `website/` with every commit, once the `MIRROR_TOKEN` secret is set. Work, issues and PRs stay here. Nobody edits `website/` there, or the next sync conflicts.

## Ask seolyam first

- Pushing or merging to `main`.
- Applying migrations to the production database.
- Changing environment variables.
- Force-pushing or deleting branches.
- Anything billed.
- Changes that multiply reads from the pack host. It runs on Kirazul's free tier, not ours.

## Tools

Use the CLIs: `pnpm exec supabase` and the global `vercel`. Reach for an MCP only for Supabase auth logs, which the CLI cannot read. Migrations are written in `supabase/migrations/` and applied with `pnpm exec supabase db push`, so the database history matches the repo.

- **Migration before code:** apply a migration before merging code that reads what it adds, and write it so the live code still runs on it. Removing something takes two steps: first ship code that stops reading it, then drop it. The local dev server uses the production database, so it breaks the same way production would.

## Site content

- **Authentic art:** WoW classes, races, items, spells and slots use real WoW or Eclipse assets. Lucide is for site controls only. If no authentic asset exists, stop and ask.
- **Real data:** show only what was recorded. With nothing recorded, the site shows nothing or the neutral real asset, even for examples.
- **Vague about infrastructure:** visitor-facing text says "service providers" and "our hosting provider". It leaves out vendors, server locations and build details. Services visitors can already see, such as Discord and YouTube, may be named.
- **Narcissus art:** used by agreement under CC BY-NC-SA 4.0. Keep the credit wherever it appears and keep Eclipse non-commercial. Use its art only, never its code.

## Code traps

- **sharp** is pinned to 0.34.5 with a pnpm override, because 0.35 builds fine and then fails to load on Vercel. Raising it needs a real screenshot upload on production as proof. Keep it lazily imported in `src/lib/data/compress.ts`; a top-level import took every data page down.
- **Data layer:** `src/lib/data/index.ts` uses Supabase when configured and `builtin.ts` otherwise, so a clone runs with no setup. Builtin refuses writes.
- **Untrusted data comes from the database:** what a look wears (`outfits.items`), what it changes (`outfits.categories`, mirrored in `src/lib/codec/categories.ts`), its `mount` and `enchant` tags and its trending score are written by triggers, never by the client. Derive anything that filters or ranks other people's content the same way.
- **Looks from the Discord showcase:** `tools/import-discord-showcase.mts` brings them in with no account (`author_id` null, `discord_name` set, `sharedOnDiscord` in code) until the player signs in with Discord and a trigger hands them over. A null `authorId` alone means one of the game's own sets, so gate community features on `authorId || sharedOnDiscord`. The bot's "Add to Community Gallery" right-click does the same for one post, through `src/lib/showcase-post.ts`, which both share. "Ask for the code" is for pictures posted without one: the bot replies under the post (the only message that pings anyone, and only that post's player), and the code its player enters adds the look (`ask-code.ts`, limits in `20261122160000_code_asks.sql`).
- **The secret key:** `SUPABASE_SECRET_KEY` skips every row rule. Only `src/lib/data/admin.ts` reads it, for the Discord bot, which has no visitor session. Keep that module narrow. A visitor's request may reach it only to read who owns a look or to update roles after the site's own checks have passed, as publishing and deleting do. The Keep and Delete buttons on report alerts in the moderators' Discord channel also write through it, via functions that check in the database that the clicking Discord account is a site moderator's (`20261120120000_discord_moderation.sql`). The daily `/api/cron/sweep-pictures` uses it to remove the files of game pictures that nothing shows any more, from a list the database makes. It never writes on a visitor's say-so, with one exception: `recordCopy` adds a copy of a public look to its count, once per visitor, keyed by the address the host reports (`src/lib/visitor.ts`), never by anything the visitor sends.
- **A look is one page:** `/community-gallery/[id]`, with no drawer or intercepted route; Back keeps the Gallery's filters and scroll. `/wardrobe` and `/wardrobe/[id]` redirect there permanently, because their links are already in Discord. It opens on the game's screenshots, and the 3D figure loads only from its "Show 3D preview" button, so opening a look reads nothing from the pack host.
- **Weekly Discord post:** `vercel.json` runs `/api/cron/look-of-the-week` on Mondays. It needs `CRON_SECRET` and `DISCORD_WEBHOOK_URL` in production, posts only when a look has earned it, and never pings anyone. The same run moves the Look of the Week role and hands Gallery Creator to everyone with a look (`src/lib/discord-roles.ts`), which needs the bot token, server id and both role ids.
- **Page views** are counted on production only, through `src/components/site-analytics.tsx`, with the query cut off by `countedAddress`. The plan has no custom events, and `/privacy` says exactly what is counted, so change both together.
- **Discord Linked Roles:** a player connects at `/api/discord/linked-roles`, and the server's Linked Roles judge them on their public looks and upvotes (`src/lib/linked-roles.ts`, fields in `src/lib/discord-linked-roles.json`). The site keeps each connected player's Discord token, scoped to `role_connections.write identify`, in `private.discord_role_connections`, reached only through `admin.ts`. `/api/cron/linked-roles` pushes the numbers daily. It stays off until `DISCORD_CLIENT_SECRET` is set; then add the callback to the app's OAuth2 redirects and run `tools/register-discord-linked-roles.mjs`.
- **Sign-in** is Discord only. A sign-in that seems to do nothing is usually an address missing from Supabase's Redirect URLs, which silently falls back to the Site URL. Check `auth.users.last_sign_in_at` first, then the auth logs.
- **Testing signed-in UI:** email login is off, so no test session exists. Drive a browser against the dev server with a fake `sb-test-auth-token` cookie and a stubbed `/api/account`. A real OAuth round trip needs seolyam.

## The overlay

`F:\projects\dev\Eclipse-DEV` is the reference for UI, UX and colour; check how the overlay does something before designing it here. Treat it as read-only, and keep its source and build output, including `dinput8.dll`, out of this repo. Downloads link to `Kirazul/Eclipse` releases.

- **DLL releases:** each DLL is one release on `Kirazul/Eclipse`, its tag `vX.Y.Z` the version the DLL reports (`src/eclipse.rc` and `kBuildText` in `Multi.cpp`), its file named `dinput8.dll`, the Warden build rather than NoWarden, with its SHA-256 in the notes. The Download panel lists them (`src/lib/releases.ts`), `/dinput8.dll` redirects to the newest, and the newest tag is what `/api/game/version` tells the game, so never tag above what the build reports. The DLL itself is never committed here.

- **Game sync wire:** `src/lib/game-sync/wire.ts` and the overlay's `SiteSyncCore.h` must change together.
- **Merged is not released:** before assuming players have the game side, check for a public overlay release.

## Dressing room

3D figures, mounts and their animations come from Eclipse-Viewer. `packages/engine` and `packages/format` are vendored from `Kirazul/Eclipse-Viewer`, and `packages/README.md` records the commit and the local changes to reapply on every sync. They draw packs that the viewer's bake publishes to its own storage (`src/lib/viewer/pack.ts`). This site hosts no game files and proxies nothing.

- **Pack host:** `R2.publicBase` in `packages/format/src/config.ts`. The r2.dev address is rate-limited and has no edge cache, so when the viewer moves to a custom domain, change that one value.
- **Items:** each catalogue item is drawn by its baked retail display (`src/data/catalog/displays.json`), not its item id: the packs list one item per model. Names come from the overlay's own table (`src/eclipse/generated/item_names.bin`) through `tools/export_item_names.py`, run after `tools/export_catalog.py`. Rebuild the display table with `node tools/export_item_displays.mjs` after a sync, a new bake or a catalogue refresh. An item with no baked display is listed under "Not in the preview"; in November 2026 that was about a fifth of the catalogue.
- **Engine files:** the Basis transcoder (`/basis`) and GPU tables (`/gpu`) are copied from `node_modules` by `tools/copy-engine-assets.mjs` before `dev` and `build`. They are gitignored and kept out of the middleware.
- **One figure per page:** the engine's stores (`$look`, `$clips`, `$manifest`) are module-wide, and `$engine` in `src/lib/viewer/state.ts` holds the one engine on the page.
- **Codes:** `src/lib/codec/golden/fields.json` holds codes the game's C++ wrote and read back. The codec must keep writing exactly what it wrote.
- **Retail races:** a retail race or a changed appearance is written as an `rlook` line, with the classic body a player without the race pack wears written under it (`CLASSIC_FALLBACK`).
- **Wowhead's viewer:** its CDN refuses this site, so respect that and stay on the viewer's packs, with no proxy or referrer workaround.
