import { BadgeCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { SearchParams } from "nuqs/server";
import { Pager } from "@/components/hub";
import { OutfitCard } from "@/components/outfit-card";
import { repository } from "@/lib/data";
import { wardrobeCache } from "@/lib/search-params";
import { OPEN_GRAPH } from "@/lib/site";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

// One lookup per request, shared by the page and its metadata.
const getCreator = cache((id: string) => repository.getCreator(id));

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const creator = await getCreator((await params).id);
  if (!creator) return { title: "Creator" };
  const title = `${creator.name}'s looks`;
  const description = `${plural(creator.looks, "look")} by ${creator.name} for World of Warcraft 3.3.5a. Copy any of them and wear it with Eclipse.`;
  const url = `/creators/${creator.id}`;
  return { title, description, alternates: { canonical: url }, openGraph: { ...OPEN_GRAPH, title, description, url } };
}

export default async function CreatorPage({ params, searchParams }: Props) {
  const creator = await getCreator((await params).id);
  if (!creator) notFound();
  const filters = await wardrobeCache.parse(searchParams);
  const { posts, total } = await repository.listOutfits({ authorId: creator.id, sort: filters.sort, page: filters.page, includePrivate: true });
  const joined = new Date(creator.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl leading-tight">
          {creator.name}
          {creator.verified && <BadgeCheck className="size-5 text-amber" strokeWidth={1.5} aria-label="Verified" />}
        </h1>
        <p className="nums text-sm text-ink-dim">
          {plural(creator.looks, "look")} · {plural(creator.upvotes, "upvote")} · Joined {joined}
        </p>
      </div>
      {posts.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => <OutfitCard key={post.id} post={post} />)}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-dim">
          {creator.name} has not published a look yet.
        </p>
      )}
      <Pager base={`/creators/${creator.id}`} filters={filters} total={total} />
    </main>
  );
}
