/**
 * The contract between bake/, engine/ and site/. If a shape here changes, all
 * three change together, and FORMAT_VERSION goes up.
 *
 * Object keys are relative to the pack base URL (R2, or /packs in local dev).
 * Everything except catalog/ and models/<id>/manifest.json is content-hashed and
 * served as immutable.
 */
import { SHEET, type SheetSlot } from "./poster";

export const FORMAT_VERSION = 1;

export type Vec3 = [number, number, number];

/**
 * Coordinates: retail is Z-up, X forward, Y left. The baker writes Y-up with the
 * model facing +Z: (x, y, z) -> (y, z, x), and quaternions (x, y, z, w) ->
 * (y, z, x, w). That is a cyclic permutation, so handedness is preserved.
 *
 * Skeleton: joints are nodes named `b<index>` (retail bone index), with identity
 * rest transforms and identity inverse bind matrices, because retail vertices
 * are already in bind pose in model space. A sampled bone is
 *   T = pivot + translation - R * (S * pivot),  R = rotation,  S = scale.
 * So a stopped mixer is the bind pose ("T-Pose").
 */

export type ModelKind = "body" | "mount" | "item";

/** Stored per primitive in material.extras: each submesh has its own material. */
export interface SubmeshExtras {
  /** Stable id: `<submesh index>`. The Model Parts list keys off this. */
  hash: number;
  /** Geoset id = group*100 + value. */
  geoset: number;
  /**
   * Texture units in retail order. `tex` indexes ModelManifest.textures; -1 = none.
   * `uvSet`: 0 TEXCOORD_0, 1 TEXCOORD_1, 2 sphere map (the shader computes it). The
   * shader id implies it; retail models have no explicit UV-set table.
   */
  units: { tex: number; uvSet: number; wrapS: boolean; wrapT: boolean; uvAnim: number }[];
  /** Retail M2 batch shader id. */
  shader: number;
  /** Retail M2 blend mode: 0 opaque, 1 alpha key, 2 alpha, 3 no-alpha add, 4 add, 5 mod, 6 mod2x, 7 blend-add. */
  blend: number;
  /** Retail render flags: 1 unlit, 2 unfogged, 4 two-sided, 8 billboard, 16 no-depth-write. */
  flags: number;
  /** Batch priority plane, order within a submesh. */
  priority: number;
  /** Index into FxData.colors, -1 = none. */
  color: number;
  /** Index into FxData.opacity, -1 = none. */
  opacity: number;
}

export interface ClipEntry {
  /** `<animId>.<variation>`. */
  id: string;
  /** Name from AnimationData, e.g. "Stand". */
  name: string;
  animId: number;
  variation: number;
  durationMs: number;
  /** Retail sequence flag: the clip loops. */
  loops: boolean;
  /** GLB holding one animation over the `b<n>` nodes. Omitted key: clip not baked. */
  key: string;
  bytes: number;
}

export type TextureKind =
  | "static"      // hard-wired to a batch
  | "skin"        // type 1: composite
  | "hair"        // type 6
  | "fur"         // type 8
  | "eyes"        // type 19
  | "object"      // type 2 / item
  | "monster";    // type 11-13

export interface TextureEntry {
  /** Retail texture type: 0 hard-coded, 1 composite, 2 object, 6 hair, 8 fur, 11-13 monster, 19 eyes... */
  type: number;
  kind: TextureKind;
  /** Hashed KTX2. Empty when it is produced at runtime (type 1 composite). */
  key: string;
  bytes: number;
  width: number;
  height: number;
  alpha: boolean;
  /** Source file, when there is one. */
  fileDataId?: number;
}

/** A layer drawn into the runtime composite for a body. */
export interface CompositeLayer {
  /** ChrModelTextureLayer order. */
  layer: number;
  /** Target texture type (usually 1). */
  targetType: number;
  /** Rect in the target, pixels. */
  rect: { x: number; y: number; w: number; h: number };
  /** 0/1 copy, 9/15 alpha, 4 multiply, 6 overlay, 7 screen. */
  blend: number;
  key: string;
  bytes: number;
}

export interface Attachment {
  id: number;
  bone: number;
  position: Vec3;
}

export interface ModelManifest {
  formatVersion: number;
  id: string;
  kind: ModelKind;
  name: string;
  /** Pinned retail build this was baked from. */
  build: string;
  source: { m2: number; skin: number; skel?: number };
  /** Hashed GLB: geometry, skeleton, one primitive per submesh, no animations. */
  glb: { key: string; bytes: number };
  /** Hashed JSON of FxData. */
  fx?: { key: string; bytes: number };
  /** Hashed .phys payload. */
  phys?: { key: string; bytes: number };
  /** Computed from the mesh: retail headers can't be trusted. */
  bounds: { min: Vec3; max: Vec3 };
  boneCount: number;
  /**
   * Bone pivots, flat xyz per retail bone index, in the baker's axes. Optional, but
   * without them a crossfade blends the baked translation T = pivot + t - R(S*pivot)
   * and limbs shrink mid-fade; with them the engine blends t and R about the pivot.
   */
  pivots?: number[];
  clips: ClipEntry[];
  /** ClipEntry.id to play first. */
  defaultClip: string;
  textures: TextureEntry[];
  /** Default-look geosets: visible at load. Every other submesh starts hidden. */
  defaultGeosets: number[];
  /** `textures` the default look reads. The rest are fetched when a geoset that needs them shows. Absent: all at load. */
  defaultTextures?: number[];
  /** Layers for the default look of a body. `sections`: rect of each component section, pixels; absent: retail's 2:1 layout. */
  composite?: {
    width: number;
    height: number;
    layers: CompositeLayer[];
    sections?: Record<number, { x: number; y: number; w: number; h: number }>;
  };
  attachments: Attachment[];
  /** Keys of retail bone indices used as named reference points, e.g. ground. */
  groundBone?: number;
  /**
   * The display's ParticleColor, for emitters whose colorIndex is 11..13: start, mid and
   * end RGB 0..255 in place of the emitter's own colour curve. Absent: none applies.
   */
  particleColors?: Record<number, [Vec3, Vec3, Vec3]>;
  /** Hashed JSON of CustomizationData (./look): fetched when the Customization tab opens or a link names a look. */
  customization?: { key: string; bytes: number };
  /** A body's first look, option id -> choice id: what defaultGeosets, composite and textures show. */
  look?: Record<number, number>;
  /** The first look's face bones (`.bone`), [bone, 16 numbers column-major, baker's axes]: multiplied onto the posed bone. */
  boneSet?: [number, number[]][];
  /** The first look wears skinned parts or a glow: customization is fetched with the model, not when the tab opens. */
  lookHasParts?: boolean;
  /** A bake never hides a problem: anything skipped is listed. */
  warnings: string[];
  /**
   * Retail's name hash of each bone, by retail bone index. A collection shares a body's
   * skeleton through these: one GLB per file, whichever body wears it.
   */
  boneCrcs?: number[];
  /** A mount: CreatureDisplayInfo.CreatureModelScale x CreatureModelData.ModelScale. A rider is scaled by 1 / this. */
  displayScale?: number;
}

/**
 * One animated value in FxData. `clips` maps a ClipEntry.id, or "*" for any clip,
 * to [timesMs, values]; a value is a number or a number[] of the track's stride.
 * `globalLoop` indexes FxData.globalLoops: such a track runs on wall time modulo
 * the loop and ignores the clip. Absent tracks are constant.
 */
export interface FxTrack {
  globalLoop?: number;
  clips: Record<string, [number[], (number | number[])[]]>;
  /** Interpolation 0: a value holds until the next key. Absent: linear. */
  hold?: boolean;
}
/** FxData.colors[i]: rgb 0..1, alpha 0..1. */
export interface FxColor {
  color?: FxTrack;
  alpha?: FxTrack;
}
/** FxData.uvAnims[i]: translation xyz, rotation quaternion xyzw, scale xyz, about (.5, .5). */
export interface FxUvAnim {
  translation?: FxTrack;
  rotation?: FxTrack;
  scale?: FxTrack;
}

export interface FxData {
  globalLoops: number[];
  /** Keyed tracks as [timesMs, values] per clip id; keep small, sampled when needed. */
  colors: unknown[];
  opacity: unknown[];
  uvAnims: unknown[];
  /** FxParticle[]. Empty for a model with no emitters. */
  particles: unknown[];
  /** FxRibbon[]. Empty for a model with no ribbons. */
  ribbons: unknown[];
}

/** A value almost every emitter holds constant: the plain value, or a track when it moves. */
export type FxValue = number | number[] | FxTrack;

/**
 * A curve over one particle's life. `t` runs 0..1. Retail's reading rule applies: with
 * two values the times are ignored, with three only the middle one counts.
 */
export interface FxLifeCurve {
  t: number[];
  v: (number | number[])[];
}

/**
 * One retail M2Particle. Vectors marked `retail axes` stay in Z-up, because the same
 * numbers mean world axes for a world-space emitter and the emitter's own for a local
 * one (flag 0x10). A missing field takes the default in its comment.
 */
export interface FxParticle {
  /** Retail M2Particle flags, unchanged. */
  flags: number;
  bone: number;
  /** The baker's axes, model space, bind pose. */
  pos: Vec3;
  /** 1 plane, 2 sphere, 3 spline. */
  type: number;
  /** Retail blend 0..7, the batch enum. */
  blend: number;
  /** ModelManifest.textures: one, or three for a multi-texture emitter. */
  tex: number[];
  /** M2 texture flags per `tex`: 1 wrap S, 2 wrap T. */
  wrap: number[];
  /** Flipbook. Default 1. */
  rows?: number;
  cols?: number;
  /** PGD1: active only while this geoset shows. Default 0, always active. */
  geoset?: number;
  /** 11..13 take a display's ParticleColor. Default 0. */
  colorIndex?: number;
  /** Retail priority plane. Default 0. */
  priority?: number;
  speed?: FxValue;
  speedVar?: FxValue;
  lat?: FxValue;
  lon?: FxValue;
  /** A number g is (0, 0, -g). A vec3 is added to velocity as it stands, retail axes. */
  gravity?: FxValue;
  life?: FxValue;
  lifeVar?: number;
  rate?: FxValue;
  rateVar?: number;
  /** Plane size, sphere radii, spline span. */
  width?: FxValue;
  length?: FxValue;
  zsource?: FxValue;
  /** Above 0 emits. Default 1. */
  visible?: FxValue;
  /** RGB 0..255. */
  color: FxLifeCurve;
  /** 0..1, with EXP2 alphaMult already in. */
  alpha: FxLifeCurve;
  /** XY half sizes. */
  scale: FxLifeCurve;
  /** Flipbook cells. */
  head?: FxLifeCurve;
  tail?: FxLifeCurve;
  /** EXP2 alpha cutoff, 0..1. Absent when it cuts nothing. */
  cut?: FxLifeCurve;
  scaleVar?: [number, number];
  tailLength?: number;
  /** FPS, on-off fraction, scale min, scale max. Default [10, 1, 1, 1]. */
  twinkle?: [number, number, number, number];
  /** Inherited velocity's scale. Default 1. */
  inherit?: number;
  drag?: number;
  /** Initial, initial variation, rate, rate variation, in the client's reading. */
  spin?: [number, number, number, number];
  /** x, y, z in retail axes, and the age it stops at. */
  wind?: [number, number, number, number];
  /** speed1, scale1, speed2, scale2. */
  follow?: [number, number, number, number];
  /** Spline control points, retail axes. */
  spline?: number[];
  /** Flag 0x10000000: t0 x t1 x t2. Layers 1 and 2 of `scale`, `p0`, `p1`. */
  multi?: {
    mat: number;
    scale: [number, number];
    p0: [number, number, number, number];
    p1: [number, number, number, number];
    colorMult: number;
  };
}

/** One retail M2Ribbon. */
export interface FxRibbon {
  bone: number;
  /** The baker's axes. */
  pos: Vec3;
  /** ModelManifest.textures. Three or more: one pass, t0 x t1 x t2. Else one pass per texture. */
  tex: number[];
  /** M2 texture flags per `tex`: 1 wrap S, 2 wrap T. */
  wrap: number[];
  /** Per pass: retail blend and material flags. */
  mats: { blend: number; flags: number }[];
  /** RGB 0..1. */
  color?: FxValue;
  alpha?: FxValue;
  above?: FxValue;
  below?: FxValue;
  edgesPerSec: number;
  lifetime: number;
  gravity?: number;
  rows?: number;
  cols?: number;
  slot?: FxValue;
  visible?: FxValue;
  priority?: number;
  /** Texture transforms of a three-texture ribbon: per layer scale xy, scroll speed xy. */
  layers?: { scale: [number, number]; speed: [number, number] }[];
}

export interface CatalogEntry {
  /** Used in URLs: `human-male`, `mount-1234`. */
  id: string;
  name: string;
  /** Hashed WebP paths; empty string falls back to /placeholder.webp. */
  circle: string;
  tile: string;
  /** Hashed WebP of the model, framed as its grid cell frames it, transparent. Absent: not baked yet, the page draws it. */
  poster?: string;
  /** The same on a female body, where a poster depends on the body worn. Absent: `poster` stands for both. */
  posterFemale?: string;
  /** Its place in a page's sheet, when one is baked: one read for a whole page of cards. */
  sheet?: SheetSlot;
  sheetFemale?: SheetSlot;
  /** Present when baked. An entry without a model is not listed by the site. */
  model?: string;
  group?: string;
  description?: string;
  /** Build it first appeared in, for "Latest Additions". */
  addedIn?: string;
}

export interface RaceEntry extends CatalogEntry {
  raceId: number;
  faction?: "Alliance" | "Horde" | "Neutral";
  bodies: CatalogEntry[];
}

export interface Catalog {
  formatVersion: number;
  build: string;
  generatedAt: string;
  races: RaceEntry[];
  mounts: CatalogEntry[];
  items: CatalogEntry[];
  /** Transmog sets. Absent in a catalogue from before sets were baked. Empty once `setShards` carries them. */
  sets?: SetEntry[];
  /** The item lines, for the source chips: only rows that passed the bake count. */
  lines?: LineInfo[];
  /** Items by line and slot, fetched when browsed: tens of thousands of rows never load at once. */
  itemShards?: ItemShardRef[];
  /** Sets by line, fetched when the Sets tab opens. */
  setShards?: { line: string; key: string; count: number }[];
  /** Mount families, at `paths.mounts()`, fetched by the Mounts page. `mounts` holds only a few for the home page. */
  mountCount?: number;
}

export interface LineInfo {
  id: string;
  title: string;
  items: number;
  sets: number;
}

export interface ItemShardRef {
  line: string;
  slot: SlotId;
  key: string;
  count: number;
  /** Armour facets present, so a chip shows only what exists. */
  facets: string[];
}

/**
 * One shard row: retail display id, name, icon's object hash, facet, in-game entry (0: unknown),
 * the rare bodies it cannot show on, and the posters' object hashes, male then female.
 * A weapon stands alone, so it has only the first. `notOn` is null when a poster follows it.
 */
export type ItemRow = [display: number, name: string, icon: string, facet: string, entry: number, notOn?: string[] | null, poster?: string, posterFemale?: string];

export interface ItemShard {
  line: string;
  slot: SlotId;
  rows: ItemRow[];
  /** The sheets of its rows' posters, one per `SHEET.count` rows, by object hash. Empty: none for those rows. */
  sheets?: { male: string[]; female?: string[] };
}

/** Expands a shard row into the entry the browser works with. */
export function itemOfRow(row: ItemRow, line: string, slot: SlotId, index = 0, sheets?: ItemShard["sheets"]): ItemEntry {
  const [display, name, icon, facet, entry, notOn, poster, posterFemale] = row;
  const page = Math.floor(index / SHEET.count);
  const at = index % SHEET.count;
  const male = poster ? sheets?.male[page] : "";
  const female = posterFemale || poster ? sheets?.female?.[page] : "";
  const id = `item-${display}`;
  const key = icon ? `objects/${icon}.webp` : "";
  return {
    id, name, circle: key, tile: "", model: paths.item(id), slot, line, icon: key,
    ...(facet ? { facet } : {}), ...(entry ? { entry } : {}), ...(notOn?.length ? { notOn } : {}),
    ...(poster ? { poster: `objects/${poster}.webp` } : {}), ...(posterFemale ? { posterFemale: `objects/${posterFemale}.webp` } : {}),
    ...(male ? { sheet: [male, at] as SheetSlot } : {}), ...(female ? { sheetFemale: [female, at] as SheetSlot } : {}),
  };
}

export interface SearchRow {
  /** name */
  n: string;
  /** id */
  i: string;
  /** group: race, body, mount, item, set */
  g: "race" | "body" | "mount" | "item" | "set";
  /** circle key */
  c: string;
}

/**
 * Eclipse's slot ring, in the game's own order (src/eclipse/ui/UiMorph.cpp): one
 * column down each side of the figure and the weapons under its feet.
 */
export type SlotId =
  | "head" | "shoulder" | "back" | "chest" | "shirt" | "tabard" | "wrist"
  | "hands" | "waist" | "legs" | "feet"
  | "mainhand" | "offhand" | "ranged";

export const SLOT_RING: { left: SlotId[]; right: SlotId[]; bottom: SlotId[] } = {
  left: ["head", "shoulder", "back", "chest", "shirt", "tabard", "wrist"],
  right: ["hands", "waist", "legs", "feet"],
  bottom: ["mainhand", "offhand", "ranged"],
};

/** What a slot wears: one catalogue row in the Items or Sets browser. */
export interface ItemEntry extends CatalogEntry {
  slot: SlotId;
  /** Item line, e.g. "midnight", "warwithin". */
  line: string;
  /** Hashed WebP of the game's icon. */
  icon: string;
  /** Armour facet: cloth, leather, mail, plate, or none. */
  facet?: string;
  /** The item's entry id as the game's wardrobe knows it: what an `ECA1:` code stores. Absent: the DLL has no such row. */
  entry?: number;
  /** Bodies no cut and no close donor can draw this on: hidden there, never shown broken. */
  notOn?: string[];
}

/** One look of a mount family: a row of the game's MountXDisplay, and nothing else. */
export interface MountVariant {
  /** Model id of this display. */
  id: string;
  /** Retail CreatureDisplayInfo id. */
  display: number;
  name: string;
  /** Hashed WebP of the mount's spell icon. */
  icon: string;
  /** Hashed WebP of this look in its grid cell. Absent: not baked yet. */
  poster?: string;
  mountId: number;
  /** The display id the game's morph takes, when the DLL has this look. */
  entry?: number;
}

/** A mount as Eclipse lists it: one row per animal (model file), its colours as variants. */
export interface MountEntry extends CatalogEntry {
  mountId: number;
  /** Mount.MountTypeID says it flies. */
  flying: boolean;
  variants: MountVariant[];
}

export interface SetEntry extends CatalogEntry {
  line: string;
  /** Slot -> ItemEntry.id. Wearing a set replaces the whole look. */
  pieces: Partial<Record<SlotId, string>>;
  /** Each piece's icon key, so a card and the ring need no item shard loaded. */
  icons?: Partial<Record<SlotId, string>>;
  /** Each piece's name, for the ring's tips. */
  names?: Partial<Record<SlotId, string>>;
}

/**
 * A wearable: the parts of one item display, resolved for one body at runtime.
 * Attached models hang on `attachments[n].id`; collections share the body's
 * skeleton by bone name; body textures draw into the composite.
 */
export interface ItemManifest {
  formatVersion: number;
  id: string;
  slot: SlotId;
  /**
   * Models pinned to a body attachment (helm, shoulders, weapons, sheath).
   * `manifest` is a model id. `handFlags`: ItemDisplayInfo.Flags & 0x1D00, the
   * mirror and turn bits of a hand item. `sheath`: its transform on a sheath point,
   * column-major, in the baker's axes. `sheathPoints`: where it rests per hand
   * [main, off], from Item.SheatheType; absent: it is stowed nowhere.
   */
  attached: AttachedPiece[];
  /**
   * When pieces differ per body (helms and shoulders are cut per race and sex): the
   * list for each body id, used in place of `attached`. Absent: `attached` for all.
   */
  attachedBy?: Record<string, AttachedPiece[]>;
  /**
   * Skinned pieces by body id or race/sex key, falling back as retail does. `donor`: no
   * cut in the body's retail chain, so this names another body's file. A reference to a
   * file already baked, never a copy.
   */
  collections: Record<string, { manifest: string; donor?: string }>;
  /**
   * Body-texture pieces: section -> texture, drawn in the runtime composite. `sex`
   * present: for that sex only (0 male, 1 female). Absent: both.
   */
  bodyLayers: { section: number; key: string; bytes: number; sex?: number }[];
  /** What the item puts on the body's own texture slots, by type: a cloak's is type 2, on geoset 15xx. */
  bodyTextures?: { type: number; key: string; bytes: number; width: number; height: number; alpha: boolean }[];
  /** Geoset rules: group -> value, retail's GeosetGroup of this display. */
  geosetGroups: Record<number, number>;
  phys?: { key: string; bytes: number };
  /** Geoset rule pad bits (engine logic/retailGeo.ts PAD). Absent: 0. */
  pad?: number;
  /** Sections this item paints, as bits. Absent: read from bodyLayers. */
  regions?: number;
  /** 0x20 the chest suppresses the legs, 0x40 a guild tabard. */
  compFlags?: number;
  /** HelmetGeosetData: groups this helm hides, by body id, or "*" for any body. */
  helmetHide?: Record<string, number[]>;
  /** Used in place of `bodyLayers` by a body whose race retail paints differently. */
  bodyLayersBy?: Record<string, { section: number; key: string; bytes: number }[]>;
  /**
   * The ModelManifests of `attached`, `attachedBy` and `collections`, by id. An item has
   * dozens per race, and inline they cost one write and one fetch instead of dozens.
   */
  models?: Record<string, ModelManifest>;
  /** For a link that wears this item before any catalogue shard is loaded. */
  name?: string;
  icon?: string;
}

export interface AttachedPiece {
  attachment: number;
  manifest: string;
  handFlags?: number;
  sheath?: number[];
  sheathPoints?: [number, number];
  /** Set when this body's retail chain has no cut: the body this file was cut for. */
  donor?: string;
}

/** A set's pieces, fetched at `paths.set(id)`. Same shape as SetEntry.pieces. */
export interface SetManifest {
  formatVersion: number;
  id: string;
  pieces: Partial<Record<SlotId, string>>;
}

/**
 * One entry of `ui/sprites.json`, keyed by sprite name (`paths.ui(name)` is its file).
 * Sizes are in retail's 1x pixels; the file is `density` times that.
 */
export interface UiSprite {
  width: number;
  height: number;
  density: number;
  /** How far the sprite reaches past the frame it is drawn over, per side, in 1x pixels. */
  overhang: [number, number];
  /** Nine-slice inset, in 1x pixels. 0: not sliced. */
  slice: number;
  /** The sprite's measured colour, for lighting it or for drawing a white overlay. */
  tint: [number, number, number];
  /** The file is white with its intensity in alpha: draw it multiplied by `tint`, or any colour. */
  white: boolean;
  /** Columns and rows, for a flipbook played in order. */
  grid?: [number, number];
}

/** `ui/atlas.json`: where each sprite sits in `ui/atlas.webp`, in pixels of the file. */
export interface UiAtlas {
  width: number;
  height: number;
  sprites: Record<string, { x: number; y: number; w: number; h: number }>;
}

export const paths = {
  ui: (sprite: string) => `ui/${sprite}.webp`,
  sprites: () => `ui/sprites.json`,
  item: (id: string) => `items/${id}/manifest.json`,
  set: (id: string) => `sets/${id}/manifest.json`,
  manifest: (id: string) => `models/${id}/manifest.json`,
  /** The packed UI sprites and their map; scenes stay files of their own. */
  atlas: () => `ui/atlas.webp`,
  atlasMap: () => `ui/atlas.json`,
  itemShard: (line: string, slot: string) => `catalog/items/${line}-${slot}.json`,
  setShard: (line: string) => `catalog/sets/${line}.json`,
  mounts: () => `catalog/mounts.json`,
  usage: () => `reports/usage.json`,
  catalog: () => `catalog/catalog.json`,
  search: () => `catalog/search.json`,
  report: () => `reports/latest.json`,
};

export * from "./config";
export * from "./look";
export * from "./poster";
export * from "./geosets";

export function packUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, "")}/${key}`;
}
