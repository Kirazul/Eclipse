import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { term } from "@/i18n/terms";
import { BadgeCheck, EyeOff, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { createSerializer, type SearchParams } from "nuqs/server";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { Pager, PublishButton } from "@/components/hub";
import { OutfitCard } from "@/components/outfit-card";
import { sizedAvatar } from "@/lib/avatar";
import { repository } from "@/lib/data";
import type { Creator, OutfitPost } from "@/lib/data/types";
import { ARMOR_LABEL, RACE_LABEL, type ClassName } from "@/lib/domain";
import { thumbOf } from "@/lib/screenshots";
import { wardrobeCache, wardrobeParsers } from "@/lib/search-params";
import { OPEN_GRAPH, siteUrl } from "@/lib/site";
import { cardBackdropFor, classArt } from "@/lib/wow-assets";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> };

// One lookup per request, shared by the page and its metadata.
const getCreator = cache((id: string) => repository.getCreator(id));

const serialize = createSerializer(wardrobeParsers);

/** A top look is worth pinning once there are a few to choose it from. */
const TOP_LOOK_FROM = 3;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const creator = await getCreator((await params).id);
  const t = await getTranslations("creator");
  if (!creator) return { title: t("metaTitle") };
  const title = t("title", { name: creator.name });
  const description = t("description", { count: creator.looks, name: creator.name });
  const url = `/creators/${creator.id}`;
  return { title, description, alternates: { canonical: url }, openGraph: { ...OPEN_GRAPH, title, description, url } };
}

/**
 * A creator's profile, the way social apps show a person: who they are, what they have
 * made, their best work pinned on top, then everything else. Every number is of their
 * public looks; their own private ones appear only to them, labelled.
 */
export default async function CreatorPage({ params, searchParams }: Props) {
  const creator = await getCreator((await params).id);
  if (!creator) notFound();
  const t = await getTranslations("creator");
  const tw = await getTranslations();
  const locale = await getLocale();
  const b = (c: React.ReactNode) => <b className="font-semibold text-ink">{c}</b>;
  const filters = await wardrobeCache.parse(searchParams);
  // A profile reads newest first unless asked for the most upvoted.
  const sort = filters.sort === "top" ? "top" : "newest";
  const [{ posts, total }, top, account, week] = await Promise.all([
    repository.listOutfits({ authorId: creator.id, className: filters.class, sort, page: filters.page, includePrivate: true }),
    repository.listOutfits({ authorId: creator.id, sort: "top", pageSize: 1 }),
    repository.getAccount(),
    repository.lookOfTheWeek(),
  ]);
  const own = account?.id === creator.id;
  const best = top.posts[0] ?? null;
  const weekly = week?.post.authorId === creator.id ? week.post : null;
  const base = `/creators/${creator.id}`;
  const link = (change: { class?: ClassName | null; sort?: "newest" | "top" }) =>
    serialize(base, { class: filters.class, sort, ...change });

  return (
    <main id="main" className="wrap flex flex-col pb-10">
      <ProfileCover creator={creator} best={best} />

      <div className="relative z-10 -mt-14 flex flex-wrap items-end gap-x-5 gap-y-3">
        <span className="rounded-full border-4 border-void [&_.avatar]:text-4xl [&_.avatar]:font-normal">
          <Avatar account={{ name: creator.name, avatar: sizedAvatar(creator.avatar, 256) }} size={112} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1.5">
          <h1 className="flex items-center gap-2 text-3xl leading-tight sm:text-4xl">
            <span className="truncate">{creator.name}</span>
            {creator.verified && <BadgeCheck className="size-6 shrink-0 text-amber" strokeWidth={1.5} aria-label={tw("look.verified")} />}
          </h1>
          <p className="text-sm text-ink-faint">
            {t("joined", { date: new Date(creator.joinedAt).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" }) })}
          </p>
        </div>
        <div className="flex gap-2 pb-2">
          {own ? (
            <PublishButton />
          ) : (
            <CopyButton
              code={`${siteUrl}${base}`}
              label={t("copyLink")}
              toastTitle={t("linkCopied")}
              toastHint={t("linkHint", { name: creator.name })}
              variant="outline"
            />
          )}
        </div>
      </div>

      <p className="nums mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-dim">
        <span>{t.rich("looks", { count: creator.looks, b })}</span>
        <span>{t.rich("upvotes", { count: creator.upvotes, b })}</span>
        {creator.classes.length > 0 && <span>{t.rich("classes", { count: creator.classes.length, b })}</span>}
      </p>

      {creator.classes.length > 0 && (
        <nav aria-label={t("byClass", { name: creator.name })} className="mt-4 flex flex-wrap gap-2">
          {creator.classes.map(({ className, looks }) => {
            const on = filters.class === className;
            return (
              <Link key={className} href={link({ class: on ? null : className })} className="pill" aria-current={on ? "page" : undefined}>
                <Image src={classArt(className)} alt="" width={18} height={18} unoptimized className="size-[18px] rounded-full" />
                {term(tw, "class", className)}
                <span className="nums opacity-70">{looks}</span>
              </Link>
            );
          })}
        </nav>
      )}

      {weekly && (
        <p className="mt-6 flex items-center gap-3 rounded-[var(--r-md)] border border-gold/30 bg-gold/10 px-4 py-3 text-sm">
          <Trophy className="size-5 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
          <span>
            {t.rich("weekly", {
              title: weekly.title,
              look: (c) => <Link href={`/community-gallery/${weekly.id}`} className="text-gold underline underline-offset-2">{c}</Link>,
            })}
          </span>
        </p>
      )}

      {best && creator.looks >= TOP_LOOK_FROM && !filters.class && filters.page === 1 && (
        <section aria-labelledby="top-look" className="mt-8 flex flex-col gap-3">
          <h2 id="top-look" className="text-xl">{t("topLook")}</h2>
          <TopLook post={best} />
        </section>
      )}

      <section aria-labelledby="all-looks" className="mt-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <h2 id="all-looks" className="text-xl">
            {filters.class ? t("classLooks", { class: term(tw, "class", filters.class) }) : t("allLooks")}{" "}
            <span className="nums text-base text-ink-faint">{total.toLocaleString(locale)}</span>
          </h2>
          <nav aria-label={t("sort")} className="flex gap-1.5">
            <Link href={link({ sort: "newest" })} className="pill" aria-current={sort === "newest" ? "page" : undefined}>{t("newest")}</Link>
            <Link href={link({ sort: "top" })} className="pill" aria-current={sort === "top" ? "page" : undefined}>{t("mostUpvoted")}</Link>
          </nav>
        </div>
        {own && posts.some((p) => p.isPrivate) && (
          <p className="flex items-center gap-2 text-sm text-ink-dim">
            <EyeOff className="size-4" strokeWidth={1.5} aria-hidden />
            {t("privateHere")}
          </p>
        )}
        {posts.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => <OutfitCard key={post.id} post={post} />)}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-dim">
            {filters.class
              ? t("noneOfClass", { name: creator.name, class: term(tw, "class", filters.class) })
              : t("none", { name: creator.name })}
          </p>
        )}
        <Pager base={base} filters={{ ...filters, sort }} total={total} />
      </section>
    </main>
  );
}

/** Their most upvoted screenshot, blurred behind the header; real game art when there is none. */
function ProfileCover({ creator, best }: { creator: Creator; best: OutfitPost | null }) {
  const shot = best?.gallery[0];
  return (
    <div className="relative h-40 overflow-hidden rounded-b-[var(--r-md)] border border-t-0 border-line bg-surface sm:h-52" aria-hidden>
      {shot ? (
        <Image src={thumbOf(shot)} alt="" fill unoptimized priority sizes="100vw" className="scale-110 object-cover opacity-70 blur-lg" />
      ) : (
        <Image src={cardBackdropFor(creator.id)} alt="" fill unoptimized priority sizes="100vw" className="object-cover opacity-40" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-void" />
    </div>
  );
}

/** Pinned like a social post: the picture beside what it is, one link to the look. */
function TopLook({ post }: { post: OutfitPost }) {
  const t = useTranslations("creator");
  const shot = post.gallery[0];
  const tw = useTranslations();
  const line = [
    post.className ? term(tw, "class", post.className) : null,
    post.armor ? term(tw, "armor", post.armor, ARMOR_LABEL[post.armor]) : null,
    post.race ? term(tw, "race", post.race, RACE_LABEL[post.race] ?? post.race) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href={`/community-gallery/${post.id}`}
      className="corona-rim grid overflow-hidden rounded-[8px] border border-line bg-surface transition-colors duration-[120ms] hover:bg-surface-raised md:grid-cols-[1.35fr_1fr]"
    >
      <div className="relative aspect-[16/10] max-w-full border-b border-line bg-void md:border-r md:border-b-0">
        {shot ? (
          <Image src={thumbOf(shot)} alt="" fill unoptimized sizes="(max-width: 768px) 100vw, 55vw" className="object-cover" />
        ) : (
          <>
            <Image src={cardBackdropFor(post.id)} alt="" fill unoptimized sizes="55vw" className="object-cover opacity-40" />
            {post.className && (
              <div className="absolute inset-0 grid place-items-center">
                <Image src={classArt(post.className)} alt="" width={80} height={80} unoptimized className="size-20 rounded-full ring-1 ring-line-strong" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-5">
        <h3 className="font-serif text-2xl leading-tight font-normal">{post.title}</h3>
        {line && <p className="text-sm text-ink-faint">{line}</p>}
        {post.description && <p className="line-clamp-4 text-sm text-ink-dim">{post.description}</p>}
        {post.upvotes !== null && (
          <p className="nums mt-auto text-sm text-ink-faint">{t("upvoteCount", { count: post.upvotes })}</p>
        )}
      </div>
    </Link>
  );
}
