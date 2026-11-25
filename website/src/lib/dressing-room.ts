import type { ItemHit, ResolvedOutfit } from "@/lib/catalog";
import { emptyOutfit, encodeOutfit, type Outfit } from "@/lib/codec/outfit";
import { RACE_BY_ID, VISIBLE_SLOTS } from "@/lib/domain";
import { CLASSIC_FALLBACK } from "@/lib/viewer/figure";

/** Who wears the rack: any race the 3D bodies have, and its appearance. */
export interface DressingLook {
  /** A race key, as the bodies name them: "nightelf", "vulpera". */
  race: string;
  /** 0 male, 1 female. */
  gender: number;
  /** Retail's option and choice ids, in the body's order. Null or absent: its first look. */
  choices?: [number, number][] | null;
}

const CLASSIC_ID: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(RACE_BY_ID).map(([id, key]) => [key, Number(id)]),
);

/** A classic look line with the default appearance, which every classic body has. */
const classicLook = (race: number, gender: number) =>
  ({ kind: "look", race, gender, skin: 0, face: 0, hairStyle: 0, hairColour: 0, facialHair: 0 }) as const;

/**
 * The loadout code for what is on the rack: slot -> item, where 0 hides the slot.
 * Null until something is chosen, because an empty code would dress nobody.
 *
 * A classic race in its first look is a `look` line, which every client reads. Any
 * other race or appearance is an `rlook` line (races::Serialize), with the classic body
 * a player without the race pack wears instead written under it, as the game does.
 * Classic appearance stays at 0: the game moves whatever a race cannot draw (cc::Sanitise).
 */
export function dressedCode(slots: Record<number, number>, look: DressingLook | null): string | null {
  if (!look && !Object.keys(slots).length) return null;
  const outfit = emptyOutfit();
  outfit.slots = slots;
  if (look) {
    const classic = CLASSIC_ID[look.race];
    if (classic && !look.choices?.length) outfit.look = classicLook(classic, look.gender);
    else {
      const sex = look.gender ? "f" : "m";
      const line = [`rlook ${look.race} ${sex}`, ...(look.choices ?? []).map(([o, c]) => `${o}:${c}`)].join(" ");
      outfit.look = { kind: "rlook", race: look.race, sex, line };
      const fallback = CLASSIC_FALLBACK[look.race];
      if (fallback) outfit.fallback = classicLook(fallback, look.gender);
    }
  }
  return encodeOutfit(outfit);
}

/** What a published look puts on the rack: slot -> item, where null hides the slot. */
export interface StartingRack {
  pieces: Record<number, ItemHit | null>;
  look: DressingLook | null;
}

/**
 * A published look, opened in the Dressing room. It keeps the visible slots, the race
 * and its appearance; mounts, morphs and enchants have no place on the rack.
 */
export function startingRack(outfit: Outfit, resolved: ResolvedOutfit): StartingRack {
  const visible = new Set<number>(VISIBLE_SLOTS);
  const pieces: Record<number, ItemHit | null> = {};
  for (const s of resolved.slots) {
    if (!visible.has(s.slot)) continue;
    pieces[s.slot] = s.item === 0 ? null : { id: s.item, name: s.name ?? `Item ${s.item}`, icon: s.icon, quality: s.quality, display: s.display };
  }
  const l = outfit.look;
  let look: DressingLook | null = null;
  if (l?.kind === "look" && RACE_BY_ID[l.race]) look = { race: RACE_BY_ID[l.race], gender: l.gender, choices: null };
  else if (l?.kind === "rlook") {
    const choices = [...l.line.matchAll(/(\d+):(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
    look = { race: l.race, gender: l.sex === "f" ? 1 : 0, choices: choices.length ? choices : null };
  }
  return { pieces, look };
}
