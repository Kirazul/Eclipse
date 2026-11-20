import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { OutfitCard, OutfitPoster } from "@/components/outfit-card";
import { Icon } from "@/components/site/icons";
import { repository } from "@/lib/data";

/** The home page's pick, only when a look has earned it this week: a quiet week shows nothing. */
export async function LookOfTheWeek() {
  const pick = await repository.lookOfTheWeek();
  if (!pick) return null;
  const { post, votes } = pick;
  const t = await getTranslations("week");
  return (
    <section className="section" aria-labelledby="week-heading">
      <div className="wrap">
        <div className="section__row">
          <header className="section__head">
            <h2 id="week-heading">{t("title")}</h2>
            <p>
              {t("lead", { votes })}
              {post.author && post.authorId && t.rich("by", {
                author: post.author,
                creator: (c) => <Link href={`/creators/${post.authorId}`} className="underline underline-offset-2">{c}</Link>,
              })}
              {post.author && post.sharedOnDiscord && t.rich("by", { author: post.author, creator: (c) => c })}.
            </p>
          </header>
          <Link href={`/community-gallery/${post.id}`} className="btn btn--ghost btn--sm">
            <span>{t("open")}</span><Icon id="i-arrow" />
          </Link>
        </div>
        <div className="featured">
          {post.gallery.length ? <OutfitPoster post={post} /> : <OutfitCard post={post} />}
        </div>
      </div>
    </section>
  );
}
