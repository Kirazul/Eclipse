/**
 * What pieces of an outfit have in common, held once. A set's combined model means its
 * chest, legs and gloves read the same textures, and a colourway shares most of its art
 * with its siblings: one fetch, one transcode, one upload, however many wear it.
 *
 * Counted, so a texture is freed only when its last user lets go and never while
 * anything still draws with it. Nothing is kept past that: how long a piece stays warm
 * is the item cache's choice, and its leases are what keep the textures here alive.
 */
import type { Texture, WebGLRenderer } from "three";
import type { FxData } from "@eclipse/format";
import { fetchBytes, fetchJson } from "../net/fetchPack";
import { parseTexture } from "./loaders";

/** One user's hold on a texture, which may still be on its way. */
export interface Lease {
  readonly texture: Promise<Texture>;
  release(): void;
}

interface Entry {
  refs: number;
  texture: Promise<Texture>;
  abort: AbortController;
  arrived: Texture | null;
}

class TextureStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly renderer: WebGLRenderer) {}

  acquire(url: string, bytes: number, anisotropy: number, group = 0, priority: "high" | "low" = "high"): Lease {
    const id = `${url}|${anisotropy}`;
    let entry = this.entries.get(id);
    if (!entry) {
      const abort = new AbortController();
      const made: Entry = { refs: 0, abort, arrived: null, texture: null as unknown as Promise<Texture> };
      made.texture = fetchBytes(url, { signal: abort.signal, priority, expected: bytes, group, finish: true })
        .then((buffer) => parseTexture(this.renderer, buffer, anisotropy))
        .then((texture) => {
          // Everyone let go while it was being decoded.
          if (made.refs === 0) texture.dispose();
          else made.arrived = texture;
          return texture;
        });
      // A failure is the asker's to hear; the next one to ask starts over.
      made.texture.catch(() => {
        if (this.entries.get(id) === made) this.entries.delete(id);
      });
      this.entries.set(id, made);
      entry = made;
    }
    const held = entry;
    held.refs++;
    let released = false;
    return {
      texture: held.texture,
      release: () => {
        if (released) return;
        released = true;
        if (--held.refs > 0) return;
        if (this.entries.get(id) === held) this.entries.delete(id);
        if (held.arrived) held.arrived.dispose();
        else held.abort.abort();
      },
    };
  }

  /** How many distinct textures are held: what the proofs read. */
  get size(): number {
    return this.entries.size;
  }
}

const stores = new WeakMap<WebGLRenderer, TextureStore>();

/** Textures are per renderer: a GL context can't draw another's. */
export function textureStore(renderer: WebGLRenderer): TextureStore {
  let store = stores.get(renderer);
  if (!store) {
    store = new TextureStore(renderer);
    stores.set(renderer, store);
  }
  return store;
}

/** Keyframes, read only once parsed: one model's are the same whichever colourway wears it. */
const fxData = new Map<string, Promise<FxData>>();
const FX_KEPT = 256;

export function sharedFx(url: string, bytes: number, signal: AbortSignal, group = 0, priority: "high" | "low" = "high"): Promise<FxData> {
  let hit = fxData.get(url);
  if (!hit) {
    // Not tied to the first asker's signal: others may be waiting. It is a few hundred bytes.
    hit = fetchJson<FxData>(url, { priority, expected: bytes, group, finish: true });
    fxData.set(url, hit);
    hit.catch(() => fxData.delete(url));
    if (fxData.size > FX_KEPT) fxData.delete(fxData.keys().next().value as string);
  } else {
    // Most recently used goes last.
    fxData.delete(url);
    fxData.set(url, hit);
  }
  if (signal.aborted) return Promise.reject(new DOMException("The request was aborted", "AbortError"));
  return hit;
}
