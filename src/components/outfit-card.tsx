import { BadgeCheck, Copy, EyeOff } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { CopyButton } from "@/components/copy-button";
import { HoverLink } from "@/components/hover-link";
import { ItemRing } from "@/components/item-icon";
import { LookMenu } from "@/components/look-menu";
import { UpvoteButton } from "@/components/upvote-button";
import { resolveOutfit, type ResolvedOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import type { OutfitPost } from "@/lib/data/types";
import { term } from "@/i18n/terms";
import { posted } from "@/lib/ago";
import { ARMOR_LABEL, RACE_LABEL, VISIBLE_SLOTS } from "@/lib/domain";
import { thumbOf } from "@/lib/screenshots";
import { cardBackdropFor, classArt, raceArt } from "@/lib/wow-assets";

const resolve = (post: OutfitPost) => {
  const decoded = decodeOutfit(post.code);
  return decoded.ok ? resolveOutfit(decoded.outfit) : null;
};

const pieces = (resolved: ResolvedOutfit | null) =>
  VISIBLE_SLOTS.flatMap((slot) => resolved?.slots.filter((s) => s.slot === slot) ?? []);

const crestArt = (post: OutfitPost, resolved: ResolvedOutfit | null) =>
  post.className
    ? classArt(post.className)
    : resolved?.raceKey
      ? raceArt(resolved.raceKey, resolved.sex)
      : null;

const compact = (locale: string, n: number) =>
  new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);

/**
 * The Gallery's view: the look, who made it, its copies, one detail, when, and its code; hover shows its caption and the other details.
 * With `manage`, on its author's own list, a ⋯ menu adds Dressing room, private and Delete.
 * Follows the Eclipse design system: radius-md, a line hairline and no shadow,
 * surface-raised and the corona rim on hover, 120ms, one primary action.
 */
export function OutfitCard({ post, manage = false }: { post: OutfitPost; manage?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const resolved = resolve(post);
  const worn = pieces(resolved);
  const crest = crestArt(post, resolved);
  const capture = post.gallery[0];
  // Details wait for hover; the card at rest shows only the title, author, copies and date.
  const rest = [
    post.className ? term(t, "class", post.className) : null,
    post.race ? term(t, "race", post.race, RACE_LABEL[post.race]) : null,
    post.armor ? term(t, "armor", post.armor, ARMOR_LABEL[post.armor]) : null,
    ...post.categories.map((c) => term(t, "category", c)),
  ].filter((t): t is string => Boolean(t));
  const caption = post.description?.trim();
  const copies = post.copies ?? 0;
  const copiesLabel = t("card.copies", { count: copies });

  return (
    <article className="corona-rim relative isolate flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface transition-colors duration-[120ms] hover:bg-surface-raised">
      {/* The look's link covers the card from underneath, so the author's name can be a link of its own above it: a link inside a link is not allowed. */}
      <div className="group relative flex flex-1 flex-col">
        <HoverLink
          href={`/community-gallery/${post.id}`}
          className="absolute inset-0 z-20 rounded-t-[8px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber"
          aria-label={t("card.open", { title: post.title })}
        />
        {/* Every card has the same picture frame, so a row of cards lines up with or without a capture. */}
        <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-void">
          {/* Only its author is ever shown a private look, on their own lists. */}
          {post.isPrivate && (
            <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-line-strong bg-void/85 px-2.5 py-1 text-xs text-ink">
              <EyeOff className="size-3.5" strokeWidth={1.5} aria-hidden />{t("card.private")}
            </span>
          )}
          {capture ? (
            // The capture stands alone at rest; only hover lays the caption over it.
            <Image src={thumbOf(capture)} alt="" fill unoptimized sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover" />
          ) : (
            <>
              {/* An image rather than a CSS background, so cards below the fold fetch theirs only when scrolled to. */}
              <Image src={cardBackdropFor(post.id)} alt="" aria-hidden fill unoptimized loading="lazy" sizes="33vw" className="object-cover opacity-40" />
              {crest && (
                <div className="absolute inset-0 grid place-items-center">
                  <Image src={crest} alt="" width={64} height={64} unoptimized className="size-16 rounded-full ring-1 ring-line-strong" />
                </div>
              )}
            </>
          )}
          {/* More on hover, as a store shelf does: what the author wrote and the details the card leaves out. Under the link, so a click still opens the look. Tailwind's hover applies only where a pointer can hover; on a phone the look's page has all of it. */}
          {(caption || rest.length > 0) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-void via-void/90 to-transparent px-4 pt-10 pb-3 opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100">
              {caption && <p className="line-clamp-3 text-sm leading-5 text-ink">{caption}</p>}
              {rest.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {rest.map((t) => (
                    <li key={t} className="rounded-[6px] border border-line-strong px-2 py-0.5 text-xs leading-4 text-ink-dim">{t}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            {crest && <Image src={crest} alt="" width={36} height={36} unoptimized className="size-9 shrink-0 rounded-full ring-1 ring-line-strong" />}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base leading-6 font-semibold tracking-[-0.02em] text-ink">{post.title}</h3>
              <p className="flex items-center gap-1 text-xs text-ink-faint">
                {post.authorId && post.author ? (
                  <HoverLink href={`/creators/${post.authorId}`} className="relative z-30 truncate underline-offset-2 hover:text-ink hover:underline">
                    {post.author}
                  </HoverLink>
                ) : (
                  <span className="truncate">{post.author ?? t("card.itemSet")}</span>
                )}
                {post.authorVerified && <BadgeCheck className="size-3.5 shrink-0 text-amber" strokeWidth={1.5} aria-label={t("look.verified")} />}
              </p>
            </div>
          </div>
          {/* Copies and date at rest, the details on hover: no item strip, the look's page lists what it wears. */}
          {(copies > 0 || post.createdAt) && (
            <div className="mt-auto flex items-center gap-2 text-xs leading-4 text-ink-faint">
              {/* Shown once someone has copied it: a row of zeros would say nothing. */}
              {copies > 0 && (
                <span className="nums inline-flex shrink-0 items-center gap-1 text-ink-dim" title={copiesLabel}>
                  <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />
                  <span aria-hidden>{compact(locale, copies)}</span>
                  <span className="sr-only">{copiesLabel}</span>
                </span>
              )}
              {post.createdAt && (
                <time dateTime={post.createdAt} className="nums ml-auto shrink-0">{posted(post.createdAt, Date.now(), locale)}</time>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pb-4">
        {post.upvotes !== null && <UpvoteButton id={post.id} count={post.upvotes} />}
        <CopyButton code={post.code} look={post.id} className="ml-auto" />
        {manage && (
          <LookMenu
            id={post.id}
            authorId={post.authorId}
            community={Boolean(post.authorId) || Boolean(post.sharedOnDiscord)}
            isPrivate={post.isPrivate ?? false}
            dressingRoom={worn.length > 0 ? `/dressing-room?look=${encodeURIComponent(post.id)}` : undefined}
            className="size-8"
          />
        )}
      </div>
    </article>
  );
}

/**
 * The Gallery's and Showcase's view: a real capture first, always one click from its code.
 * Hover (or keyboard focus) slides up what the author wrote, the remaining details, who made it, its copies and when.
 * A look with no capture gets its crest on a backdrop, so a grid lines up either way.
 */
export function OutfitPoster({ post }: { post: OutfitPost }) {
  const t = useTranslations();
  const locale = useLocale();
  const resolved = resolve(post);
  const capture = post.gallery[0];
  const crest = capture ? null : crestArt(post, resolved);
  const line = [post.race ? term(t, "race", post.race, RACE_LABEL[post.race]) : null, post.className ? term(t, "class", post.className) : null].filter(Boolean).join(" ");
  // Race and class are already on the card's line; hover adds the rest.
  const tags = [post.armor ? term(t, "armor", post.armor, ARMOR_LABEL[post.armor]) : null, ...post.categories.map((c) => term(t, "category", c))].filter((t): t is string => Boolean(t));
  const caption = post.description?.trim();
  const copies = post.copies ?? 0;
  const copiesLabel = t("card.copies", { count: copies });
  return (
    <article className="relative">
      <HoverLink href={`/community-gallery/${post.id}`} className="poster group" aria-label={t("card.open", { title: post.title })}>
        {capture ? (
          <Image src={thumbOf(capture)} alt="" fill unoptimized sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" className="poster__art" />
        ) : (
          <>
            <Image src={cardBackdropFor(post.id)} alt="" aria-hidden fill unoptimized loading="lazy" sizes="25vw" className="poster__art opacity-40" />
            {crest && (
              <div className="absolute inset-0 grid place-items-center pb-16">
                <Image src={crest} alt="" width={72} height={72} unoptimized className="size-18 rounded-full ring-1 ring-line-strong" />
              </div>
            )}
          </>
        )}
        {/* A deeper shade on hover, so the details read over a bright capture. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void via-void/70 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
        <div className="poster__body">
          <div className="poster__rings">
            {pieces(resolved).slice(0, 5).map((p) => (
              <ItemRing key={p.slot} icon={p.icon} slot={p.slot} quality={p.quality} size={38} hidden={p.item === 0} />
            ))}
          </div>
          <h3 className="font-serif text-lg leading-tight font-normal tracking-[-0.01em]">{post.title}</h3>
          <p className="truncate text-xs text-ink-dim">{line || post.categories.map((c) => term(t, "category", c)).join(", ")}</p>
          {/* Rows animate from 0fr to 1fr, so the panel grows to its own height without a fixed max-height. */}
          <div className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-visible:grid-rows-[1fr] group-focus-visible:opacity-100">
            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
              {caption && <p className="mt-2 line-clamp-3 text-sm leading-5 text-ink">{caption}</p>}
              {tags.length > 0 && (
                <ul className={`flex flex-wrap gap-1 ${caption ? "" : "mt-2"}`}>
                  {tags.map((t) => (
                    <li key={t} className="rounded-[6px] border border-line-strong bg-void/40 px-2 py-0.5 text-xs leading-4 text-ink-dim">{t}</li>
                  ))}
                </ul>
              )}
              <p className={`flex items-center gap-2 text-xs leading-4 text-ink-faint ${caption || tags.length ? "" : "mt-2"}`}>
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{post.author ?? t("card.itemSet")}</span>
                  {post.authorVerified && <BadgeCheck className="size-3.5 shrink-0 text-amber" strokeWidth={1.5} aria-label={t("look.verified")} />}
                </span>
                {copies > 0 && (
                  <span className="nums inline-flex shrink-0 items-center gap-1 text-ink-dim" title={copiesLabel}>
                    <Copy className="size-3.5" strokeWidth={1.5} aria-hidden />
                    <span aria-hidden>{compact(locale, copies)}</span>
                    <span className="sr-only">{copiesLabel}</span>
                  </span>
                )}
                {post.createdAt && <time dateTime={post.createdAt} className="nums ml-auto shrink-0">{posted(post.createdAt, Date.now(), locale)}</time>}
              </p>
            </div>
          </div>
        </div>
      </HoverLink>
      {/* Stacked: side by side they overlap on a phone's two-column grid. */}
      <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1.5">
        <CopyButton code={post.code} look={post.id} />
        {post.upvotes !== null && <UpvoteButton id={post.id} count={post.upvotes} className="bg-surface/85 text-ink backdrop-blur-sm" />}
      </div>
    </article>
  );
}
