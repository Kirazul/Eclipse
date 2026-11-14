import { BadgeCheck, EyeOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { ItemRing } from "@/components/item-icon";
import { LookMenu } from "@/components/look-menu";
import { UpvoteButton } from "@/components/upvote-button";
import { resolveOutfit, type ResolvedOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import type { OutfitPost } from "@/lib/data/types";
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

// How many worn pieces the strip shows before it counts the rest.
const STRIP = 8;

/**
 * The Wardrobe's view: the look, who made it, what it wears, its tags and its code.
 * With `manage`, on its author's own list, a ⋯ menu adds Dressing room, private and Delete.
 * Follows the Eclipse design system: radius-md, a line hairline and no shadow,
 * surface-raised and the corona rim on hover, 120ms, one primary action.
 */
export function OutfitCard({ post, manage = false }: { post: OutfitPost; manage?: boolean }) {
  const resolved = resolve(post);
  const worn = pieces(resolved);
  const crest = crestArt(post, resolved);
  const capture = post.gallery[0];
  const tags = [
    ...post.categories,
    post.race ? RACE_LABEL[post.race] : null,
    post.armor ? ARMOR_LABEL[post.armor] : null,
  ].filter((t): t is string => Boolean(t));

  return (
    <article className="corona-rim relative isolate flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface transition-colors duration-[120ms] hover:bg-surface-raised">
      <Link href={`/community-gallery/${post.id}`} className="group flex flex-1 flex-col" aria-label={`Open ${post.title}`}>
        {/* Every card has the same picture frame, so a row of cards lines up with or without a capture. */}
        <div className="relative aspect-[16/10] overflow-hidden border-b border-line bg-void">
          {/* Only its author is ever shown a private look, on their own lists. */}
          {post.isPrivate && (
            <span className="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-line-strong bg-void/85 px-2.5 py-1 text-xs text-ink">
              <EyeOff className="size-3.5" strokeWidth={1.5} aria-hidden />Private
            </span>
          )}
          {capture ? (
            // The capture stands alone: the game's own panels already show its pieces, so nothing is laid over it.
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
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            {crest && <Image src={crest} alt="" width={36} height={36} unoptimized className="size-9 shrink-0 rounded-full ring-1 ring-line-strong" />}
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base leading-6 font-semibold tracking-[-0.02em] text-ink">{post.title}</h3>
              <p className="flex items-center gap-1 text-xs text-ink-faint">
                <span className="truncate">{post.author ?? "Item set"}</span>
                {post.authorVerified && <BadgeCheck className="size-3.5 shrink-0 text-amber" strokeWidth={1.5} aria-label="Verified" />}
              </p>
            </div>
          </div>
          {/* What it wears, the same row on every card, so looks compare at a glance. */}
          {worn.length > 0 && (
            <div className="flex items-center gap-1">
              {worn.slice(0, STRIP).map((p) => (
                <ItemRing key={p.slot} icon={p.icon} slot={p.slot} quality={p.quality} size={28} hidden={p.item === 0} />
              ))}
              {worn.length > STRIP && <span className="nums pl-1 text-xs text-ink-faint">+{worn.length - STRIP}</span>}
            </div>
          )}
          {/* Scanned, not read: tags before prose. */}
          {tags.length > 0 && (
            <ul className="mt-auto flex flex-wrap gap-1">
              {tags.map((t) => (
                <li key={t} className="rounded-[6px] border border-line px-2 py-0.5 text-xs leading-4 text-ink-dim">{t}</li>
              ))}
            </ul>
          )}
        </div>
      </Link>
      <div className="flex items-center gap-2 px-4 pb-4">
        {post.upvotes !== null && <UpvoteButton id={post.id} count={post.upvotes} />}
        <CopyButton code={post.code} className="ml-auto" />
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

/** The Showcase's view: a real capture first, always one click from its code. */
export function OutfitPoster({ post }: { post: OutfitPost }) {
  const resolved = resolve(post);
  const line = [post.race ? RACE_LABEL[post.race] : null, post.className].filter(Boolean).join(" ");
  return (
    <article className="relative">
      <Link href={`/community-gallery/${post.id}`} className="poster" aria-label={`Open ${post.title}`}>
        <Image src={thumbOf(post.gallery[0])} alt="" fill unoptimized sizes="(max-width: 1100px) 72vw, 22vw" className="poster__art" />
        <div className="poster__body">
          <div className="poster__rings">
            {pieces(resolved).slice(0, 5).map((p) => (
              <ItemRing key={p.slot} icon={p.icon} slot={p.slot} quality={p.quality} size={38} hidden={p.item === 0} />
            ))}
          </div>
          <h3 className="font-serif text-lg leading-tight font-normal tracking-[-0.01em]">{post.title}</h3>
          <p className="truncate text-xs text-ink-dim">{line || post.categories.join(", ")}</p>
        </div>
      </Link>
      {/* Stacked: side by side they overlap on a phone's two-column grid. */}
      <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1.5">
        <CopyButton code={post.code} />
        {post.upvotes !== null && <UpvoteButton id={post.id} count={post.upvotes} className="bg-surface/85 text-ink backdrop-blur-sm" />}
      </div>
    </article>
  );
}
