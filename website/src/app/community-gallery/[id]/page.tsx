import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OutfitDetail } from "@/components/outfit-detail";
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { commentPage } from "@/lib/comments";
import { getOutfit } from "@/lib/data";
import { OPEN_GRAPH } from "@/lib/site";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ comments?: string | string[] }> };

// A link pasted in Discord should say what the look is made of.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getOutfit((await params).id);
  const t = await getTranslations("look");
  if (!post) return { title: t("metaTitle") };
  const decoded = decodeOutfit(post.code);
  const names = decoded.ok ? resolveOutfit(decoded.outfit).slots.flatMap((s) => s.name ?? []) : [];
  const description = names.length
    ? t("metaPieces", { count: names.length, names: names.slice(0, 3).join(", ") })
    : t("metaPlain");
  const url = `/community-gallery/${post.id}`;
  // A look with a screenshot shows it in the preview; one without keeps the site's image.
  const images = post.gallery.length ? [{ url: `${url}/cover`, width: 1200, height: 630, alt: post.title }] : undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: { ...OPEN_GRAPH, title: post.title, description, url, ...(images && { images }) },
    ...(images && { twitter: { card: "summary_large_image", images: images.map((i) => i.url) } }),
  };
}

export default async function OutfitPage({ params, searchParams }: Props) {
  const post = await getOutfit((await params).id);
  if (!post) notFound();
  // ?comments=2 and on reach back past the newest comments, a page at a time.
  const comments = commentPage((await searchParams)?.comments);
  return (
    <main id="main" className="wrap py-10">
      <OutfitDetail post={post} commentPage={comments} />
    </main>
  );
}
