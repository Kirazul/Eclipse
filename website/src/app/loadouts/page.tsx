import { useLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { CopyButton } from "@/components/copy-button";
import { Decoder, type RemixOf } from "@/components/decoder";
import { GameSetMenu, LinkGame, PublishReadySets, UnlinkGame } from "@/components/game-sync";
import { HubTitle } from "@/components/hub";
import { ItemRing } from "@/components/item-icon";
import { OutfitCard } from "@/components/outfit-card";
import { ScreenshotThumb } from "@/components/screenshot-thumb";
import { SignInOptions } from "@/components/sign-in-dialog";
import { ago } from "@/lib/ago";
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { getOutfit, repository } from "@/lib/data";
import type { GameLink, GameSet, OutfitList } from "@/lib/data/types";
import { VISIBLE_SLOTS } from "@/lib/domain";
import { GAME_PICTURES_MAX } from "@/lib/limits";
import { screenshotUrl } from "@/lib/screenshots";
import { localPageMetadata } from "@/lib/seo";

export function generateMetadata(): Promise<Metadata> {
  return localPageMetadata("/loadouts");
}

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
  const t = useTranslations("loadouts");
  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="import-heading" className={HEADING}>{t("import")}</h2>
        <p className="text-sm text-ink-dim">{t("importLead", { live: String(repository.live) })}</p>
      </div>
      <Decoder initial={linked} canPublish={repository.live} remixOf={remixOf} />
    </section>
  );
}

function Linked({ link, now }: { link: GameLink; now: number }) {
  const t = useTranslations("loadouts");
  const locale = useLocale();
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{link.label || t("waiting")}</p>
        <p className="text-xs text-ink-faint">
          {link.lastSyncAt
            ? t("synced", { when: ago(link.lastSyncAt, now, locale) })
            : t("linked", { when: ago(link.linkedAt, now, locale) })}
        </p>
      </div>
      <UnlinkGame id={link.id} />
    </li>
  );
}

/** A game picture's smaller copies, which the site stores beside every picture. */
function Thumb({ path, alt, className }: { path: string; alt: string; className: string }) {
  return (
    <span className={`relative block overflow-hidden rounded-md border border-line ${className}`}>
      <ScreenshotThumb src={screenshotUrl(path)} alt={alt} sizes="12rem" className="object-cover" />
    </span>
  );
}

// A game's pictures wait on their set until it is published, so a set holding any is
// one the player sent from the studio and has not finished: it leads the page.
function ReadyToPublish({ sets }: { sets: GameSet[] }) {
  const t = useTranslations("loadouts");
  // The game cannot say why a picture did not arrive, so this does.
  const full = sets.reduce((n, set) => n + set.gallery.length, 0) >= GAME_PICTURES_MAX;
  return (
    <section aria-labelledby="ready-heading" className="flex flex-col gap-3 rounded-lg border border-amber/40 bg-amber/5 p-4">
      <div>
        <h2 id="ready-heading" className="text-sm font-medium text-ink">{t("ready")}</h2>
        <p className="text-xs text-ink-dim">{t("readyLead")}</p>
        <p className="text-xs text-ink-dim">{t("readyHow")}</p>
        {full && <p className="mt-1 text-xs text-amber">{t("picturesFull", { max: GAME_PICTURES_MAX })}</p>}
      </div>
      <PublishReadySets
        rows={sets.map((set) => ({
          id: set.id,
          name: set.name,
          preview: (
            <>
              <div className="flex gap-1.5">
                {set.gallery.slice(0, 3).map((path, i) => (
                  <Thumb key={path} path={path} alt={t("pictureAlt", { name: set.name, index: i + 1 })} className="aspect-video w-24" />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{set.name}</p>
                <p className="text-xs text-ink-faint">{t("pictures", { count: set.gallery.length })}</p>
              </div>
            </>
          ),
        }))}
      />
    </section>
  );
}

function PublishedLooks({ accountId, posts, total }: { accountId: string } & OutfitList) {
  const t = useTranslations("loadouts");
  return (
    <section aria-labelledby="published-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="published-heading" className={HEADING}>{t("published")}</h2>
        {total > OWN_LOOKS && (
          <Link href={`/creators/${accountId}`} className="text-sm text-amber underline underline-offset-2">
            {t("seeAll", { count: total })}
          </Link>
        )}
      </div>
      {posts.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => <OutfitCard key={post.id} post={post} manage />)}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-dim">
          {t("noneYet")}
        </p>
      )}
    </section>
  );
}

function SetCard({ set, now }: { set: GameSet; now: number }) {
  const decoded = decodeOutfit(set.code);
  const slots = decoded.ok ? resolveOutfit(decoded.outfit).slots : [];
  const pieces = VISIBLE_SLOTS.flatMap((slot) => slots.filter((s) => s.slot === slot));
  const t = useTranslations("loadouts");
  const locale = useLocale();

  return (
    <article className="card-stroke flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:bg-surface-raised">
      <Link href={`/sets/${set.id}`} className="flex flex-1 flex-col gap-3 p-4" aria-label={t("open", { name: set.name })}>
        {set.gallery.length > 0 && <Thumb path={set.gallery[0]} alt="" className="aspect-video w-full" />}
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-serif text-lg leading-tight font-normal tracking-[-0.01em]">{set.name}</h3>
          <p className="text-xs text-ink-faint">{t("updated", { when: ago(set.updatedAt, now, locale) })}</p>
          {set.gallery.length > 0 && (
            <p className="text-xs text-ink-dim">{t("pictures", { count: set.gallery.length })}</p>
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

export default async function LoadoutsPage({ searchParams }: Props) {
  const th = await getTranslations("hub");
  const t = await getTranslations("loadouts");
  const [account, imported] = await Promise.all([repository.getAccount(), linkedCode({ searchParams })]);
  const head = (
    <>
      <HubTitle title={th("loadouts")} blurb={th("loadoutsBlurb")} />
      <Import {...imported} />
    </>
  );
  if (!account) {
    return (
      <main id="main" className="wrap flex flex-col gap-8 py-10">
        {head}
        <section aria-labelledby="sets-heading" className="flex flex-col gap-3">
          <h2 id="sets-heading" className={HEADING}>{t("yours")}</h2>
          {repository.live ? (
            <div className="flex max-w-sm flex-col gap-3">
              <p className="text-sm text-ink-dim">{t("signInNote")}</p>
              <SignInOptions />
            </div>
          ) : (
            <p className="text-sm text-ink-dim">{t("notOpen")}</p>
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
        <h2 id="games-heading" className={HEADING}>{t("games")}</h2>
        {links.length > 0 ? (
          <ul>{links.map((link) => <Linked key={link.id} link={link} now={now} />)}</ul>
        ) : (
          <p className="text-sm text-ink-dim">{t("gamesLead")}</p>
        )}
        <div className="self-start">
          <LinkGame />
        </div>
      </section>

      <PublishedLooks accountId={account.id} {...published} />

      <section aria-labelledby="sets-heading" className="flex flex-col gap-3">
        <h2 id="sets-heading" className={`${HEADING} flex items-baseline gap-2`}>
          {t("yours")} <span className="text-sm font-normal text-ink-faint">{sets.length}</span>
        </h2>
        {sets.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => <SetCard key={set.id} set={set} now={now} />)}
          </div>
        ) : (
          <p className="text-sm text-ink-dim">
            {t.rich("empty", {
              gallery: (c) => <Link href="/community-gallery" className="text-amber underline underline-offset-2">{c}</Link>,
            })}
          </p>
        )}
      </section>
    </main>
  );
}
