import { getOutfit } from "@/lib/data";
import { socialCard } from "@/lib/data/compress";

type Context = { params: Promise<{ id: string }> };

const NOT_FOUND = () => new Response(null, { status: 404 });

/** A look's cover screenshot as a link preview. Looks with none keep the site's image. */
export async function GET(_request: Request, { params }: Context) {
  const post = await getOutfit((await params).id);
  if (!post?.gallery.length) return NOT_FOUND();
  const cover = await fetch(post.gallery[0]);
  if (!cover.ok) return NOT_FOUND();
  const card = await socialCard(Buffer.from(await cover.arrayBuffer()));
  if (!card) return NOT_FOUND();
  return new Response(new Uint8Array(card), {
    headers: {
      "Content-Type": "image/jpeg",
      // An hour, like Storage's own cache, so a screenshot a moderator deleted stops
      // showing in previews the same time it stops showing on the site.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
