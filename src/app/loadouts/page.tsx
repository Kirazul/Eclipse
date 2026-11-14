import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { after } from "next/server";
import { CopyButton } from "@/components/copy-button";
import { Decoder, type RemixOf } from "@/components/decoder";
import { GameSetMenu, LinkGame, UnlinkGame } from "@/components/game-sync";
import { HubTitle, LOADOUTS_BLURB } from "@/components/hub";
import { ItemRing } from "@/components/item-icon";
import { OutfitCard } from "@/components/outfit-card";
import { SignInOptions } from "@/components/sign-in-dialog";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/ago";
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { getOutfit, repository } from "@/lib/data";
import type { GameLink, GameSet, OutfitList } from "@/lib/data/types";
import { VISIBLE_SLOTS } from "@/lib/domain";
import { screenshotUrl, thumbOf } from "@/lib/screenshots";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/loadouts");

type Props = { searchParams?: Promise<{ code?: string | string[]; from?: string | string[] }> };

// Above any loadout the Dressing room writes, and far below what a URL can carry.
const MAX_LINKED_CODE = 8192;

// The page's section titles, one size for all of them.
const HEADING = "text-xl font-semibold tracking-[-0.01em] text-ink";

// One row of your newest published looks; the rest are on your creator page.
const OWN_LOOKS = 3;

/** Only a player's look can be credited, published here or shared on Discord. A game set has nobody to credit. */
async function original(id: unknown): Promise<RemixOf | null> {
  if (typeof id !== "string" || !id) return null;
  const post = await getOutfit(id);
  return post && (post.authorId || post.sharedOnDiscord) ? { id: post.id, title: post.title, author: post.author } : null;
}

/** A ?code= link opens on Import, crediting the published look it came from. */
async function linkedCode({ searchParams }: Props) {
  const { code, from } = (await searchParams) ?? {};
  const linked = typeof code === "string" && code.length <= MAX_LINKED_CODE ? code : "";
  const remixOf = linked && repository.live ? await original(from) : null;
  return { linked, remixOf };
}

/** What the Inspector was on its own page: paste a code, see it, edit it, publish it. */
function Import({ linked, remixOf }: { linked: string; remixOf: RemixOf | null }) {
  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="import-heading" className={HEADING}>Import</h2>
        <p className="text-sm text-ink-dim">
          Paste an ECA1: loadout or an ECW1: world code to see what it holds
          {repository.live ? ", edit it, or publish it with your screenshots" : " and edit it"}. Use Share in the game to get one.
        </p>
      </div>
      <Decoder initial={linked} canPublish={repository.live} remixOf={remixOf} />
    </section>
  );
}

function Linked({ link, now }: { link: GameLink; now: number }) {
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{link.label || "Waiting for its first sync"}</p>
        <p className="text-xs text-ink-faint">
          {link.lastSyncAt ? `Synced ${ago(link.lastSyncAt, now)}` : `Linked ${ago(link.linkedAt, now)}`}
        </p>
      </div>
      <UnlinkGame id={link.id} />
    </li>
  );
}

const pictures = (n: number) => (n === 1 ? "1 picture" : `${n} pictures`);

/** A game picture's small copy, which the site stores beside every picture. */
function Thumb({ path, alt, className }: { path: string; alt: string; className: string }) {
  return (
    <span className={`relative block overflow-hidden rounded-md border border-line ${className}`}>
      <Image src={thumbOf(screenshotUrl(path))} alt={alt} fill unoptimized sizes="12rem" className="object-cover" />
    </span>
  );
}

// A game's pictures wait on their set until it is published, so a set holding any is
// one the player sent from the studio and has not finished: it leads the page.
function ReadyToPublish({ sets }: { sets: GameSet[] }) {
  return (
    <section aria-labelledby="ready-heading" className="flex flex-col gap-3 rounded-lg border border-amber/40 bg-amber/5 p-4">
      <div>
        <h2 id="ready-heading" className="text-sm font-medium text-ink">Ready to publish</h2>
        <p className="text-xs text-ink-dim">
          Pictures your game sent wait here, private to you, until you publish their look to the Community Gallery.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {sets.map((set) => (
          <li key={set.id} className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {set.gallery.slice(0, 3).map((path, i) => (
                <Thumb key={path} path={path} alt={`${set.name}, picture ${i + 1}`} className="aspect-video w-24" />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{set.name}</p>
              <p className="text-xs text-ink-faint">{pictures(set.gallery.length)} from your game</p>
            </div>
            <Button asChild size="sm">
              <Link href={`/sets/${set.id}`}>Publish</Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PublishedLooks({ accountId, posts, total }: { accountId: string } & OutfitList) {
  return (
    <section aria-labelledby="published-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="published-heading" className={HEADING}>Your Published Loadouts</h2>
        {total > OWN_LOOKS && (
          <Link href={`/creators/${accountId}`} className="text-sm text-amber underline underline-offset-2">
            See all {total}
          </Link>
        )}
      </div>
      {posts.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => <OutfitCard key={post.id} post={post} manage />)}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-dim">
          You haven&apos;t published a look yet. Open one of your loadouts below to publish it.
        </p>
      )}
    </section>
  );
}

function SetCard({ set, now }: { set: GameSet; now: number }) {
  const decoded = decodeOutfit(set.code);
  const slots = decoded.ok ? resolveOutfit(decoded.outfit).slots : [];
  const pieces = VISIBLE_SLOTS.flatMap((slot) => slots.filter((s) => s.slot === slot));

  return (
    <article className="card-stroke flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:bg-surface-raised">
      <Link href={`/sets/${set.id}`} className="flex flex-1 flex-col gap-3 p-4" aria-label={`Open ${set.name}`}>
        {set.gallery.length > 0 && <Thumb path={set.gallery[0]} alt="" className="aspect-video w-full" />}
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-serif text-lg leading-tight font-normal tracking-[-0.01em]">{set.name}</h3>
          <p className="text-xs text-ink-faint">Updated {ago(set.updatedAt, now)}</p>
          {set.gallery.length > 0 && (
            <p className="text-xs text-ink-dim">{pictures(set.gallery.length)} from your game</p>
          )}
        </div>
        {pieces.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {pieces.slice(0, 8).map((p) => (
              <ItemRing key={p.slot} icon={p.icon} slot={p.slot} quality={p.quality} size={52} hidden={p.item === 0} />
            ))}
          </div>
        )}
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-line p-3">
        <CopyButton code={set.code} className="ml-auto" />
        <GameSetMenu id={set.id} name={set.name} />
      </div>
    </article>
  );
}

const SIGN_IN_NOTE = "Sign in to see the loadouts saved in your game.";

export default async function LoadoutsPage({ searchParams }: Props) {
  const [account, imported] = await Promise.all([repository.getAccount(), linkedCode({ searchParams })]);
  const head = (
    <>
      <HubTitle title="Loadouts" blurb={LOADOUTS_BLURB} />
      <Import {...imported} />
    </>
  );
  if (!account) {
    return (
      <main id="main" className="wrap flex flex-col gap-8 py-10">
        {head}
        <section aria-labelledby="sets-heading" className="flex flex-col gap-3">
          <h2 id="sets-heading" className={HEADING}>Your loadouts</h2>
          {repository.live ? (
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-ink-dim">{SIGN_IN_NOTE}</p>
              <SignInOptions />
            </div>
          ) : (
            <p className="text-sm text-ink-dim">Loadouts are not open yet: the community database is not connected.</p>
          )}
        </section>
      </main>
    );
  }

  // Pictures of a look that changed or went: removed alongside this render, and awaited
  // past the response. Started here, not in an after() callback, which cannot read cookies.
  after(repository.clearOrphanPictures());
  const [links, sets, published] = await Promise.all([
    repository.listGameLinks(),
    repository.listGameSets(),
    repository.listOutfits({ sort: "newest", authorId: account.id, pageSize: OWN_LOOKS, includePrivate: true }),
  ]);
  const now = Date.now();
  const waiting = sets.filter((set) => set.gallery.length > 0);

  // Pictures waiting to be published lead the page, above its title.
  return (
    <main id="main" className="wrap flex flex-col gap-8 py-10">
      {waiting.length > 0 && <ReadyToPublish sets={waiting} />}
      {head}

      <section aria-labelledby="games-heading" className="flex max-w-xl flex-col gap-3">
        <h2 id="games-heading" className={HEADING}>Linked games</h2>
        {links.length > 0 ? (
          <ul>{links.map((link) => <Linked key={link.id} link={link} now={now} />)}</ul>
        ) : (
          <p className="text-sm text-ink-dim">
            Link your game to back up your loadouts, restore them on another PC and send looks from this site straight into the game.
          </p>
        )}
        <div className="self-start">
          <LinkGame />
        </div>
      </section>

      <PublishedLooks accountId={account.id} {...published} />

      <section aria-labelledby="sets-heading" className="flex flex-col gap-3">
        <h2 id="sets-heading" className={`${HEADING} flex items-baseline gap-2`}>
          Your loadouts <span className="text-sm font-normal text-ink-faint">{sets.length}</span>
        </h2>
        {sets.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => <SetCard key={set.id} set={set} now={now} />)}
          </div>
        ) : (
          <p className="text-sm text-ink-dim">
            Nothing here yet. Loadouts you save in a linked game appear here, and so do looks you send from the{" "}
            <Link href="/community-gallery" className="text-amber underline underline-offset-2">Community Gallery</Link>.
          </p>
        )}
      </section>
    </main>
  );
}
