import {
  createParser, createSearchParamsCache, parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral,
} from "nuqs/server";
import { ARMOR_TYPES, CATEGORIES, CLASSES, RACE_LABEL, SEXES, SORTS } from "@/lib/domain";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An author comes from a shareable link, and Postgres rejects a malformed uuid.
const parseAsAccountId = createParser({
  parse: (value) => (UUID.test(value) ? value : null),
  serialize: (value: string) => value,
});

export const wardrobeParsers = {
  q: parseAsString.withDefault(""),
  class: parseAsStringLiteral(CLASSES),
  race: parseAsStringLiteral(Object.keys(RACE_LABEL)),
  sex: parseAsStringLiteral(SEXES),
  armor: parseAsStringLiteral(ARMOR_TYPES),
  category: parseAsStringLiteral(CATEGORIES),
  tag: parseAsString,
  author: parseAsAccountId,
  /** The signed-in account's bookmarks. Private, so the link shows each person their own. */
  saved: parseAsBoolean.withDefault(false),
  /** Only looks with a studio picture from the game, shown picture first. */
  pictures: parseAsBoolean.withDefault(false),
  /** Looks wearing one item, by its id. */
  item: parseAsInteger,
  sort: parseAsStringLiteral(SORTS).withDefault("trending"),
  page: parseAsInteger.withDefault(1),
};
export const wardrobeCache = createSearchParamsCache(wardrobeParsers);

/**
 * A filter's choices: those some public look has, so none leads to an empty page, and the
 * one a link already chose, so the filter still shows what it filters by.
 */
export function offered<T extends string>(all: readonly T[], present: readonly string[], current: T | null): T[] {
  return all.filter((v) => v === current || present.includes(v));
}
