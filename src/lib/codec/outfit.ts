// ECA1: the loadout code. A port of mo::Serialize and mo::Deserialize
// (wardrobe/Morph.cpp) and share::Decode (wardrobe/Share.cpp): the payload is
// exactly the plain text those write, so this file is the format's other half.
// Change them together.
import { base64Decode, base64Encode } from "./base64";

export const OUTFIT_TAG = "ECA1:";

const SLOT_COUNT = 19; // morph::kSlotCount
const SHEATHE_POSITIONS = 4; // morph::kSheathePos_Count
const COLOUR_AXES = 5; // ccol::kAxisCount
const TINT_SLOTS = 14; // wcol::kSlotCount
const MOUNT_SLOTS = 2; // wcol::kMountSlots
const SKIN_SLOTS = 15; // skins::kSlotCount
const SKIN_PRESETS = 264; // skins::PresetCount() in the newest released build
const SKIN_PALETTES = 3;
const SKIN_PLACEMENTS = 5;
const ANY_RIDE = 1; // mo::kAnyRide: a mount look chosen with no mount
const MAX_COSMETICS = 16; // Outfit::kMaxCosmetics
const COSMETIC_MODES = 2; // sclr::kMode_COUNT

// An old code carries a photograph after the first '~', so the text may be
// large while the outfit never is.
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_PAYLOAD = 256 * 1024;

export interface Glow {
  id: number;
  managed: boolean;
  tint: boolean;
  colour: number;
}

/** Whether a hand wears an enchant of the look's own. Id 0 is none, and an unmanaged hand keeps whatever the weapon really has. */
export const enchanted = (g: Glow | null): g is Glow => g !== null && g.managed && g.id > 0;

export interface Tint {
  slot: number;
  item: number;
  hue: number;
  sat: number;
  light: number;
  dye: number;
}

export interface Cosmetic {
  target: number;
  /** The 18 numbers after the target, as written: floats must not reformat. */
  fields: string[];
  catalog: boolean;
}

export type Look =
  | {
      kind: "look";
      race: number;
      gender: number;
      skin: number;
      face: number;
      hairStyle: number;
      hairColour: number;
      facialHair: number;
    }
  | { kind: "rlook"; race: string; sex: "m" | "f"; line: string };

/**
 * skins::ParseLookLine's numbers after the slot, already clamped as the game clamps
 * them: item, preset, palette, placement, then 16 bytes and a hue.
 */
export interface Skin {
  slot: number;
  values: number[];
}

export interface Outfit {
  /** Morph slot -> item entry. 0 means the slot is deliberately hidden. */
  slots: Record<number, number>;
  display: number;
  mount: number;
  mountFly: number;
  mountHidden: boolean;
  sheathe: [number, number];
  glowKnown: boolean;
  glow: [Glow | null, Glow | null];
  scale: number;
  look: Look | null;
  /**
   * A classic `look` line written under an `rlook`: what a player without the race pack
   * wears instead (Morph.cpp Deserialize). `look` holds the rlook; this keeps the other.
   */
  fallback: Extract<Look, { kind: "look" }> | null;
  colorsKnown: boolean;
  colors: { axis: number; rgb: number }[];
  wtintKnown: boolean;
  gtintKnown: boolean;
  wtint: Tint[];
  mtintKnown: boolean;
  mtint: Tint[];
  skinKnown: boolean;
  skins: Skin[];
  mskinKnown: boolean;
  mskins: Skin[];
  cosmeticsKnown: boolean;
  cosmetics: Cosmetic[];
  /** Keys from a build newer than this file. Kept, so a re-copy loses nothing. */
  unknown: string[];
}

export type DecodeResult =
  | { ok: true; outfit: Outfit; warnings: string[] }
  | { ok: false; error: string };

export function emptyOutfit(): Outfit {
  return {
    slots: {},
    display: 0,
    mount: 0,
    mountFly: 0,
    mountHidden: false,
    sheathe: [0, 0],
    glowKnown: false,
    glow: [null, null],
    scale: 0,
    look: null,
    fallback: null,
    colorsKnown: false,
    colors: [],
    wtintKnown: false,
    gtintKnown: false,
    wtint: [],
    mtintKnown: false,
    mtint: [],
    skinKnown: false,
    skins: [],
    mskinKnown: false,
    mskins: [],
    cosmeticsKnown: false,
    cosmetics: [],
    unknown: [],
  };
}

const uint = (t: string | undefined): number | null =>
  t !== undefined && /^\d+$/.test(t) ? Number(t) : null;
const hex = (t: string | undefined): number | null =>
  t !== undefined && /^[0-9a-fA-F]{1,8}$/.test(t) ? parseInt(t, 16) & 0xffffff : null;
const clampByte = (v: number) => Math.min(v, 255);
const hex6 = (v: number) => v.toString(16).toUpperCase().padStart(6, "0");

/**
 * skins::ParseLookLine: `<tag> <slot> <item> <preset> <palette> <placement>` and 16
 * more, clamped as the game clamps them. Null: the game drops the line.
 */
function readSkin(parts: string[]): Skin | null {
  if (parts.length < 21) return null;
  const slot = Number(parts[1]);
  const u = parts.slice(2, 21).map(uint);
  if (!Number.isInteger(slot) || u.some((v) => v === null) || !u[0]) return null;
  const [item, preset, palette, placement, ...rest] = u as number[];
  const hue = rest[8] % 3600;
  const bytes = rest.map(clampByte);
  bytes[8] = hue;
  return {
    slot,
    values: [item, preset & 0xffff, palette < SKIN_PALETTES ? palette : 0, placement < SKIN_PLACEMENTS ? placement : 0, ...bytes],
  };
}

function readTint(parts: string[]): Tint | null {
  const n = parts.slice(1, 7).map(uint);
  if (n.length !== 6 || n.some((v) => v === null)) return null;
  const [slot, item, hue, sat, light, dye] = n as number[];
  if (!item) return null;
  return {
    slot,
    item,
    hue: hue % 3600,
    sat: clampByte(sat),
    light: clampByte(light),
    dye: clampByte(dye),
  };
}

const upsert = <T extends { slot: number }>(list: T[], t: T) => {
  const at = list.findIndex((x) => x.slot === t.slot);
  if (at >= 0) list[at] = t;
  else list.push(t);
};

// cosm <target> <catalog> <size> <fwd> <left> <up> <turn> <tilt> <roll>
//      <coloured> <mode> <hue> <sat> <light> <white> <winHue> <win> <feather> <scope>
function readCosmetic(parts: string[]): Cosmetic | null {
  if (parts.length !== 20) return null;
  const target = uint(parts[1]);
  const fields = parts.slice(2);
  if (!target || fields.some((f) => !Number.isFinite(Number(f)))) return null;
  const [catalog, scale] = fields;
  const coloured = uint(fields[8]);
  const mode = uint(fields[9]);
  const scope = uint(fields[17]);
  if (uint(catalog) === null || coloured === null) return null;
  if (!(Number(scale) > 0) || mode === null || mode >= COSMETIC_MODES) return null;
  if (scope === null || scope > 1) return null;
  return { target, fields, catalog: catalog !== "0" };
}

function readLook(line: string): Look | null {
  const parts = line.split(/\s+/);
  if (parts[0] === "rlook") {
    if (parts.length < 3 || (parts[2] !== "m" && parts[2] !== "f")) return null;
    return { kind: "rlook", race: parts[1], sex: parts[2], line };
  }
  const n = parts.slice(1, 8).map(uint);
  if (n.length !== 7 || n.some((v) => v === null)) return null;
  const [race, gender, skin, face, hairStyle, hairColour, facialHair] = n as number[];
  return {
    kind: "look",
    race: race & 0xff,
    gender: gender ? 1 : 0,
    skin: skin & 0xff,
    face: face & 0xff,
    hairStyle: hairStyle & 0xff,
    hairColour: hairColour & 0xff,
    facialHair: facialHair & 0xff,
  };
}

/** mo::Deserialize. A bad value is left out, as the game leaves it out. */
export function parseOutfit(text: string): {
  outfit: Outfit;
  recognised: number;
  warnings: string[];
} {
  const o = emptyOutfit();
  const warnings: string[] = [];
  let recognised = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/[\r ]+$/, "");
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];
    const a = uint(parts[1]);
    const b = uint(parts[2]);
    const flag = parts[1] !== undefined && parts[1] !== "0";
    let known = true;
    switch (key) {
      case "slot":
        if (a !== null && b !== null && a < SLOT_COUNT) o.slots[a] = b;
        break;
      case "display":
        if (a !== null) o.display = a;
        break;
      case "mount":
        if (a !== null) o.mount = a;
        break;
      case "mountfly":
        if (a !== null) o.mountFly = a;
        break;
      case "mounthidden":
        o.mountHidden = flag;
        break;
      case "glowok":
        o.glowKnown = flag;
        break;
      case "glow": {
        const colour = hex(parts[5]);
        if ((a === 0 || a === 1) && b !== null && colour !== null) {
          o.glow[a] = { id: b, managed: parts[3] !== "0", tint: parts[4] !== "0", colour };
        }
        break;
      }
      case "sheathe":
        if ((a === 0 || a === 1) && b !== null && b < SHEATHE_POSITIONS) o.sheathe[a] = b;
        break;
      case "scale": {
        const f = Number(parts[1]);
        if (Number.isFinite(f)) o.scale = f;
        break;
      }
      case "wcolok":
        o.wtintKnown = flag;
        break;
      case "gcolok":
        o.gtintKnown = flag;
        break;
      case "wcol": {
        const t = readTint(parts);
        if (t && t.slot < TINT_SLOTS) {
          upsert(o.wtint, t);
          // Slots 0..2 are the weapons (WeaponColorEngine.h).
          if (t.slot < 3) o.wtintKnown = true;
          else o.gtintKnown = true;
        }
        break;
      }
      case "mcolok":
        o.mtintKnown = flag;
        break;
      case "mcol": {
        const t = readTint(parts);
        if (t && t.slot < MOUNT_SLOTS) {
          upsert(o.mtint, t);
          o.mtintKnown = true;
        }
        break;
      }
      case "cosok":
        o.cosmeticsKnown = flag;
        break;
      case "cosm": {
        const c = readCosmetic(parts);
        if (c && o.cosmetics.length < MAX_COSMETICS) {
          o.cosmetics.push(c);
          o.cosmeticsKnown = true;
        }
        break;
      }
      case "ccolok":
        o.colorsKnown = flag;
        break;
      case "ccol": {
        const rgb = hex(parts[2]);
        if (a !== null && a < COLOUR_AXES && rgb !== null) {
          const at = o.colors.findIndex((c) => c.axis === a);
          if (at >= 0) o.colors[at] = { axis: a, rgb };
          else o.colors.push({ axis: a, rgb });
          o.colorsKnown = true;
        }
        break;
      }
      case "look":
      case "rlook": {
        const look = readLook(line);
        if (look?.kind === "look") {
          o.fallback = look;
          // An rlook already read is what the code means; this line stands under it.
          if (o.look?.kind !== "rlook") o.look = look;
        } else if (look) o.look = look;
        break;
      }
      case "skinok":
        o.skinKnown = flag;
        break;
      case "mskinok":
        o.mskinKnown = flag;
        break;
      case "skin":
      case "mskin": {
        const k = readSkin(parts);
        const slots = key === "skin" ? SKIN_SLOTS : MOUNT_SLOTS;
        if (k && k.values[1] >= SKIN_PRESETS) {
          // A preset from a newer build: kept whole, as the newer game wrote it.
          o.unknown.push(line);
          break;
        }
        if (k && k.slot >= 0 && k.slot < slots) {
          upsert(key === "skin" ? o.skins : o.mskins, k);
          if (key === "skin") o.skinKnown = true;
          else o.mskinKnown = true;
        }
        break;
      }
      default:
        known = false;
        o.unknown.push(line);
        warnings.push(`Kept a field this site does not know yet: ${key}`);
    }
    if (known) recognised += 1;
  }
  // MountTintsFollowSlots: a colour lives only with the mount it was chosen for.
  o.mtint = o.mtint.filter((t) => t.item === (t.slot ? o.mountFly : o.mount));
  // A mount look chosen with no mount goes to the mount that is there.
  o.mskins = o.mskins.flatMap((k) => {
    const held = k.slot ? o.mountFly : o.mount;
    if (k.values[0] === ANY_RIDE) return held ? [{ ...k, values: [held, ...k.values.slice(1)] }] : [k];
    return k.values[0] === held ? [k] : [];
  });
  return { outfit: o, recognised, warnings };
}

/** mo::Serialize: the same lines, in the same order, with the same widths. */
export function serializeOutfit(o: Outfit): string {
  const out: string[] = [];
  for (const [slot, item] of Object.entries(o.slots)) out.push(`slot ${slot} ${item}`);
  if (o.display) out.push(`display ${o.display} 0`);
  if (o.mount) out.push(`mount ${o.mount}`);
  if (o.mountFly) out.push(`mountfly ${o.mountFly}`);
  if (o.mountHidden) out.push("mounthidden 1");
  o.sheathe.forEach((pos, hand) => {
    if (pos) out.push(`sheathe ${hand} ${pos}`);
  });
  if (o.glowKnown) out.push("glowok 1");
  o.glow.forEach((g, hand) => {
    if (g) {
      out.push(
        `glow ${hand} ${g.id} ${g.managed ? 1 : 0} ${g.tint ? 1 : 0} ${hex6(g.colour)}`,
      );
    }
  });
  if (o.scale > 0) out.push(`scale ${o.scale.toFixed(4)}`);
  // The classic line first, then the retail one it stands under (cc::Serialize, races::Serialize).
  const classic = o.look?.kind === "look" ? o.look : o.fallback;
  if (classic) {
    const l = classic;
    out.push(
      `look ${l.race} ${l.gender} ${l.skin} ${l.face} ${l.hairStyle} ${l.hairColour} ${l.facialHair}`,
    );
  }
  if (o.look?.kind === "rlook") out.push(o.look.line);
  if (o.colorsKnown) out.push("ccolok 1");
  for (const c of [...o.colors].sort((x, y) => x.axis - y.axis)) {
    out.push(`ccol ${c.axis} ${hex6(c.rgb)}`);
  }
  if (o.wtintKnown) out.push("wcolok 1");
  if (o.gtintKnown) out.push("gcolok 1");
  const tint = (key: string, t: Tint) =>
    `${key} ${t.slot} ${t.item} ${t.hue} ${t.sat} ${t.light} ${t.dye}`;
  for (const t of [...o.wtint].sort((x, y) => x.slot - y.slot)) out.push(tint("wcol", t));
  const skin = (key: string, k: Skin) => `${key} ${k.slot} ${k.values.join(" ")}`.slice(0, 127);
  if (o.skinKnown) out.push("skinok 1");
  for (const k of [...o.skins].sort((x, y) => x.slot - y.slot)) out.push(skin("skin", k));
  if (o.mskinKnown) out.push("mskinok 1");
  for (const k of [...o.mskins].sort((x, y) => x.slot - y.slot)) out.push(skin("mskin", k));
  if (o.mtintKnown) out.push("mcolok 1");
  for (const t of [...o.mtint].sort((x, y) => x.slot - y.slot)) out.push(tint("mcol", t));
  if (o.cosmeticsKnown) out.push("cosok 1");
  for (const c of o.cosmetics) out.push(`cosm ${c.target} ${c.fields.join(" ")}`);
  out.push(...o.unknown);
  return out.length ? `${out.join("\n")}\n` : "";
}

export function encodeOutfit(o: Outfit): string {
  return OUTFIT_TAG + base64Encode(serializeOutfit(o));
}

/** Does this look like one of ours? Lights the paste box up before a parse. */
export function looksLikeOutfitCode(text: string): boolean {
  return text.trimStart().slice(0, 5).toUpperCase() === OUTFIT_TAG;
}

/** share::Decode: trims, takes the tag in any case or not at all, cuts at '~'. */
export function decodeOutfit(text: string): DecodeResult {
  const notOne = "That is not an Eclipse loadout code. Copy it again with Share in the game.";
  const tooLong = "That text is too long to be a code.";
  if (text.length > MAX_TEXT) return { ok: false, error: tooLong };
  let s = text.trim();
  if (s.slice(0, 5).toUpperCase() === OUTFIT_TAG) s = s.slice(5);
  const cut = s.indexOf("~");
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/\s+/g, "");
  if (!s) return { ok: false, error: notOne };
  if (s.length > MAX_PAYLOAD) return { ok: false, error: tooLong };
  const body = base64Decode(s);
  if (!body) return { ok: false, error: notOne };
  const { outfit, recognised, warnings } = parseOutfit(body);
  // Stricter than the game, which wears nothing and says nothing: here a
  // person is looking at a form, and text with no field in it is a mistake.
  if (!recognised) return { ok: false, error: notOne };
  return { ok: true, outfit, warnings };
}
