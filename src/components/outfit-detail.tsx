import { BadgeCheck, ChevronDown, Code, EyeOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { term } from "@/i18n/terms";
import { LookComments } from "@/components/look-comments";
import { LookPieces } from "@/components/look-pieces";
import { LookMenu } from "@/components/look-menu";
import { ModeratorReports } from "@/components/moderator-reports";
import { hasLoadoutFacts, LoadoutFacts } from "@/components/outfit-breakdown";
import { SendToGame } from "@/components/send-to-game";
import { LookModel } from "@/components/studio/look-model";
import { UpvoteButton } from "@/components/upvote-button";
import { posted } from "@/lib/ago";
import { resolveOutfit, type ResolvedOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { repository } from "@/lib/data";
import type { OutfitPost } from "@/lib/data/types";
import { ARMOR_LABEL, RACE_LABEL, VISIBLE_SLOTS } from "@/lib/domain";
import { NARCISSUS_URL } from "@/lib/site";
import { wearerOf } from "@/lib/viewer/figure";
import { backdropFor, classArt, raceArt } from "@/lib/wow-assets";

const VISIBLE = VISIBLE_SLOTS as readonly number[];

/** The Dressing room dresses visible slots only, so a pure morph or mount has nothing to open. */
const hasArmor = (r: ResolvedOutfit) => r.slots.some((s) => VISIBLE.includes(s.slot));

/** Slot -> baked model for each visible piece the code wears, for the 3D preview. */
const worn = (r: ResolvedOutfit) =>
  Object.fromEntries(r.slots.filter((s) => s.item !== 0 && VISIBLE.includes(s.slot)).map((s) => [s.slot, s.display]));

/** The look's class crest, or its race's portrait, in the studio's artifact ring. */
function Crest({ post, resolved }: { post: OutfitPost; resolved: ResolvedOutfit | null }) {
  const art = post.className
    ? classArt(post.className)
    : resolved?.raceKey
      ? raceArt(resolved.raceKey, resolved.sex)
      : null;
  if (!art) return <Image src="/assets/img/logo-320.webp" alt="" width={48} height={48} unoptimized className="shrink-0" />;
  return (
    <span className="hex shrink-0" style={{ width: 52, height: 52 }}>
      <span className="hex__icon"><Image src={art} alt="" width={52} height={52} unoptimized /></span>
      <Image src="/wow/rings/artifact.png" alt="" width={52} height={52} unoptimized className="hex__frame" />
    </span>
  );
}

/**
 * A look's page: who it is, the game's picture of it, what to do with it, and what it
 * wears. Everything else sits quietly underneath.
 */
export async function OutfitDetail({ post }: { post: OutfitPost }) {
  // A player's look, published here or shared on Discord, as against one of the game's
  // own sets. Only those can be bookmarked, reported or talked about.
  const community = Boolean(post.authorId) || Boolean(post.sharedOnDiscord);
  const saved = community ? await repository.isBookmarked(post.id) : false;
  const decoded = decodeOutfit(post.code);
  const resolved = decoded.ok ? resolveOutfit(decoded.outfit) : null;
  const t = await getTranslations("look");
  const tw = await getTranslations();
  const locale = await getLocale();
  const facts = [
    post.className ? term(tw, "class", post.className) : null,
    post.race ? term(tw, "race", post.race, RACE_LABEL[post.race] ?? post.race) : null,
    post.armor ? term(tw, "armor", post.armor, ARMOR_LABEL[post.armor]) : null,
  ].filter((f): f is string => Boolean(f));
  // A category is the game's word; a tag is the player's own, shown as typed.
  const tags = [...post.categories.map((c) => term(tw, "category", c)), ...post.tags];
  // Only a player's look has someone to talk to, and only a live site stores what is said.
  const social = repository.live && community;
  const comments = social ? await repository.listComments(post.id) : [];
  // With nothing said yet, what the look wears takes the place beside the picture, and the
  // place to write the first comment waits under it.
  const talk = social && (comments.length > 0 || Boolean(post.description));

  return (
    <article className="flex flex-col gap-8">
      {community && <ModeratorReports id={post.id} />}
      {/* Only its author can open a private look, so this is said to them alone. */}
      {post.isPrivate && (
        <p className="flex items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm text-ink-dim">
          <EyeOff className="size-4 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
          {t("private")}
        </p>
      )}

      <header className="flex items-center gap-4">
        <Crest post={post} resolved={resolved} />
        <div className="min-w-0">
          <h1 className="text-3xl leading-tight text-balance sm:text-4xl">{post.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-dim">
            {facts.length > 0 && <span>{facts.join(" · ")}</span>}
            {facts.length > 0 && <span aria-hidden className="text-ink-faint">·</span>}
            <span className="inline-flex items-center gap-1">
              {/* One run of text: as flex items, the name and the comma after it would each get the gap. */}
              <span>
                {post.authorId && post.author ? (
                  t.rich("by", {
                    author: post.author,
                    creator: (c) => <Link href={`/creators/${post.authorId}`} className="text-ink underline-offset-2 hover:underline">{c}</Link>,
                  })
                ) : post.sharedOnDiscord && post.author ? (
                  // No account to link yet: it becomes theirs when they sign in with Discord.
                  t.rich("byDiscord", { author: post.author, name: (c) => <span className="text-ink">{c}</span> })
                ) : (post.author ?? t("gameSet"))}
              </span>
              {post.authorVerified && <BadgeCheck className="size-3.5 text-amber" strokeWidth={1.5} aria-label={t("verified")} />}
            </span>
            {/* Only what was recorded: a look with no date shows none. */}
            {post.createdAt && (
              <>
                <span aria-hidden className="text-ink-faint">·</span>
                <time dateTime={post.createdAt} title={new Date(post.createdAt).toUTCString()}>
                  {posted(post.createdAt, Date.now(), locale)}
                </time>
              </>
            )}
          </p>
          {post.remixedFrom && (
            <p className="mt-0.5 text-sm text-ink-faint">
              {t.rich("basedOn", {
                title: post.remixedFrom.title,
                look: (c) => <Link href={`/community-gallery/${post.remixedFrom!.id}`} className="text-amber underline-offset-2 hover:underline">{c}</Link>,
              })}
              {post.remixedFrom.author && t("basedOnBy", { author: post.remixedFrom.author })}
            </p>
          )}
        </div>
      </header>

      {!resolved && <p className="text-sm text-bad">{t("broken")}</p>}

      {/*
        As a photo on a social app: the picture with the conversation beside it, and
        everything about the look under the picture. Until anyone has said something,
        the look sits beside the picture instead and the conversation under it.
      */}
      <div className={`grid gap-x-8 gap-y-6 ${social ? "lg:grid-cols-[minmax(0,1fr)_24rem]" : ""}`}>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <LookModel
            pieces={resolved ? worn(resolved) : {}}
            wearer={decoded.ok ? wearerOf(decoded.outfit.look) : null}
            gallery={post.gallery}
            backdrop={backdropFor(post.id)}
            title={post.title}
          />
        </div>

        <div className={`flex min-w-0 flex-col gap-6 ${social && !talk ? "lg:col-start-2 lg:row-span-2 lg:row-start-1" : "lg:col-start-1 lg:row-start-2"}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-5" aria-label={t("use")} role="group">
            <CopyButton code={post.code} look={post.id} className="h-[2.9rem] px-6 text-[0.95rem]" />
            {repository.live && <SendToGame id={post.id} />}
            {post.upvotes !== null && (
              <UpvoteButton id={post.id} count={post.upvotes} className="h-[2.9rem] rounded-full px-4" />
            )}
            <LookMenu
              id={post.id}
              authorId={post.authorId}
              community={community}
              isPrivate={post.isPrivate ?? false}
              saved={social ? saved : undefined}
              dressingRoom={resolved && hasArmor(resolved) ? `/dressing-room?look=${encodeURIComponent(post.id)}` : undefined}
              afterDelete="/community-gallery"
              className="size-[2.9rem] sm:ml-auto"
            />
          </div>

          {resolved && <LookPieces resolved={resolved} />}

          {resolved && hasLoadoutFacts(resolved) && (
            <section aria-labelledby="facts-heading" className="flex flex-col gap-2">
              <h2 id="facts-heading" className="font-sans text-sm font-medium text-ink">{t("alsoInCode")}</h2>
              <LoadoutFacts resolved={resolved} />
            </section>
          )}

          {tags.length > 0 && (
            <section aria-labelledby="tags-heading" className="flex flex-col gap-2">
              <h2 id="tags-heading" className="font-sans text-sm font-medium text-ink">{t("tags")}</h2>
              <ul className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li key={tag} className="rounded-full border border-line bg-surface-raised px-2.5 py-0.5 text-xs text-ink-dim">{tag}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {social && (
          // Last on a phone, after the look. Beside the picture on a wide screen, and
          // exactly its height: the box fills the row the picture sets, never stretches it.
          <aside
            className={talk ? "relative order-last lg:order-none lg:col-start-2 lg:row-start-1 lg:min-h-[26rem]" : "order-last lg:col-start-1 lg:row-start-2"}
            aria-label={t("comments")}
          >
            <LookComments
              comments={comments}
              beside={talk}
              outfitId={post.id}
              lookAuthorId={post.authorId}
              caption={post.description
                ? { body: post.description, author: post.author, avatar: post.authorAvatar ?? null, verified: post.authorVerified, createdAt: post.createdAt }
                : null}
            />
          </aside>
        )}
      </div>

      <footer className="flex flex-col gap-4 border-t border-line pt-6">
        <details className="group rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink-dim transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <Code className="size-4" strokeWidth={1.5} aria-hidden />
            {t("code")}
            <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" strokeWidth={1.5} aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-4">
            <pre className="max-h-40 overflow-auto rounded-md border border-line bg-void p-3 font-mono text-xs leading-[18px] break-all whitespace-pre-wrap text-ink-dim">
              {post.code}
            </pre>
            <CopyButton code={post.code} look={post.id} variant="outline" className="self-start" />
          </div>
        </details>

        <p className="text-xs text-ink-faint">
          {t.rich("credit", {
            narcissus: (c) => <a href={NARCISSUS_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink-dim">{c}</a>,
          })}
        </p>
      </footer>
    </article>
  );
}
