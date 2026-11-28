import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import type { SubmitOutfit } from "@/lib/codec/schema";
import { PUBLISHING_LIMIT_ERROR, type GameSet } from "@/lib/data/types";

// The publish form's own title limit (submitOutfitSchema).
const TITLE_MAX = 80;

/** What a set that is gone, or has lost its pictures, answers when it is published as it is. */
export const SET_NOT_READY = "That loadout is gone, or has no pictures to publish.";

/**
 * A ready set as the publish form fills it in before anyone types: the name the game saved
 * it under, its pictures, the class of the character that saved it, the armor its code
 * wears, and the race the look changes to, else the character's (as Decoder suggests).
 */
export function setAsLook(set: GameSet): SubmitOutfit {
  const decoded = decodeOutfit(set.code);
  const resolved = decoded.ok ? resolveOutfit(decoded.outfit) : null;
  return {
    title: set.name.trim().slice(0, TITLE_MAX),
    code: set.code,
    className: set.className ?? undefined,
    armor: resolved?.armor ?? undefined,
    race: resolved?.raceKey ?? set.race ?? undefined,
    gallery: set.gallery,
  };
}

export type Published = { ok: true; id: string } | { ok: false; error: string; existing?: string };

export type SetOutcome = { setId: string; name: string } & Published;

export interface PublishedSets {
  /** What happened to each set that was tried, in the order chosen. */
  outcomes: SetOutcome[];
  /** Sets never published because the publishing limit stopped the batch, the one it stopped on included. */
  notTried: number;
  /** Why the batch stopped early, or null when every set was tried. */
  stoppedBy: string | null;
}

/**
 * Publishes ready sets one after another, each down `publish`, the path the form uses.
 * A set refused for its own reason (its code already public, say) does not stop the
 * rest; the hourly publishing limit does, since every set after it would be refused too.
 */
export async function publishSetsInTurn(
  ids: string[],
  { getSet, publish }: { getSet: (id: string) => Promise<GameSet | null>; publish: (look: SubmitOutfit) => Promise<Published> },
): Promise<PublishedSets> {
  const chosen = [...new Set(ids)];
  const outcomes: SetOutcome[] = [];
  for (const [i, setId] of chosen.entries()) {
    const set = await getSet(setId);
    if (!set || set.gallery.length === 0) {
      outcomes.push({ setId, name: set?.name ?? "", ok: false, error: SET_NOT_READY });
      continue;
    }
    const r = await publish(setAsLook(set));
    if (!r.ok && r.error === PUBLISHING_LIMIT_ERROR) {
      return { outcomes, notTried: chosen.length - i, stoppedBy: r.error };
    }
    outcomes.push({ setId, name: set.name, ...r });
  }
  return { outcomes, notTried: 0, stoppedBy: null };
}
