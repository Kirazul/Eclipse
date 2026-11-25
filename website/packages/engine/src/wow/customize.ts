/**
 * One body's live customization. A choice changes the body in one step: everything it
 * needs (textures, the composite, a bone set, a skinned part) is fetched and drawn off
 * stage first, and handed over inside a single frame. Nothing is on screen half done,
 * and a newer choice abandons an older one that is still on the wire.
 */
import type { Texture, WebGLRenderTarget } from "three";
import {
  chosenOf,
  lookBoneSets,
  lookGeosets,
  lookPaint,
  lookParts,
  packUrl,
  settleLook,
  type BoneSetData,
  type CustomizationData,
  type Look,
} from "@eclipse/format";
import { fetchBytes, fetchJson, isAbort } from "../net/fetchPack";
import { ModelAssets, type LoadEnv } from "../model/assets";
import { Figure } from "../model/figure";
import { parseTexture } from "../model/loaders";
import type { CompositeRenderer, DrawnLayer } from "./composite";
import { rebindCollection } from "./outfit";

export interface LookHost {
  composer: CompositeRenderer;
  anisotropy(): number;
  /** Programs compiled, textures uploaded, for what isn't on stage yet. */
  prepare(figure: Figure): Promise<void>;
  /** Runs `op` inside the next frame; resolves when that frame has been drawn. */
  applyAtomically(op: () => void): Promise<void>;
  /** What the outfit shows over the look's own: worked out now, off stage. */
  overOutfit(): { visible: Set<number>; composite: Texture | null } | null;
  /** The look on stage changed. */
  changed(look: Look): void;
}

/** Decoded KTX2 textures kept for an instant step back. A body's customization has hundreds. */
const KEEP_TEXTURES = 64;
const KEEP_TARGETS = 4;

/** What a look is, resolved into things the GPU has. */
interface Prepared {
  look: Look;
  geosets: Set<number>;
  layers: DrawnLayer[];
  layerKey: string;
  modelTextures: { type: number; layers: DrawnLayer[]; width: number; height: number; key: string }[];
  /** The glow's layers, RaceComposite.h ComposeEmissive. Empty: no glow armed. */
  emissive: DrawnLayer[];
  emissiveKey: string;
  bones: BoneSetData[];
  parts: Map<number, Set<number>>;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

export class Customizer {
  data: CustomizationData | null = null;
  look: Look | null;
  private dataPromise: Promise<CustomizationData | null> | null = null;
  private readonly textures = new Map<number, { promise: Promise<Texture>; used: number; texture?: Texture }>();
  private readonly boneSets = new Map<number, Promise<BoneSetData>>();
  private readonly partFigures = new Map<number, Promise<Figure>>();
  private readonly attached = new Map<number, Figure>();
  private readonly targets = new Map<string, WebGLRenderTarget>();
  private tick = 0;
  private seq = 0;
  private disposed = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly body: Figure,
    private readonly env: LoadEnv,
    private readonly host: LookHost,
  ) {
    this.look = body.assets.manifest.look ?? null;
  }

  /** The tree is fetched once, the first time anything asks. */
  load(): Promise<CustomizationData | null> {
    this.dataPromise ??= (async () => {
      const ref = this.body.assets.manifest.customization;
      if (!ref) return null;
      const data = await fetchJson<CustomizationData>(packUrl(this.env.base, ref.key), {
        signal: this.abort.signal,
        priority: "high",
        expected: ref.bytes,
      });
      this.data = data;
      return data;
    })();
    return this.dataPromise;
  }

  private texture(index: number, data: CustomizationData): Promise<Texture> {
    const hit = this.textures.get(index);
    if (hit) {
      hit.used = ++this.tick;
      return hit.promise;
    }
    const entry = data.textures[index]!;
    const load = async (): Promise<Texture> => {
      const bytes = await fetchBytes(packUrl(this.env.base, entry.key), { signal: this.abort.signal, priority: "high", expected: entry.bytes });
      const texture = await parseTexture(this.env.renderer, bytes, this.host.anisotropy());
      if (this.disposed) {
        texture.dispose();
        throw new DOMException("disposed", "AbortError");
      }
      record.texture = texture;
      this.env.renderer.initTexture(texture);
      return texture;
    };
    const record: { promise: Promise<Texture>; used: number; texture?: Texture } = { used: ++this.tick, promise: Promise.resolve(null as unknown as Texture) };
    record.promise = load();
    record.promise.catch(() => this.textures.delete(index));
    this.textures.set(index, record);
    return record.promise;
  }

  private boneSet(index: number, data: CustomizationData): Promise<BoneSetData> {
    let p = this.boneSets.get(index);
    if (!p) {
      const set = data.boneSets[index]!;
      p = set.key ? fetchJson<BoneSetData>(packUrl(this.env.base, set.key), { signal: this.abort.signal, priority: "high", expected: set.bytes }) : Promise.resolve([]);
      this.boneSets.set(index, p);
    }
    return p;
  }

  /** A skinned part of this body: its joints are the body's, and its textures. */
  private part(index: number, data: CustomizationData): Promise<Figure> {
    let p = this.partFigures.get(index);
    if (!p) {
      const ref = data.parts[index]!;
      p = this.loadPart(ref.manifest);
      this.partFigures.set(index, p);
    }
    return p;
  }

  private async loadPart(id: string): Promise<Figure> {
    const assets = await ModelAssets.load(id, this.env, { signal: this.abort.signal });
    const figure = new Figure(assets, { layer: 1 });
    rebindCollection(figure, this.body);
    this.body.followedBy(figure);
    return figure;
  }

  /** Everything a look needs, in memory. It doesn't change anything on screen. */
  private async gather(data: CustomizationData, wanted: Look): Promise<Prepared> {
    const look = settleLook(data.options, wanted);
    const paint = lookPaint(data, look);
    const pick = (index: number | undefined): Promise<Texture> | null => {
      if (index === undefined) return null;
      return data.textures[index]?.key ? this.texture(index, data) : null;
    };

    const layerJobs = data.layers.map(async (row, i) => {
      const index = paint.mats.get(row.target);
      const t = pick(index);
      if (!t) return null;
      const tint = paint.tints.get(row.target);
      const layer: DrawnLayer = { rect: row.rect, blend: row.blend, texture: await t, ...(tint ? { tint: hexToRgb(tint) } : {}) };
      return { layer, key: `${i}:${index}${tint ?? ""}` };
    });
    const mtJobs = data.modelTextures.map(async (mt) => {
      const rows = await Promise.all(
        mt.layers.map(async ([target, blend]) => {
          const index = paint.mats.get(target);
          const t = pick(index);
          return t ? { texture: await t, blend, index } : null;
        }),
      );
      const active = rows.filter((r): r is NonNullable<typeof r> => r !== null);
      return {
        type: mt.type,
        width: mt.width,
        height: mt.height,
        key: `${mt.type}|${active.map((a) => a.index).join(",")}`,
        layers: active.map((a) => ({ rect: { x: 0, y: 0, w: mt.width, h: mt.height }, blend: a.blend, texture: a.texture })),
      };
    });
    const boneJobs = lookBoneSets(data.options, look).map((i) => this.boneSet(i, data));
    const parts = lookParts(data, look);
    const partJobs = [...parts.keys()].map((i) => this.part(i, data));
    const [layers, modelTextures, bones] = await Promise.all([Promise.all(layerJobs), Promise.all(mtJobs), Promise.all(boneJobs), Promise.all(partJobs)]);
    const drawn = layers.filter((l): l is NonNullable<typeof l> => l !== null);

    // A layer with glow art blends it into the channel; any drawn layer after the first
    // of those erases what is under it, by its own alpha.
    const emissive: DrawnLayer[] = [];
    let emissiveKey = "";
    if (paint.emissive.size) {
      let begun = false;
      for (const row of data.layers) {
        const glow = paint.emissive.get(row.target);
        const t = pick(glow);
        if (t) {
          emissive.push({ rect: row.rect, blend: row.emode || row.blend, texture: await t, emissive: true });
          emissiveKey += `|g${glow}`;
          begun = true;
        } else if (begun) {
          const index = paint.mats.get(row.target);
          const art = pick(index);
          if (art) {
            emissive.push({ rect: row.rect, blend: 10, texture: await art, emissive: true });
            emissiveKey += `|e${index}`;
          }
        }
      }
    }
    return {
      look,
      geosets: lookGeosets(data, look),
      layers: drawn.map((l) => l.layer),
      layerKey: drawn.map((l) => l.key).join("|"),
      modelTextures,
      emissive,
      emissiveKey,
      bones,
      parts,
    };
  }

  /** Fills the cache for a look without showing it: a hovered choice's click is then instant. */
  async prefetch(wanted: Look): Promise<void> {
    const data = await this.load();
    if (!data || this.disposed) return;
    try {
      await this.gather(data, wanted);
    } catch (err) {
      if (!isAbort(err)) console.warn("[eclipse] prefetch failed:", err);
    }
  }

  private target(key: string, width: number, height: number, layers: readonly DrawnLayer[], repeat = false): WebGLRenderTarget {
    const hit = this.targets.get(key);
    if (hit) {
      this.targets.delete(key);
      this.targets.set(key, hit);
      return hit;
    }
    const made = this.host.composer.render(width, height, layers, this.host.anisotropy(), repeat);
    this.targets.set(key, made);
    return made;
  }

  /** Drawn into its own target, so this is safe at any moment: a look's composite and multi-layer textures. */
  private draw(data: CustomizationData, p: Prepared) {
    const composite = this.target(`1|${p.layerKey}`, data.width, data.height, p.layers);
    const modelTextures = new Map<number, Texture | null>();
    for (const mt of p.modelTextures) {
      if (mt.layers.length === 0) modelTextures.set(mt.type, null);
      else if (mt.layers.length === 1) modelTextures.set(mt.type, mt.layers[0]!.texture);
      else modelTextures.set(mt.type, this.target(mt.key, mt.width, mt.height, mt.layers, true).texture);
    }
    const glow = p.emissive.length ? this.target(`e${p.emissiveKey}`, data.width, data.height, p.emissive) : null;
    return { composite, modelTextures, glow };
  }

  private trim(keep: ReadonlySet<Texture>, keepTargets: ReadonlySet<WebGLRenderTarget>): void {
    if (this.textures.size > KEEP_TEXTURES) {
      const oldest = [...this.textures.entries()].filter(([, r]) => r.texture && !keep.has(r.texture)).sort((a, b) => a[1].used - b[1].used);
      for (const [i, r] of oldest.slice(0, this.textures.size - KEEP_TEXTURES)) {
        r.texture!.dispose();
        this.textures.delete(i);
      }
    }
    if (this.targets.size > KEEP_TARGETS) {
      for (const [k, rt] of this.targets) {
        if (this.targets.size <= KEEP_TARGETS) break;
        if (!keepTargets.has(rt)) {
          rt.dispose();
          this.targets.delete(k);
        }
      }
    }
  }

  /**
   * Wears a look. `onStage` false: the figure isn't in the scene yet, so it just takes
   * it, and joins already dressed.
   */
  async apply(wanted: Look, onStage = true): Promise<void> {
    const seq = ++this.seq;
    const data = await this.load();
    if (!data || this.disposed || seq !== this.seq) return;
    const p = await this.gather(data, wanted);
    if (this.disposed || seq !== this.seq) return;
    const added: Figure[] = [];
    for (const i of p.parts.keys()) {
      const f = await this.part(i, data);
      if (!this.attached.has(i)) added.push(f);
    }
    for (const f of added) await this.host.prepare(f);
    if (this.disposed || seq !== this.seq) return;

    const { composite, modelTextures, glow } = this.draw(data, p);
    const partFigures = new Map<number, Figure>();
    for (const i of p.parts.keys()) partFigures.set(i, await this.part(i, data));
    if (this.disposed || seq !== this.seq) return;

    const body = this.body;
    const bones = p.bones.flat();
    const op = () => {
      // In one step: what the wardrobe works out reads what this just set.
      body.look.replace(p.geosets);
      body.setDrawnLayers(p.layers, p.layerKey);
      body.setBaseTarget(composite);
      const over = this.host.overOutfit();
      body.applyGeosets(over?.visible ?? p.geosets);
      body.setComposite(over?.composite ?? composite.texture);
      for (const [type, texture] of modelTextures) body.setModelTexture(type, texture);
      body.setBoneSet(bones);
      body.setEmissive(glow?.texture ?? null);
      for (const [i, f] of this.attached) {
        if (!p.parts.has(i)) {
          f.root.removeFromParent();
          this.attached.delete(i);
        }
      }
      for (const [i, f] of partFigures) {
        f.applyGeosets(p.parts.get(i)!);
        if (!this.attached.has(i)) {
          body.root.add(f.root);
          this.attached.set(i, f);
        }
      }
      this.look = p.look;
      this.host.changed(p.look);
      const liveTargets = new Set<WebGLRenderTarget>([composite]);
      if (glow) liveTargets.add(glow);
      const live = new Set<Texture>();
      for (const l of p.layers) live.add(l.texture);
      for (const mt of p.modelTextures) for (const l of mt.layers) live.add(l.texture);
      for (const l of p.emissive) live.add(l.texture);
      for (const rt of this.targets.values()) for (const t of modelTextures.values()) if (t === rt.texture) liveTargets.add(rt);
      this.trim(live, liveTargets);
    };
    if (onStage) await this.host.applyAtomically(op);
    else op();
  }

  /** The current choice of an option, for a panel. */
  choiceOf(optionId: number): number | undefined {
    const o = this.data?.options.find((x) => x.id === optionId);
    return o && this.look ? chosenOf(o, this.look)?.id : undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.seq++;
    this.abort.abort();
    for (const r of this.textures.values()) r.texture?.dispose();
    this.textures.clear();
    for (const rt of this.targets.values()) rt.dispose();
    this.targets.clear();
    for (const p of this.partFigures.values()) void p.then((f) => f.dispose(), () => undefined);
    this.partFigures.clear();
    this.attached.clear();
  }
}
