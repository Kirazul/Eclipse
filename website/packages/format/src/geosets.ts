/**
 * The body-geoset groups a slot owns, each with the ItemDisplayInfo.AttachmentGeosetGroup
 * column that drives it (Eclipse's midnight_build.py SLOT_GROUPS, measured on every Midnight
 * display). A set's combined collection model carries every slot's parts in one file, and
 * a slot shows only its own groups: another slot's part in that file is not this item's.
 */
export const SLOT_GEOSET_GROUPS: Readonly<Record<string, readonly (readonly [group: number, column: number])[]>> = {
  head: [[27, 0], [21, 1]],
  shoulder: [[26, 0]],
  chest: [[8, 0], [10, 1], [13, 2], [22, 3], [28, 4]],
  shirt: [[8, 0], [10, 1]],
  legs: [[11, 0], [9, 1], [13, 2]],
  hands: [[4, 0], [23, 1]],
  feet: [[5, 0], [20, 1]],
  waist: [[18, 0]],
  back: [[15, 0]],
  tabard: [[12, 0]],
  wrist: [],
};

/** Of a collection's geosets, what the slot wearing it shows: its own groups, and ungrouped geometry. */
export function ownedGeosets(geosets: readonly number[], slot: string): number[] {
  const groups = SLOT_GEOSET_GROUPS[slot];
  if (!groups) return [...geosets];
  return geosets.filter((id) => id < 100 || groups.some(([g]) => g === Math.floor(id / 100)));
}
