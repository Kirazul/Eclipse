import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { SearchParams } from "nuqs/server";
import { Avatar } from "@/components/avatar";
import { BuiltinNotice, HubTitle, listFromSearch, NoLooks, Pager, PublishButton } from "@/components/hub";
import { OutfitPoster } from "@/components/outfit-card";
import { OutfitFilters } from "@/components/outfit-filters";
import { sizedAvatar } from "@/lib/avatar";
import { itemName } from "@/lib/catalog";
import { repository } from "@/lib/data";
import { wardrobeCache } from "@/lib/search-params";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/community-gallery");

/** How many matching creators a search shows above the looks. */
const PEOPLE = 6;

// Everyone's looks, yours among them. Your own are gathered on the Loadouts page.
export default async function CommunityGalleryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ posts, total, filters }, people] = await Promise.all([
    listFromSearch(searchParams),
    // A search also finds the people whose names match, as a social app's would.
    wardrobeCache.parse(searchParams).then((f) => (f.q.trim() && !f.saved ? repository.listCreators({ q: f.q, limit: PEOPLE }) : [])),
  ]);

  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      {filters.saved ? (
        <HubTitle title="Bookmarks" blurb="The looks you bookmarked, which only you can see. Copy a code here and use Import on the Loadout page to wear it." />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <HubTitle title="Community Gallery" blurb="Loadouts the Eclipse community has published from their games. Find one you like, copy its code, and use Import on the Loadout page to wear it." />
            <PublishButton />
          </div>
          <BuiltinNotice />
        </>
      )}
      {filters.author && (
        <p className="text-sm text-ink-dim">
          Showing one person&apos;s looks.{" "}
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">Show everyone&apos;s</Link>
        </p>
      )}
      {filters.item !== null && filters.item > 0 && (
        <p className="text-sm text-ink-dim">
          Showing looks that wear {itemName(filters.item) ?? `item ${filters.item}`}.{" "}
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">Show every look</Link>
        </p>
      )}
      {filters.saved && (
        <p className="text-sm text-ink-dim">
          <Link href="/community-gallery" className="text-amber underline underline-offset-2">Back to the Community Gallery</Link>
        </p>
      )}
      <OutfitFilters count={total} live={repository.live} />
      {people.length > 0 && (
        <nav aria-label="Creators" className="flex flex-col gap-2">
          <h2 className="font-sans text-xs tracking-[0.08em] text-ink-faint uppercase">Creators</h2>
          <ul className="flex flex-wrap gap-2">
            {people.map((c) => (
              <li key={c.id}>
                <Link href={`/creators/${c.id}`} className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-3.5 pl-1 text-sm transition-colors duration-[120ms] hover:bg-surface-raised">
                  <Avatar account={{ name: c.name, avatar: sizedAvatar(c.avatar) }} size={28} />
                  {c.name}
                  {c.verified && <BadgeCheck className="size-3.5 text-amber" strokeWidth={1.5} aria-label="Verified" />}
                  <span className="nums text-xs text-ink-faint">{c.looks} {c.looks === 1 ? "look" : "looks"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {/* A search that found someone has not come up empty, so it does not ask for a first look. */}
      {!posts.length ? (people.length ? <p className="text-sm text-ink-dim">No look titles match that search.</p> : <NoLooks bookmarks={filters.saved} />) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {posts.map((post) => <OutfitPoster key={post.id} post={post} />)}
        </div>
      )}
      <Pager base="/community-gallery" filters={filters} total={total} />
    </main>
  );
}
