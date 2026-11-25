/**
 * Fetching one model. The manifest comes first; then GLB, default clip, fx, textures
 * and composite layers all start together at high priority. `ready` resolves as soon
 * as geometry, the default clip and what the default look needs are in; a texture
 * only a hidden geoset uses keeps coming in the background.
 */
import { RepeatWrapping, ClampToEdgeWrapping, type AnimationClip, type Texture, type WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  FORMAT_VERSION,
  packUrl,
  paths,
  type ClipEntry,
  type CompositeLayer,
  type FxData,
  type ModelManifest,
  type SubmeshExtras,
} from "@eclipse/format";
import { fetchBytes, fetchJson, isAbort } from "../net/fetchPack";
import { parseClip, parseGlb, parseTexture } from "./loaders";
import { sharedFx, textureStore, type Lease } from "./shared";
import { defaultClipId, playableClips } from "../logic/clipOrder";

export interface LoadEnv {
  base: string;
  renderer: WebGLRenderer;
  anisotropy(): number;
  /** Everything fetched in this environment. Absent: high, it is what the visitor is waiting for. */
  priority?: "high" | "low";
}

export interface LoadRun {
  signal: AbortSignal;
  /** Bytes as they arrive, and the size of each file once it is known. */
  onBytes?(n: number): void;
  onExpect?(bytes: number): void;
  /** Lite preview: nothing beyond what the first frame needs. */
  lite?: boolean;
  /** A wardrobe piece: textures and keyframes held in common with whatever else reads them. */
  shared?: boolean;
  /** Its place among the wearables being fetched: fetchPack's `group`. */
  group?: number;
}

/** Streamed clips: one fetch per clip, parsed once, shared by everything that asks. */
export class ClipStore {
  private readonly done = new Map<string, AnimationClip>();
  private readonly pending = new Map<string, { promise: Promise<AnimationClip>; abort: AbortController }>();
  readonly entries: ClipEntry[];
  fetched = 0;

  constructor(
    private readonly env: LoadEnv,
    entries: ClipEntry[],
    private readonly pivots?: readonly number[],
  ) {
    this.entries = entries;
  }

  entry(id: string): ClipEntry | undefined {
    return this.entries.find((c) => c.id === id);
  }

  cached(id: string): AnimationClip | undefined {
    return this.done.get(id);
  }

  put(id: string, clip: AnimationClip): void {
    this.done.set(id, clip);
  }

  get(id: string, priority: "high" | "low"): Promise<AnimationClip> {
    const hit = this.done.get(id);
    if (hit) return Promise.resolve(hit);
    const running = this.pending.get(id);
    if (running) return running.promise;
    const entry = this.entry(id);
    if (!entry) return Promise.reject(new Error(`no clip ${id}`));
    const abort = new AbortController();
    const promise = (async () => {
      this.fetched++;
      const bytes = await fetchBytes(packUrl(this.env.base, entry.key), {
        signal: abort.signal,
        priority,
        expected: entry.bytes,
      });
      const clip = await parseClip(bytes, entry, this.pivots);
      this.done.set(id, clip);
      return clip;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, { promise, abort });
    return promise;
  }

  /** A click that is no longer wanted stops using the line. */
  cancel(id: string): void {
    this.pending.get(id)?.abort.abort();
  }

  dispose(): void {
    for (const p of this.pending.values()) p.abort.abort();
    this.pending.clear();
    this.done.clear();
  }
}

/**
 * ModelManifests an item carried inline: its dozens of per-race pieces are one file, so a
 * hover costs one fetch and not dozens. Whoever read the item registers them here.
 */
const inlineManifests = new Map<string, ModelManifest>();
const INLINE_KEPT = 6000;

export function registerManifests(models: Record<string, ModelManifest> | undefined): void {
  if (!models) return;
  for (const [id, m] of Object.entries(models)) inlineManifests.set(id, m);
  if (inlineManifests.size > INLINE_KEPT) {
    for (const id of [...inlineManifests.keys()].slice(0, inlineManifests.size - INLINE_KEPT)) inlineManifests.delete(id);
  }
}

export class ModelAssets {
  readonly textures: (Texture | null)[];
  readonly layers: { layer: CompositeLayer; texture: Texture | null }[] = [];
  fx: FxData | null = null;
  gltf!: GLTF;
  readonly clips: ClipStore;
  readonly defaultClip: string | null;
  /** A hidden geoset's texture arrived: whoever waits on it hears here. */
  onTexture: ((index: number) => void) | null = null;
  private readonly variants = new Map<string, Texture>();
  private readonly owned = new Set<Texture>();
  /** Held in common, let go of rather than freed. */
  private readonly leases: Lease[] = [];
  private disposed = false;

  private constructor(
    readonly manifest: ModelManifest,
    readonly env: LoadEnv,
  ) {
    this.textures = manifest.textures.map(() => null);
    this.clips = new ClipStore(env, playableClips(manifest.clips), manifest.pivots);
    this.defaultClip = defaultClipId(manifest.defaultClip, this.clips.entries);
  }

  static async load(id: string, env: LoadEnv, run: LoadRun): Promise<ModelAssets> {
    const manifest =
      inlineManifests.get(id) ??
      (await fetchJson<ModelManifest>(packUrl(env.base, paths.manifest(id)), {
        signal: run.signal,
        priority: env.priority ?? "high",
        onBytes: run.onBytes,
      }));
    if (manifest.formatVersion > FORMAT_VERSION) {
      throw new Error(`pack format ${manifest.formatVersion} is newer than this engine (${FORMAT_VERSION})`);
    }
    const assets = new ModelAssets(manifest, env);
    try {
      await assets.fetchAll(run);
    } catch (err) {
      assets.dispose();
      throw err;
    }
    return assets;
  }

  private async fetchAll(run: LoadRun): Promise<void> {
    const { manifest, env } = this;
    const url = (key: string) => packUrl(env.base, key);
    const high = { signal: run.signal, priority: env.priority ?? ("high" as const), onBytes: run.onBytes, group: run.group, finish: run.shared };

    const expect = (n: number) => run.onExpect?.(n);
    expect(manifest.glb.bytes);
    const glb = fetchBytes(url(manifest.glb.key), { ...high, expected: manifest.glb.bytes });

    const clipEntry = this.defaultClip ? this.clips.entry(this.defaultClip) : undefined;
    let clip: Promise<ArrayBuffer> | null = null;
    if (clipEntry) {
      expect(clipEntry.bytes);
      clip = fetchBytes(url(clipEntry.key), { ...high, expected: clipEntry.bytes });
    }

    let fx: Promise<FxData> | null = null;
    if (manifest.fx) {
      expect(manifest.fx.bytes);
      fx = run.shared
        ? sharedFx(url(manifest.fx.key), manifest.fx.bytes, run.signal, run.group, env.priority)
        : fetchJson<FxData>(url(manifest.fx.key), { ...high, expected: manifest.fx.bytes });
    }

    const layers = (manifest.composite?.layers ?? []).filter((l) => !!l.key);
    const layerPromises = layers.map(async (layer) => {
      expect(layer.bytes);
      const bytes = await fetchBytes(url(layer.key), { ...high, expected: layer.bytes });
      const texture = await parseTexture(env.renderer, bytes, 1);
      this.own(texture);
      this.layers.push({ layer, texture });
    });
    // A dropped load rejects all of these at once, and the awaits below only reach the first.
    // The rest are not news: they say so here, and whoever awaits one still hears it.
    const quiet = () => undefined;
    clip?.catch(quiet);
    fx?.catch(quiet);
    for (const p of layerPromises) p.catch(quiet);

    const startTexture = async (index: number): Promise<void> => {
      const entry = manifest.textures[index]!;
      if (!entry.key || this.disposed) return;
      expect(entry.bytes);
      let texture: Texture;
      if (run.shared) {
        const lease = textureStore(env.renderer).acquire(url(entry.key), entry.bytes, env.anisotropy(), run.group, env.priority);
        this.leases.push(lease);
        texture = await lease.texture;
        if (this.disposed) return;
      } else {
        const bytes = await fetchBytes(url(entry.key), { ...high, expected: entry.bytes });
        texture = await parseTexture(env.renderer, bytes, env.anisotropy());
        if (this.disposed) {
          texture.dispose();
          return;
        }
        this.own(texture);
      }
      this.textures[index] = texture;
      this.onTexture?.(index);
    };

    // What the default look needs starts now, when the manifest says which: a texture only
    // a hidden geoset reads costs a read of the bucket per visitor and waits until it shows.
    // A manifest from before that says nothing, and every texture starts at once. A lite
    // preview waits for the GLB instead: it will never show anything else.
    const started = new Map<number, Promise<void>>();
    const begin = (i: number): Promise<void> => {
      let p = started.get(i);
      if (!p) {
        p = startTexture(i);
        p.catch(quiet);
        started.set(i, p);
      }
      return p;
    };
    this.startLazyTexture = (i) => {
      void begin(i).catch((err) => reportBackground(err, manifest.textures[i]?.key));
    };
    this.startAllTextures = () => Promise.allSettled(manifest.textures.map((_, i) => begin(i))).then(() => undefined);
    if (!run.lite) {
      if (manifest.defaultTextures) for (const i of manifest.defaultTextures) void begin(i).catch(() => undefined);
      else manifest.textures.forEach((_, i) => begin(i));
    }

    this.gltf = await parseGlb(await glb);
    const needed = this.texturesForDefaultLook();
    for (const i of needed) begin(i);
    const required = [...needed].map((i) => started.get(i)!);
    // The rest may finish later or not at all: that only keeps a hidden part hidden.
    for (const [i, p] of started) {
      if (!needed.has(i)) p.catch((err) => reportBackground(err, manifest.textures[i]?.key));
    }

    const [clipBytes, fxData] = await Promise.all([clip, fx, ...layerPromises, ...required]);
    if (clipBytes && clipEntry) {
      this.clips.put(clipEntry.id, await parseClip(clipBytes as ArrayBuffer, clipEntry, manifest.pivots));
    }
    if (fxData) this.fx = fxData as FxData;
    // Paint order comes from the manifest, not arrival order.
    this.layers.sort((a, b) => a.layer.layer - b.layer.layer);
  }

  private texturesForDefaultLook(): Set<number> {
    const shown = new Set(this.manifest.defaultGeosets);
    const out = new Set<number>();
    this.gltf.scene.traverse((o) => {
      const extras = (o as unknown as { material?: { userData?: SubmeshExtras } }).material?.userData;
      if (!extras?.units || !shown.has(extras.geoset)) return;
      for (const u of extras.units) {
        if (u.tex >= 0 && this.manifest.textures[u.tex]?.key) out.add(u.tex);
      }
    });
    return out;
  }

  /** A hidden geoset's texture is wanted now. Safe to ask twice. */
  requestTexture(index: number): void {
    this.startLazyTexture?.(index);
  }
  private startLazyTexture: ((index: number) => void) | null = null;
  private startAllTextures: (() => Promise<void>) | null = null;

  /** Somebody opened the Customization tab: a choice must switch at once, so the rest come now. */
  allTextures(): Promise<void> {
    return this.startAllTextures?.() ?? Promise.resolve();
  }

  /** This texture now lives and dies with the model. */
  own(texture: Texture): void {
    this.owned.add(texture);
  }

  /** The texture for a unit. WebGL wraps per texture, so a differing unit gets a clone. */
  textureFor(index: number, wrapS: boolean, wrapT: boolean): Texture | null {
    const base = this.textures[index];
    if (!base) return null;
    const s = wrapS ? RepeatWrapping : ClampToEdgeWrapping;
    const t = wrapT ? RepeatWrapping : ClampToEdgeWrapping;
    if (!base.userData.wrapSet) {
      base.wrapS = s;
      base.wrapT = t;
      base.userData.wrapSet = true;
      base.needsUpdate = true;
      return base;
    }
    if (base.wrapS === s && base.wrapT === t) return base;
    const key = `${index}:${s}:${t}`;
    let variant = this.variants.get(key);
    if (!variant) {
      variant = base.clone();
      variant.wrapS = s;
      variant.wrapT = t;
      variant.needsUpdate = true;
      this.variants.set(key, variant);
      this.own(variant);
    }
    return variant;
  }

  /** A look's texture for a unit: WebGL wraps per texture, so a differing unit gets a clone. */
  wrapped(texture: Texture, wrapS: boolean, wrapT: boolean): Texture {
    // A render target's wrap is set when it's made: a model texture's composite repeats.
    if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) return texture;
    const s = wrapS ? RepeatWrapping : ClampToEdgeWrapping;
    const t = wrapT ? RepeatWrapping : ClampToEdgeWrapping;
    if (!texture.userData.wrapSet) {
      texture.wrapS = s;
      texture.wrapT = t;
      texture.userData.wrapSet = true;
      texture.needsUpdate = true;
      return texture;
    }
    if (texture.wrapS === s && texture.wrapT === t) return texture;
    const key = `${texture.uuid}:${s}:${t}`;
    let variant = this.variants.get(key);
    if (!variant) {
      variant = texture.clone();
      variant.wrapS = s;
      variant.wrapT = t;
      variant.needsUpdate = true;
      this.variants.set(key, variant);
      this.own(variant);
    }
    return variant;
  }

  /** For whoever finishes a fetch after the model has left. */
  get disposedNow(): boolean {
    return this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.clips.dispose();
    for (const t of this.owned) t.dispose();
    this.owned.clear();
    this.variants.clear();
    for (const l of this.leases) l.release();
    this.leases.length = 0;
  }
}

function reportBackground(err: unknown, key: string | undefined): void {
  if (!isAbort(err)) console.warn(`[eclipse] texture ${key} failed in the background:`, err);
}
