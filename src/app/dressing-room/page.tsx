import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { DressingRoom } from "@/components/dressing-room";
import { HubTabs, HubTitle } from "@/components/hub";
import { PreviewNotice } from "@/components/preview-notice";
import { catalogCounts, resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { getOutfit, repository } from "@/lib/data";
import { startingRack, type StartingRack } from "@/lib/dressing-room";
import { localPageMetadata } from "@/lib/seo";

export function generateMetadata(): Promise<Metadata> {
  return localPageMetadata("/dressing-room");
}

type Props = { searchParams: Promise<{ look?: string | string[] }> };

/** ?look=<id> opens a published look on the rack, to try on or change. */
async function lookToOpen(id: unknown): Promise<{ id: string; title: string; published: boolean; rack: StartingRack } | null> {
  if (typeof id !== "string" || !id) return null;
  const post = await getOutfit(id);
  if (!post) return null;
  const decoded = decodeOutfit(post.code);
  if (!decoded.ok) return null;
  return {
    id: post.id,
    title: post.title,
    published: post.authorId !== null || Boolean(post.sharedOnDiscord),
    rack: startingRack(decoded.outfit, resolveOutfit(decoded.outfit)),
  };
}

export default async function DressingRoomPage({ searchParams }: Props) {
  const t = await getTranslations("hub");
  const tp = await getTranslations("preview");
  const opened = await lookToOpen((await searchParams).look);
  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      <HubTitle title={t("dressingRoom")} blurb={t("dressingRoomBlurb")} />
      <HubTabs current="/dressing-room" />
      <PreviewNotice advice={tp("tryInGame")} className="max-w-2xl" />
      {opened && (
        <p className="text-sm text-ink-dim">
          {t.rich("startedFrom", {
            title: opened.title,
            look: (c) => (
              <Link href={`/community-gallery/${opened.id}`} className="underline underline-offset-2 hover:text-ink">
                {c}
              </Link>
            ),
          })}
        </p>
      )}
      <DressingRoom
        key={opened?.id ?? "empty"}
        itemCount={catalogCounts.items}
        start={opened?.rack ?? null}
        from={opened?.published ? opened.id : null}
        canPublish={repository.live}
      />
    </main>
  );
}
