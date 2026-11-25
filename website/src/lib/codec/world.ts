// ECW1: the world code. A port of place::EncodeCode and place::ImportCode
// (world/Places.cpp): base64 of the wstyle.* lines settings.cfg holds, for the
// rows that are on. Change them together.
import { base64Decode } from "./base64";

export const OUTFIT_WORLD_TAG = "ECW1:";

const MAX_TEXT = 128 * 1024; // kMaxCode
const MAX_NUMBER_CHARS = 12;

export const WORLD_ROWS = ["ground", "buildings", "objects", "grass"] as const;
export type WorldRowName = (typeof WORLD_ROWS)[number];

// The tags on disk (kRowTag), which are not the names the page shows.
const ROW_TAG: Record<WorldRowName, string> = {
  ground: "ground",
  buildings: "bldg",
  objects: "obj",
  grass: "grass",
};
const ROW_OF_TAG = new Map(WORLD_ROWS.map((r) => [ROW_TAG[r], r]));

// color::kMode_*, in order. The website only labels them.
export const WORLD_MODES = [
  "Solid", "Textured", "Glow", "Ghost", "Wire", "Wash", "Stain", "Vivid",
] as const;

export type Rgba = [number, number, number, number];

export interface WorldRow {
  on: boolean;
  mode: number | null;
  colour: Rgba | null;
  stops: number | null;
  values: Record<string, string>;
}

export interface WorldPlace {
  /** The settings tag: "a1519" for an AreaTable row, "m631" for a Map row. */
  tag: string;
  rows: Partial<Record<WorldRowName, WorldRow>>;
}

export type WorldDecodeResult =
  | { ok: true; places: WorldPlace[] }
  | { ok: false; error: string };

const NOT_ONE = "That is not an Eclipse world code. Copy it again with Share on Colors > World.";

function plainNumbers(value: string): boolean {
  return value
    .split(" ")
    .every((t) => /^[0-9.-]*$/.test(t) && t.length <= MAX_NUMBER_CHARS);
}

function parseTag(tag: string) {
  const m = /^wstyle\.([ma])(\d+)\.([a-z]+)\.(.+)$/.exec(tag);
  if (!m) return null;
  const row = ROW_OF_TAG.get(m[3]);
  if (!row || Number(m[2]) > 0xffffff) return null;
  return { place: `${m[1]}${m[2]}`, row, key: m[4] };
}

function colourOf(value: string): Rgba | null {
  const n = value.split(" ").map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? (n as Rgba) : null;
}

export function decodeWorld(text: string): WorldDecodeResult {
  const s = text.trimStart();
  if (text.length > MAX_TEXT || s.slice(0, 5).toUpperCase() !== OUTFIT_WORLD_TAG) {
    return { ok: false, error: NOT_ONE };
  }
  const body = base64Decode(s.slice(5));
  if (!body) return { ok: false, error: NOT_ONE };

  const places = new Map<string, WorldPlace>();
  for (const raw of body.split("\n")) {
    const line = raw.replace(/[\r ]+$/, "");
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const tag = parseTag(line.slice(0, sp));
    if (!tag) continue; // a newer build's key
    const value = line.slice(sp + 1);
    if (!plainNumbers(value)) return { ok: false, error: NOT_ONE };
    const place = places.get(tag.place) ?? { tag: tag.place, rows: {} };
    places.set(tag.place, place);
    const row = (place.rows[tag.row] ??= {
      on: false, mode: null, colour: null, stops: null, values: {},
    });
    row.values[tag.key] = value;
    if (tag.key === "on") row.on = Number(value) !== 0;
    else if (tag.key === "mode") row.mode = Number(value);
    else if (tag.key === "vis") row.colour = colourOf(value);
    else if (tag.key === "stops") row.stops = Number(value);
  }
  if (!places.size) return { ok: false, error: NOT_ONE };
  return { ok: true, places: [...places.values()] };
}
