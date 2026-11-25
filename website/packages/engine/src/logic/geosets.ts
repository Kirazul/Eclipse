/**
 * Which submeshes show. Input is geoset ids (group*100 + value). Only the default
 * look starts visible; choosing a value in a group hides that group's others. Id 0
 * is the bare body itself and stays on, as group 0's other values are hairstyles.
 */
import { GROUPS, RETAIL_GROUPS, geosetValues, helmGroupValue, resolveValue, type GeoSlot } from "./retailGeo";

export const groupOf = (geoset: number) => Math.floor(geoset / 100);
export const valueOf = (geoset: number) => geoset % 100;
export const geosetId = (group: number, value: number) => group * 100 + value;

export class GeosetLook {
  readonly visible: Set<number>;

  constructor(
    defaults: Iterable<number>,
    /** Every geoset id the model has. */
    readonly modelIds: ReadonlySet<number>,
  ) {
    this.visible = new Set(defaults);
  }

  has(id: number): boolean {
    return this.visible.has(id);
  }

  /** A customization choice decided the whole look. */
  replace(ids: Iterable<number>): void {
    this.visible.clear();
    for (const id of ids) this.visible.add(id);
  }

  set(group: number, value: number): void {
    for (const id of this.modelIds) {
      if (groupOf(id) === group && id !== 0) this.visible.delete(id);
    }
    this.visible.add(geosetId(group, value));
  }

  /** The look's value in a group, -1 when it shows none. Group 0 skips the bare body. */
  valueIn(group: number): number {
    for (const id of this.visible) {
      if (groupOf(id) === group && id !== 0) return valueOf(id);
    }
    return -1;
  }
}

/**
 * The geosets an outfit shows on a body. With nothing worn the look is exactly the
 * body's own; otherwise retail's slot rules write their groups over it, and a helm
 * then hides its groups.
 */
export function outfitGeosets(
  look: GeosetLook,
  slots: readonly GeoSlot[],
  compFlags: number,
  helmHide: readonly number[],
  keepRobe = true,
): Set<number> {
  const has = (id: number) => look.modelIds.has(id);
  const out = new Set(look.visible);
  const replace = (group: number, value: number) => {
    for (const id of look.modelIds) {
      if (groupOf(id) === group && id !== 0) out.delete(id);
    }
    if (value !== 0) out.add(geosetId(group, value));
  };

  if (slots.some((s) => s.worn)) {
    const v = geosetValues(slots, compFlags, has, keepRobe);
    for (const group of RETAIL_GROUPS) {
      if (group >= GROUPS) continue;
      replace(group, resolveValue(group, v[group]!, look.valueIn(group)));
    }
  }
  for (const group of helmHide) {
    const chosen = look.valueIn(group);
    replace(group, helmGroupValue(group, has, chosen === -1 ? undefined : chosen));
  }
  return out;
}
