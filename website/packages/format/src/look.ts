/**
 * A body's customization as data, and what a look draws. The same code runs in the
 * baker (the first look it writes into the manifest), the engine (every look after
 * that) and the tests, so the three can't disagree.
 *
 * The rules are Eclipse's, port for port: tools/races/races_spec.py load_tree,
 * tools/races/races_layers.py mats_of and src/eclipse/races/Races.cpp DrawnChoice,
 * LookInputsOf, EnsureParts and ApplyOurGeosets. "Unlock everything": whatever retail
 * authors for a body can be worn, and nothing a retail requirement would hide is
 * dropped, except its Transmog placeholders. A colour whose art doesn't fit the shape
 * worn draws the nearest one that does, so no pair of choices draws garbage.
 */

/** ChrCustomizationOption.Requirement set: unset until met, so its "None" comes first. Ours, above retail's ids. */
export const GATED_NONE = 0x7f000000;
/** ChrCustomizationReq.ReqType 3: any player of this body can pick it. */
export const REQ_ANY = 3;

export interface CustomChoice {
  id: number;
  name: string;
  /** SwatchColor_0 and _1 as #rrggbb, when retail shows this choice as a colour. */
  sw?: string[];
  /** ChrCustomizationReq.ReqType. */
  req: number;
  /** ChrCustomizationReq.ClassMask. 0 and -1: not kept for any class. */
  cls: number;
  /** ChrCustomizationChoice.Flags. Absent: 0. */
  flags?: number;
  /** ChrCustomizationReqChoice, as offered on this body: retail shows it while one of these is worn. */
  needs?: number[];
  /** [group, value, cond]: cond is another choice that must be worn, 0 for none. */
  geo?: [number, number, number][];
  /** [part, group, value, cond]: the same, on a skinned part of this body. */
  pgeo?: [number, number, number, number][];
  /** [target, texture, cond, emissive texture or -1], indices into CustomizationData.textures. */
  mat?: [number, number, number, number][];
  /** Index into CustomizationData.boneSets: the set retail authored for this body's model. */
  bone?: number;
  /** ChrCustItemGeoModify: [group, from, to], on the values a slot rule would show. */
  mod?: [number, number, number][];
  /** A posture: wearing this choice is wearing that body (ChrCustomizationCondModel). */
  body?: string;
}

export interface CustomOption {
  id: number;
  name: string;
  /** ChrCustomizationCategory id: its tab. */
  tab: number;
  /** ChrCustomizationOption.Requirement was set: its first choice is our "None". */
  gated?: boolean;
  choices: CustomChoice[];
}

export interface CustomTexture {
  /** Hashed KTX2. Empty only on a partial local bake (--tex-budget-mb); a cloud bake has them all. */
  key: string;
  bytes: number;
  width: number;
  height: number;
  alpha: boolean;
  fileDataId: number;
}

export interface CustomLayer {
  target: number;
  /** Rect on the canvas, pixels. */
  rect: { x: number; y: number; w: number; h: number };
  blend: number;
  /** 0 base, 1 pelvis, 2 torso: the underwear is never left off. */
  role: number;
  /** ChrModelTextureLayer's emissive blend. 0: the row's own. */
  emode?: number;
}

/** A texture the model draws by type, other than the composite: hair 6, eyes 19, fur 8... */
export interface CustomModelTexture {
  type: number;
  width: number;
  height: number;
  /** [target, blend], retail's order, each stretched over the whole texture. */
  layers: [number, number][];
}

export interface CustomPart {
  /** ModelManifest id of the skinned model. Its joints find this body's by retail name hash (boneCrcs). */
  manifest: string;
  /** Groups its choices decide. */
  owned: number[];
  /** Geoset ids its skin carries. */
  has: number[];
}

export interface CustomTab {
  id: number;
  name: string;
  order: number;
  /** ChrCustomizationCategory.CameraZoomLevel: >= 80 frames the head. */
  zoom: number;
}

export interface CustomizationData {
  formatVersion: number;
  id: string;
  chrModel: number;
  tabs: CustomTab[];
  options: CustomOption[];
  textures: CustomTexture[];
  /** Hashed JSON of BoneSetData, fetched when a choice wears it. */
  boneSets: { key: string; bytes: number; fileDataId: number }[];
  /** The composite's layers, retail's order. */
  layers: CustomLayer[];
  modelTextures: CustomModelTexture[];
  /** [target, texture]: a base layer no option of this body paints (the Gilnean's eyes). */
  baseMats: [number, number][];
  parts: CustomPart[];
  /** Groups the look decides on the body: Eclipse's `owned`. */
  owned: number[];
  /** Every geoset id the body's skin carries. */
  has: number[];
  /** Canvas of the composite. */
  width: number;
  height: number;
}

/** [bone, 16 numbers column-major in the baker's axes], later entries on top. */
export type BoneSetData = [number, number[]][];

/** Option id -> choice id. */
export type Look = Record<number, number>;

const worn = (look: Look, id: number): boolean => {
  for (const k in look) if (look[k] === id) return true;
  return false;
};

/** The choice a look wears for an option: its own, else the option's first. */
export function chosenOf(o: CustomOption, look: Look): CustomChoice | undefined {
  const id = look[o.id];
  return o.choices.find((c) => c.id === id) ?? o.choices[0];
}

/** Every option on a choice it really has: what a shared link is cleaned with. */
export function settleLook(options: readonly CustomOption[], look: Look): Look {
  const out: Look = {};
  for (const o of options) {
    const c = chosenOf(o, look);
    if (c) out[o.id] = c.id;
  }
  return out;
}

const CLASS_NAMES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Death Knight", "Shaman", "Mage", "Warlock", "Monk", "Druid", "Demon Hunter", "Evoker"];

/**
 * "Death Knight or Mage": the classes retail keeps a choice for, Races.cpp ClassTag.
 * Empty: anyone. One step off Eclipse: a mask of nearly every class (32735, every class
 * but a Death Knight, on 19 of Human male's 40 eye colours) names nobody, or Randomize
 * would never deal a normal eye.
 */
export function classTag(cls: number): string {
  if (!cls || cls === -1 || cls === 0xffffffff) return "";
  const names = CLASS_NAMES.filter((_n, b) => (cls >>> b) & 1);
  if (names.length === 0 || names.length > CLASS_NAMES.length / 2) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const sameNeeds = (a?: number[], b?: number[]): boolean => {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * The choice a look draws for an option. Retail offers some choices only while one of
 * their `needs` is worn: Human F's 57 hair colours are three families of one palette,
 * each painted for its own styles' UVs. Any colour may be picked with any style; one
 * whose family doesn't fit draws the colour at the same place in the family that
 * does. A straight colour on Curly Bob sampled the hair-clip corner of its texture,
 * black and grey, before this rule.
 */
export function drawnChoice(o: CustomOption, look: Look): CustomChoice | undefined {
  const c = chosenOf(o, look);
  if (!c || !c.needs?.length) return c;
  if (c.needs.some((n) => worn(look, n))) return c;
  let pos = 0;
  for (const x of o.choices) {
    if (x === c) break;
    if (sameNeeds(x.needs, c.needs)) pos++;
  }
  for (const f of o.choices) {
    if (!f.needs?.length || sameNeeds(f.needs, c.needs)) continue;
    if (!f.needs.some((n) => worn(look, n))) continue;
    const family = o.choices.filter((x) => sameNeeds(x.needs, f.needs));
    return family[Math.min(pos, family.length - 1)];
  }
  return c;
}

function elemsActive(c: CustomChoice, look: Look): boolean {
  for (const x of c.mat ?? []) if (!x[2] || worn(look, x[2])) return true;
  for (const x of c.geo ?? []) if (!x[2] || worn(look, x[2])) return true;
  for (const x of c.pgeo ?? []) if (!x[3] || worn(look, x[3])) return true;
  return false;
}

const hasArt = (c: CustomChoice): boolean => !!(c.mat?.length || c.geo?.length || c.pgeo?.length);

/** A real shape for colour option `colour`: art of its own, or some colour draws art for it. "None" is neither. */
function realShape(colour: CustomOption, shape: CustomChoice): boolean {
  if (hasArt(shape)) return true;
  return colour.choices.some((c) => c.mat?.some((x) => x[2] === shape.id) || c.geo?.some((x) => x[2] === shape.id) || c.pgeo?.some((x) => x[3] === shape.id));
}

/** Any element of `dep`'s choices is conditioned on a choice of `on`: Markings Color on Markings. */
function dependsOn(dep: CustomOption, on: CustomOption): boolean {
  const ids = new Set(on.choices.map((c) => c.id));
  return dep.choices.some((c) => c.mat?.some((x) => x[2] && ids.has(x[2])) || c.geo?.some((x) => x[2] && ids.has(x[2])) || c.pgeo?.some((x) => x[3] && ids.has(x[3])));
}

export interface LookPaint {
  /** Target -> texture index. */
  mats: Map<number, number>;
  /** Target -> emissive texture index: the art retail ships with what is drawn there. */
  emissive: Map<number, number>;
  /** Target -> swatch: a colour with no art for this shape colours the shape's own. */
  tints: Map<number, string>;
}

type PaintData = Pick<CustomizationData, "options" | "layers" | "baseMats">;

/** races_layers.mats_of and Races.cpp LookInputsOf: what is painted on each target. */
export function lookPaint(data: PaintData, look: Look): LookPaint {
  const { options } = data;
  const drawn = options.map((o) => drawnChoice(o, look));
  const drawnIds = new Set<number>();
  options.forEach((o, i) => {
    const id = drawn[i]?.id ?? look[o.id];
    if (id) drawnIds.add(id);
  });
  const m = new Map<number, number>(data.baseMats);
  for (const c of drawn) for (const x of c?.mat ?? []) if (!x[2] || drawnIds.has(x[2])) m.set(x[0], x[1]);

  // A SHAPE IS DRAWN WHATEVER ITS COLOUR OPTION SAYS. Left on "None", or on a colour
  // with no art for this shape, the colour option paints with its first choice that
  // has art for it. The option itself doesn't change.
  options.forEach((o, i) => {
    const cur = o.choices.find((c) => c.id === look[o.id]);
    if (!cur || elemsActive(cur, look)) return;
    let shaped = false;
    options.forEach((k, ki) => {
      if (shaped || ki === i || !dependsOn(o, k)) return;
      const oc = k.choices.find((c) => c.id === look[k.id]);
      if (oc) shaped = realShape(o, oc);
    });
    if (!shaped) return;
    const paints = (t: number) => !cur.mat?.length || cur.mat.some((y) => y[0] === t);
    for (const c of o.choices) {
      if (!elemsActive(c, look)) continue;
      for (const x of c.mat ?? []) if (x[2] ? drawnIds.has(x[2]) : paints(x[0])) m.set(x[0], x[1]);
      break;
    }
  });

  // A CHOICE WORN IS DRAWN. A choice whose art for a target waits on choices not worn
  // draws its first, as long as the option it waits on wears a real choice, and not
  // where that choice paints underneath: a face is an overlay on the skin, and with a
  // skin retail has no face art for, the skin's own face shows.
  const layerOf = (t: number) => data.layers.find((l) => l.target === t);
  const covers = (under: number, over: number) => {
    const u = layerOf(under);
    const v = layerOf(over);
    return !!u && !!v && u !== v && u.rect.x <= v.rect.x && u.rect.y <= v.rect.y && u.rect.x + u.rect.w >= v.rect.x + v.rect.w && u.rect.y + u.rect.h >= v.rect.y + v.rect.h;
  };
  for (const o of options) {
    const c = o.choices.find((x) => x.id === look[o.id]);
    for (const x of c?.mat ?? []) {
      if (!x[2] || m.has(x[0])) continue;
      if (c!.mat!.some((y) => y[0] === x[0] && (!y[2] || drawnIds.has(y[2])))) continue;
      let real = false;
      let under = false;
      for (const k of options) {
        if (real) break;
        if (!k.choices.some((oc) => oc.id === x[2])) continue;
        const oc = k.choices.find((v) => v.id === look[k.id]);
        if (!oc) continue;
        real = hasArt(oc);
        for (const y of oc.mat ?? []) under ||= covers(y[0], x[0]);
      }
      if (real && !under) m.set(x[0], x[1]);
    }
  }

  // THE UNDERWEAR IS NEVER LEFT OFF. A skin that paints no underwear draws its option's
  // first: the cloth alone, no skin in it.
  for (const l of data.layers) {
    if ((l.role !== 1 && l.role !== 2) || m.has(l.target)) continue;
    for (const o of options) {
      if (!o.choices.some((c) => c.mat?.some((x) => x[0] === l.target))) continue;
      search: for (const c of o.choices) {
        for (const x of c.mat ?? []) {
          if (x[0] === l.target && (!x[2] || drawnIds.has(x[2]))) {
            m.set(l.target, x[1]);
            break search;
          }
        }
      }
      break;
    }
  }

  const emissive = new Map<number, number>();
  for (const o of options) {
    for (const c of o.choices) {
      for (const x of c.mat ?? []) {
        if (x[3] >= 0 && m.get(x[0]) === x[1] && !emissive.has(x[0])) emissive.set(x[0], x[3]);
      }
    }
  }

  // EVERY COLOUR PAINTS EVERY SHAPE. A colour with no art for the worn shape colours it.
  const tints = new Map<number, string>();
  options.forEach((o, i) => {
    const cur = chosenOf(o, look);
    if (!cur?.sw?.[0] || elemsActive(cur, look)) return;
    options.forEach((k, ki) => {
      if (ki === i || !dependsOn(o, k)) return;
      const shape = chosenOf(k, look);
      if (!shape || !realShape(o, shape)) return;
      const targets = new Set<number>();
      for (const c of o.choices) for (const x of c.mat ?? []) targets.add(x[0]);
      for (const t of targets) {
        const d = m.get(t);
        if (d === undefined || tints.has(t)) continue;
        const mine = shape.mat?.some((x) => x[0] === t && x[1] === d) || o.choices.some((c) => c.mat?.some((x) => x[0] === t && x[1] === d && x[2] === shape.id));
        if (mine) tints.set(t, cur.sw![0]!);
      }
    });
  });
  return { mats: m, emissive, tints };
}

/** Retail's per-group {naked default, equipped default}, RetailGeo.h kDefault. */
export const GROUP_DEFAULT: readonly (readonly [number, number])[] = [
  [1, 1], [1, 1], [1, 1], [0, 1], [1, 1], [0, 1], [1, 1], [1, 2], [1, 1], [0, 1], [1, 1], [0, 1],
  [1, 1], [0, 1], [0, 0], [1, 1], [0, 0], [0, 0], [1, 1], [1, 1], [0, 1], [1, 1], [1, 1], [1, 1],
  [0, 0], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [0, 0], [0, 0], [1, 2], [0, 1], [0, 1], [0, 0],
  [0, 0], [0, 0], [0, 1], [0, 0], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
  [0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1],
];

/** The groups a slot rule writes on the body, Races.cpp kItemGroups. */
const ITEM_GROUPS = [4, 5, 8, 9, 10, 11, 12, 13, 15, 18];
/** Eclipse's `owned` before the options add theirs. 14 is the Demon Hunter's loincloth, which every body carries. */
export const OWNED_BASE = [0, 7, 14, 17, 22, 32, 33, 51, 60];

type GeoData = Pick<CustomizationData, "options" | "parts" | "owned" | "has">;

/** What wearing this look shows on the body, nothing worn over it: ApplyOurGeosets. */
export function lookGeosets(data: GeoData, look: Look): Set<number> {
  const has = new Set(data.has);
  const want = new Map<number, number>();
  const modified = (group: number, value: number): number => {
    for (const o of data.options) {
      const m = chosenOf(o, look)?.mod?.find((x) => x[0] === group && x[1] === value);
      if (m) return m[2];
    }
    return value;
  };
  want.set(22, Math.max(0, modified(22, GROUP_DEFAULT[22]![1])));
  want.set(32, 2);
  if (has.has(702)) want.set(7, 2);
  else if (has.has(701)) want.set(7, 1);
  for (const o of data.options) {
    for (const g of chosenOf(o, look)?.geo ?? []) if (!g[2] || worn(look, g[2])) want.set(g[0], g[1]);
  }
  if (!want.has(33)) want.set(33, 1);
  if (!want.has(51) && has.has(5101)) want.set(51, 1);

  const out = new Set<number>([0]);
  const show = (id: number) => {
    if (id && has.has(id)) out.add(id);
  };
  const owned = new Set(data.owned);
  const partOwns = (g: number) => data.parts.some((p) => p.owned.includes(g));
  for (const g of owned) {
    if (g === 60) continue;
    const v = want.get(g);
    if (v) show(g === 0 ? v : g * 100 + v);
  }
  for (const g of ITEM_GROUPS) {
    if (owned.has(g) || partOwns(g)) continue;
    const v = modified(g, GROUP_DEFAULT[g]![1]);
    if (v > 0) show(g * 100 + v);
  }
  // Retail's feet: a choice's own foot shape (the Haranir's Clawed) replaces the bare one.
  let feet = Math.max(0, modified(20, GROUP_DEFAULT[20]![1]));
  const w20 = want.get(20);
  if (feet && w20 !== undefined && w20 > 1) feet = w20;
  if (feet) show(has.has(2000 + feet) ? 2000 + feet : 2001);
  // Every other group: above 2000, retail's x01 unless a part owns it; below, its equipped default.
  const seen = new Set<number>();
  for (const id of data.has) seen.add(Math.floor(id / 100));
  for (const g of seen) {
    if (g === 0 || g === 20 || owned.has(g) || ITEM_GROUPS.includes(g) || partOwns(g)) continue;
    const v = g > 20 ? 1 : GROUP_DEFAULT[g]?.[1] ?? 0;
    if (v) show(g * 100 + v);
  }
  return out;
}

/** What each skinned part shows: EnsureParts. A part with nothing to show isn't attached. */
export function lookParts(data: Pick<CustomizationData, "options" | "parts">, look: Look): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  data.parts.forEach((p, k) => {
    const want = new Map<number, number>();
    for (const o of data.options) {
      for (const x of chosenOf(o, look)?.pgeo ?? []) {
        if (x[0] !== k || (x[3] && !worn(look, x[3]))) continue;
        // An option on "None" never hides another option's shape. Value 0 shows
        // nothing, so it yields to a shown value; -1 still hides.
        if (x[2] === 0 && (want.get(x[1]) ?? -1) > 0) continue;
        want.set(x[1], x[2]);
      }
    }
    const has = new Set(p.has);
    const shown = new Set<number>();
    for (const g of p.owned) {
      const v = want.get(g);
      if (v === undefined || v < 0) continue;
      const id = g * 100 + v;
      if (id && has.has(id)) shown.add(id);
    }
    if (shown.size) out.set(k, shown);
  });
  return out;
}

/** The bone sets a look wears, a later option's on top. */
export function lookBoneSets(options: readonly CustomOption[], look: Look): number[] {
  const out: number[] = [];
  for (const o of options) {
    const b = chosenOf(o, look)?.bone;
    if (b !== undefined) out.push(b);
  }
  return out;
}

/**
 * Randomize, as Eclipse deals it: the race and sex stay, and every option is dealt
 * anew from what any player of that body can pick (requirement "any", no class kept),
 * so a random look is never a Death Knight's eyes, an NPC's face or an unlock. A
 * posture is a body, not a look, so it stays.
 */
export function randomLook(options: readonly CustomOption[], current: Look, rand: () => number = Math.random): Look {
  const out: Look = { ...current };
  for (const o of options) {
    if (o.choices.some((c) => c.body)) continue;
    const ok = o.choices.filter((c) => c.req === REQ_ANY && !classTag(c.cls));
    const c = ok.length ? ok[Math.floor(rand() * ok.length)] : undefined;
    if (c) out[o.id] = c.id;
  }
  return out;
}

/** The choices that differ from a default look, as `<option>.<choice>,...`: what a shared link holds. */
export function encodeLook(look: Look, defaults: Look): string {
  return Object.keys(look)
    .map(Number)
    .filter((o) => look[o] !== defaults[o])
    .sort((a, b) => a - b)
    .map((o) => `${o}.${look[o]}`)
    .join(",");
}

/** A shared link's look. Anything this body doesn't offer is dropped, never shown. */
export function decodeLook(text: string | null | undefined, options: readonly CustomOption[], defaults: Look): Look {
  const out: Look = { ...defaults };
  for (const part of (text ?? "").split(",")) {
    const [a, b] = part.split(".").map(Number);
    const o = options.find((x) => x.id === a);
    if (o && o.choices.some((c) => c.id === b)) out[a!] = b!;
  }
  return settleLook(options, out);
}
