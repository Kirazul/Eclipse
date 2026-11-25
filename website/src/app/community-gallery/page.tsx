import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SearchParams } from "nuqs/server";
import { Avatar } from "@/components/avatar";
import { BuiltinNotice, HubTitle, listFromSearch, NoLooks, Pager, PublishButton } from "@/components/hub";
import { OutfitPoster } from "@/components/outfit-card";
import { OutfitFilters } from "@/components/outfit-filters";
import { sizedAvatar } from "@/lib/avatar";
import { itemName } from "@/lib/catalog";
import { repository } from "@/lib/data";
import { wardrobeCache } from "@/lib/search-params";
import { localPageMetadata } from "@/lib/seo";

export function generateMetadata(): Promise<Metadata> {
  return localPageMetadata("/community-gallery");
}

/** How many matching creators a search shows above the looks. */
const PEOPLE = 6;

// Everyone's looks, yours among them. Your own are gathered on the Loadouts page.
export default async function CommunityGalleryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ posts, total, filters }, people, values] = await Promise.all([
    listFromSearch(searchParams),
    // A search also finds the people whose names match, as a social app's would.
    wardrobeCache.parse(searchParams).then((f) => (f.q.trim() && !f.saved ? repository.listCreators({ q: f.q, limit: PEOPLE }) : [])),
    repository.filterValues(),
  ]);
  const t = await getTranslations();

  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      {filters.saved ? (
        <HubTitle title={t("gallery.bookmarksTitle")} blurb={t("gallery.bookmarksBlurb")} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <HubTitle title={t("gallery.title")} blurb={t("gallery.blurb")} />
            <PublishButton />
          </div>
          <BuiltinNotice />
        </>
      )}
      {filters.author && (
        <p className="text-sm text-ink-dim">
          {t("gallery.onePerson")}{" "}
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">{t("gallery.everyone")}</Link>
        </p>
      )}
      {filters.item !== null && filters.item > 0 && (
        <p className="text-sm text-ink-dim">
          {t("gallery.wearing", { item: itemName(filters.item) ?? t("gallery.itemFallback", { id: filters.item }) })}{" "}
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">{t("gallery.everyLook")}</Link>
        </p>
      )}
      {filters.saved && (
        <p className="text-sm text-ink-dim">
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">{t("gallery.back")}</Link>
        </p>
      )}
      <OutfitFilters count={total} live={repository.live} values={values} />
      {people.length > 0 && (
        <nav aria-label={t("gallery.creators")} className="flex flex-col gap-2">
          <h2 className="font-sans text-xs tracking-[0.08em] text-ink-faint uppercase">{t("gallery.creators")}</h2>
          <ul className="flex flex-wrap gap-2">
            {people.map((c) => (
              <li key={c.id}>
                <Link href={`/creators/${c.id}`} className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-3.5 pl-1 text-sm transition-colors duration-[120ms] hover:bg-surface-raised">
                  <Avatar account={{ name: c.name, avatar: sizedAvatar(c.avatar) }} size={28} />
                  {c.name}
                  {c.verified && <BadgeCheck className="size-3.5 text-amber" strokeWidth={1.5} aria-label={t("look.verified")} />}
                  <span className="nums text-xs text-ink-faint">{t("gallery.looks", { count: c.looks })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {/* A search that found someone has not come up empty, so it does not ask for a first look. */}
      {!posts.length ? (people.length ? <p className="text-sm text-ink-dim">{t("gallery.noTitles")}</p> : <NoLooks bookmarks={filters.saved} />) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {/* The first row is the page's largest picture on any screen, so it loads at once. */}
          {posts.map((post, i) => <OutfitPoster key={post.id} post={post} eager={i < 4} />)}
        </div>
      )}
      <Pager base="/community-gallery" filters={filters} total={total} />
    </main>
  );
}
