import { ChevronLeft, ChevronRight, Shuffle } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { createSerializer, type SearchParams } from "nuqs/server";
import { repository } from "@/lib/data";
import { LOOKS_PER_PAGE } from "@/lib/domain";
import { wardrobeCache, wardrobeParsers } from "@/lib/search-params";

export function HubTitle({ title, blurb }: { title: string; blurb: string }) {
  return (
    <header className="section__head !mb-0">
      <h1 style={{ font: "400 clamp(1.9rem, 1.3rem + 1.6vw, 2.75rem)/1.12 var(--serif)" }}>{title}</h1>
      <p>{blurb}</p>
    </header>
  );
}

type Tab = { href: string; label: "dressingRoom" | "mounts" };

/**
 * The Dressing room's views: the builder and the mounts, both drawn in 3D. Since
 * 2026-11-14 they are a section of their own, away from the Community Gallery and
 * Loadouts, which stay about sharing.
 */
const DRESSING_TABS: Tab[] = [
  { href: "/dressing-room", label: "dressingRoom" },
  { href: "/mounts", label: "mounts" },
];

/**
 * The filters the Community Gallery reads from the URL. Your own looks are listed with
 * everyone's: the Loadouts page gathers them on their own.
 */
export async function listFromSearch(searchParams: Promise<SearchParams>) {
  const f = await wardrobeCache.parse(searchParams);
  const list = await repository.listOutfits({
    q: f.q,
    className: f.class,
    race: f.race,
    sex: f.sex,
    armor: f.armor,
    category: f.category,
    tag: f.tag,
    authorId: f.author,
    saved: f.saved,
    item: f.item !== null && f.item > 0 ? f.item : null,
    captured: f.pictures,
    sort: f.sort,
    page: f.page,
  });
  return { ...list, filters: f };
}

export function PublishButton() {
  const t = useTranslations("hub");
  if (!repository.live) return null;
  return (
    <Link href="/loadouts" className="btn btn--ghost btn--sm">
      <span>{t("publish")}</span>
    </Link>
  );
}

/** A plain link, not `Link`: prefetching it would pick a look before anyone asked for one. */
export function RandomLookButton() {
  const t = useTranslations("hub");
  return (
    // A full request: the route answers with a redirect, which the client router would cache.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/community-gallery/random" className="btn btn--ghost btn--sm">
      <Shuffle className="size-3.5" strokeWidth={1.75} aria-hidden />
      <span>{t("random")}</span>
    </a>
  );
}

export function BuiltinNotice() {
  const t = useTranslations("hub");
  if (repository.live) return null;
  return (
    <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-dim">
      {t("builtin")}
    </p>
  );
}

const EMPTY = "rounded-lg border border-dashed border-line p-10 text-center text-sm text-ink-dim";

export function NoLooks({ bookmarks = false }: { bookmarks?: boolean }) {
  const t = useTranslations("hub");
  const link = (href: string) => function Linked(chunks: React.ReactNode) {
    return <Link href={href} className="text-amber underline underline-offset-2">{chunks}</Link>;
  };
  if (bookmarks) return <p className={EMPTY}>{t.rich("noBookmarks", { gallery: link("/community-gallery") })}</p>;
  if (!repository.live) return <p className={EMPTY}>{t("noArmor")}</p>;
  return <p className={EMPTY}>{t.rich("nothingYet", { publish: link("/loadouts") })}</p>;
}

const serialize = createSerializer(wardrobeParsers);

type Filters = Awaited<ReturnType<typeof listFromSearch>>["filters"];

/** Plain links, so every page of looks works without JavaScript and can be crawled. */
export function Pager({ base, filters, total }: { base: string; filters: Filters; total: number }) {
  const t = useTranslations("hub");
  const pages = Math.ceil(total / LOOKS_PER_PAGE);
  if (pages < 2) return null;
  const page = Math.max(1, filters.page);
  const href = (to: number) => serialize(base, { ...filters, page: to });
  return (
    <nav aria-label={t("pages")} className="flex items-center justify-center gap-3 pt-2">
      {page > 1 ? (
        <Link href={href(Math.min(page - 1, pages))} className="pill" rel="prev">
          <ChevronLeft className="size-3.5" /> {t("previous")}
        </Link>
      ) : null}
      <span className="nums text-xs text-ink-faint">{t("page", { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className="pill" rel="next">
          {t("next")} <ChevronRight className="size-3.5" />
        </Link>
      ) : null}
    </nav>
  );
}

/** The Dressing room's views as pills. */
export function HubTabs({ current }: { current: string }) {
  const t = useTranslations("hub");
  return (
    <nav aria-label={t("views")} className="flex flex-wrap gap-1.5">
      {DRESSING_TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} className="pill" aria-current={tab.href === current ? "page" : undefined}>
          {t(tab.label)}
        </Link>
      ))}
    </nav>
  );
}
