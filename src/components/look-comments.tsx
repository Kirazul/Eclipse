import { BadgeCheck, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { CommentActions, CommentsViewer } from "@/components/comment-actions";
import { CommentForm } from "@/components/comment-form";
import { CommentScroller } from "@/components/comment-scroller";
import { ago } from "@/lib/ago";
import { sizedAvatar } from "@/lib/avatar";
import { repository } from "@/lib/data";
import type { LookComment } from "@/lib/data/types";

/** Who wrote it: their Discord picture, or their initial if they have none. */
function Face({ name, avatar }: { name: string | null; avatar: string | null }) {
  return <Avatar account={{ name, avatar: sizedAvatar(avatar) }} size={32} />;
}

/** A social app's comment: the name and words in a bubble, when and what to do under it. */
function Comment({ comment, lookAuthorId, now }: { comment: LookComment; lookAuthorId: string | null; now: number }) {
  const { author, authorId } = comment;
  return (
    <li id={`comment-${comment.id}`} className="group/comment flex scroll-mt-4 gap-2.5">
      <Face name={author} avatar={comment.authorAvatar} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <div className="w-fit max-w-full min-w-0 rounded-2xl bg-surface-raised px-3 py-2">
            <p className="flex flex-wrap items-center gap-x-1.5 text-[0.8rem]">
              {author ? (
                <Link href={`/creators/${authorId}`} className="font-medium text-ink underline-offset-2 hover:underline">{author}</Link>
              ) : (
                <span className="text-ink-dim">Someone</span>
              )}
              {comment.authorVerified && <BadgeCheck className="size-3.5 text-amber" strokeWidth={1.5} aria-label="Verified" />}
              {authorId === lookAuthorId && (
                <span className="rounded-full border border-amber/40 px-1.5 text-[0.65rem] leading-4 text-amber">Author</span>
              )}
            </p>
            <p className="text-sm leading-snug break-words whitespace-pre-wrap text-ink-dim">{comment.body}</p>
          </div>
          <CommentActions id={comment.id} outfitId={comment.outfitId} writerId={authorId} lookAuthorId={lookAuthorId} />
        </div>
        <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toUTCString()} className="px-3 text-xs text-ink-faint">
          {ago(comment.createdAt, now)}
        </time>
      </div>
    </li>
  );
}

interface Caption {
  body: string;
  author: string | null;
  avatar: string | null;
  verified: boolean;
  createdAt: string | null;
}

/** The author's words at the head of the conversation: no bubble, the name leading the text. */
function CaptionEntry({ caption, authorId, now }: { caption: Caption; authorId: string | null; now: number }) {
  return (
    <div className="flex gap-2.5 border-b border-line py-4">
      <Face name={caption.author} avatar={caption.avatar} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm leading-snug break-words whitespace-pre-wrap text-ink-dim">
          {caption.author && authorId && (
            <Link href={`/creators/${authorId}`} className="mr-1.5 font-medium text-ink underline-offset-2 hover:underline">
              {caption.author}
            </Link>
          )}
          {/* A look from the Discord showcase: its player has no page here yet. */}
          {caption.author && !authorId && <span className="mr-1.5 font-medium text-ink">{caption.author}</span>}
          {caption.verified && <BadgeCheck className="mr-1.5 inline size-3.5 align-[-2px] text-amber" strokeWidth={1.5} aria-label="Verified" />}
          {caption.body}
        </p>
        {caption.createdAt && (
          <time dateTime={caption.createdAt} className="text-xs text-ink-faint">{ago(caption.createdAt, now)}</time>
        )}
      </div>
    </div>
  );
}

/**
 * What people said about a look, beside its picture: its own list scrolling oldest
 * first, and the place to write held at the bottom.
 */
export async function LookComments({ outfitId, lookAuthorId, caption }: {
  outfitId: string;
  /** Null on a look from the Discord showcase its player has not claimed. */
  lookAuthorId: string | null;
  /** The author's description, read first, as a post's caption is on a social app. */
  caption: Caption | null;
}) {
  const comments = await repository.listComments(outfitId);
  const now = Date.now();

  return (
    <section
      id="comments"
      aria-labelledby="comments-heading"
      className="flex max-h-[36rem] scroll-mt-24 flex-col rounded-lg border border-line bg-surface lg:absolute lg:inset-0 lg:max-h-none"
    >
      <h2 id="comments-heading" className="flex items-baseline gap-2 border-b border-line px-4 py-3 font-sans text-sm font-medium text-ink">
        Comments
        {comments.length > 0 && <span className="nums text-xs font-normal text-ink-faint">{comments.length}</span>}
      </h2>
      <CommentsViewer>
        <CommentScroller count={comments.length}>
          {caption && <CaptionEntry caption={caption} authorId={lookAuthorId} now={now} />}
          {comments.length > 0 ? (
            <ol className="flex flex-col gap-4 py-4">
              {comments.map((c) => <Comment key={c.id} comment={c} lookAuthorId={lookAuthorId} now={now} />)}
            </ol>
          ) : caption ? (
            <p className="py-4 text-center text-xs text-ink-faint">No comments yet. Be the first to say what you think.</p>
          ) : (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 py-8 text-center">
              <MessageCircle className="size-6 text-ink-faint" strokeWidth={1.5} aria-hidden />
              <p className="text-sm text-ink-dim">No comments yet</p>
              <p className="text-xs text-ink-faint">Be the first to say what you think.</p>
            </div>
          )}
        </CommentScroller>
        <CommentForm outfitId={outfitId} />
      </CommentsViewer>
    </section>
  );
}
