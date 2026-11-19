import type { ArmorType, Category, ClassName, Sort } from "@/lib/domain";
import type { ParsedOutfit } from "@/lib/codec/schema";

export interface OutfitPost {
  id: string;
  title: string;
  /** Who published it. Null on a set from the game's catalogue: nobody did. */
  author: string | null;
  /** Null on a game set, and on a look from the Discord showcase its player has not claimed. */
  authorId: string | null;
  authorVerified: boolean;
  /**
   * Shared in the Discord showcase and credited by the player's Discord name, before they
   * have signed in here. A community look like any other, only with no account to link.
   */
  sharedOnDiscord?: boolean;
  /** The author's Discord picture, public like their name. */
  authorAvatar?: string | null;
  /** The ECA1: code exactly as published. Everything else is about it. */
  code: string;
  className: ClassName | null;
  armor: ArmorType | null;
  /** A key of RACE_LABEL. */
  race: string | null;
  /** What the look changes, read from its code by the database, never by its author. */
  categories: Category[];
  tags: string[];
  /** What the author wrote about it, shown as its caption. Only published looks have one. */
  description?: string | null;
  /** Null where nobody can vote: the site never shows a count it did not record. */
  upvotes: number | null;
  createdAt: string | null;
  /** Links to studio screenshots, the cover first. The code holds no pictures. */
  gallery: string[];
  /** The look this one was made from in the Dressing room, while it can still be seen. */
  remixedFrom?: { id: string; title: string; author: string | null } | null;
  /** Set private by its author, who is then the only one who sees it. */
  isPrivate?: boolean;
}

/** Someone who has chosen a public name. Every count is of what visitors can see. */
export interface Creator {
  id: string;
  name: string;
  verified: boolean;
  joinedAt: string;
  /** Their Discord picture, public like their name. */
  avatar: string | null;
  looks: number;
  upvotes: number;
  /** The classes their public looks are for, most dressed first. */
  classes: { className: ClassName; looks: number }[];
}

/** A creator as search lists them: enough to recognise and open their page. */
export interface CreatorEntry {
  id: string;
  name: string;
  verified: boolean;
  avatar: string | null;
  /** Their public looks. */
  looks: number;
}

export interface OutfitFilters {
  q?: string;
  className?: ClassName | null;
  race?: string | null;
  armor?: ArmorType | null;
  category?: Category | null;
  tag?: string | null;
  /** Only looks with a real studio capture: what the Showcase lists. */
  captured?: boolean;
  /** Only looks this account published. */
  authorId?: string | null;
  /** Every look but this account's: the community list beside your own. */
  excludeAuthorId?: string | null;
  /** Only looks the signed-in account bookmarked. */
  saved?: boolean;
  /** Only looks wearing this item. */
  item?: number | null;
  /**
   * Also the signed-in account's own private looks, which only it can read: its own lists
   * want them, labelled. Everyone else's private looks stay unreadable either way.
   */
  includePrivate?: boolean;
  sort: Sort;
  /** From 1. */
  page?: number;
  /** LOOKS_PER_PAGE unless set. */
  pageSize?: number;
}

export interface OutfitList {
  posts: OutfitPost[];
  /** Everything the filters match, across all pages. */
  total: number;
}

export interface SearchEntry {
  id: string;
  title: string;
  author: string | null;
}

export interface Account {
  id: string;
  /** Null until they choose one. */
  name: string | null;
  /** From the sign-in provider. Shown to the account's owner only. */
  avatar: string | null;
  provider: string | null;
  /** May delete any look, not only their own. */
  moderator: boolean;
}

/** A game linked to an account. Only its owner ever sees this. */
export interface GameLink {
  id: string;
  /** The character and realm that last synced. Empty until one has. */
  label: string;
  linkedAt: string;
  lastSyncAt: string | null;
}

/** A look saved in the game or sent to it from here. Private until it is published. */
export interface GameSet {
  id: string;
  name: string;
  code: string;
  updatedAt: string;
  /** Pictures the game's Showcase studio sent of this look: storage paths, as a post's. */
  gallery: string[];
}

export const REPORT_REASONS = {
  spam: "Spam or advertising",
  offensive: "Offensive title or screenshot",
  stolen: "Someone else's look, reposted",
  broken: "Not a real look, or the code is broken",
  other: "Something else",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

/** A look with reports no moderator has reviewed yet. Moderators only. */
export interface ReportedLook {
  id: string;
  title: string;
  reports: number;
  reasons: ReportReason[];
  lastReport: string;
}

/** Something said under a look. Never edited; removed by its writer, the look's author or a moderator. */
export interface LookComment {
  id: string;
  outfitId: string;
  authorId: string;
  /** Null only if the writer has since cleared their name. */
  author: string | null;
  authorVerified: boolean;
  /** The writer's Discord picture, public like their name. Null shows their initial. */
  authorAvatar: string | null;
  body: string;
  createdAt: string;
}

export const COMMENT_REPORT_REASONS = {
  spam: "Spam or advertising",
  offensive: "Offensive or abusive",
  other: "Something else",
} as const;

export type CommentReportReason = keyof typeof COMMENT_REPORT_REASONS;

/** A comment with reports no moderator has reviewed yet. Moderators only. */
export interface ReportedComment {
  id: string;
  outfitId: string;
  /** The look it was said under. */
  title: string;
  body: string;
  author: string | null;
  reports: number;
  reasons: CommentReportReason[];
  lastReport: string;
}

export type WriteResult<T> =
  | { ok: true; value: T }
  /** `existing`: the public look that already has this code, when that is the refusal. */
  | { ok: false; error: string; existing?: string };

/** The seam: pages know this and nothing about where the rows live. */
export interface Repository {
  /** False on the built-in looks: nothing can be published, voted on or stored. */
  readonly live: boolean;
  listOutfits(filters: OutfitFilters): Promise<OutfitList>;
  getOutfit(id: string): Promise<OutfitPost | null>;
  /** The most upvoted of the looks posted in the last seven days, once at least five were; otherwise null. */
  lookOfTheWeek(): Promise<{ post: OutfitPost; votes: number } | null>;
  /** A creator's public page. Null for an unknown id or someone with no public name. */
  getCreator(id: string): Promise<Creator | null>;
  searchIndex(): Promise<SearchEntry[]>;
  /** People with public looks, the most prolific first; with `q`, only names that contain it. */
  listCreators(filter: { q?: string; limit: number }): Promise<CreatorEntry[]>;
  createOutfit(input: ParsedOutfit): Promise<WriteResult<OutfitPost>>;
  upvote(id: string): Promise<WriteResult<number>>;
  /**
   * Files a report for moderators. A report never hides the look by itself. True when
   * it is this person's first report of the look, false when it counted for nothing.
   */
  report(id: string, reason: ReportReason): Promise<WriteResult<boolean>>;
  /** Whether the signed-in account bookmarked this look. False for a visitor. */
  isBookmarked(id: string): Promise<boolean>;
  setBookmark(id: string, saved: boolean): Promise<WriteResult<boolean>>;
  /** Moderators only: everything else gets an empty list. */
  listReports(): Promise<ReportedLook[]>;
  /** Moderators only: keeps a reported look and marks its reports so far as read. */
  dismissReports(id: string): Promise<WriteResult<string>>;
  /** A look's comments, oldest first. */
  listComments(outfitId: string): Promise<LookComment[]>;
  getComment(id: string): Promise<LookComment | null>;
  addComment(outfitId: string, body: string): Promise<WriteResult<LookComment>>;
  /** The writer's own, any on the signed-in author's look, or any for a moderator. */
  deleteComment(id: string): Promise<WriteResult<string>>;
  /** True when it is this person's first report of the comment. */
  reportComment(id: string, reason: CommentReportReason): Promise<WriteResult<boolean>>;
  /** Moderators only: everything else gets an empty list. */
  listCommentReports(): Promise<ReportedComment[]>;
  /** Moderators only: keeps a reported comment and marks its reports so far as read. */
  dismissCommentReports(id: string): Promise<WriteResult<string>>;
  /** Compresses and stores a screenshot, and returns its storage path. */
  uploadScreenshot(file: File): Promise<WriteResult<string>>;
  removeScreenshot(path: string): Promise<WriteResult<string>>;
  /** Removes a look and its screenshots: the author's own, or any for a moderator. */
  deleteOutfit(id: string): Promise<WriteResult<string>>;
  /** The author's own look, hidden from everyone else or shown again. Returns the new state. */
  setOutfitPrivate(id: string, isPrivate: boolean): Promise<WriteResult<boolean>>;
  /** Who is signed in, or null for a visitor. */
  getAccount(): Promise<Account | null>;
  setDisplayName(name: string): Promise<WriteResult<string>>;
  listGameLinks(): Promise<GameLink[]>;
  listGameSets(): Promise<GameSet[]>;
  getGameSet(id: string): Promise<GameSet | null>;
  /** A short code for the game to trade for its own token. It lasts ten minutes. */
  newGameLinkCode(): Promise<WriteResult<{ code: string; expiresAt: string }>>;
  unlinkGame(id: string): Promise<WriteResult<string>>;
  /** Files a look with the player's sets, where their next sync picks it up. */
  sendToGame(title: string, code: string): Promise<WriteResult<{ name: string; linked: boolean }>>;
  removeGameSet(id: string): Promise<WriteResult<string>>;
  /** Takes one of the game's pictures off a set and removes its file. */
  removeSetPicture(setId: string, path: string): Promise<WriteResult<string>>;
  /** Removes the files of pictures no set or look shows any more: the owner's own. */
  clearOrphanPictures(): Promise<void>;
}
