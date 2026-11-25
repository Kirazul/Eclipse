/**
 * The dressing room on one body. A slot holds what is worn; a preview shows over it
 * until it ends, and never writes to it. Everything that would change the picture is
 * prepared off stage, then handed over to be applied inside one frame.
 *
 * Each slot goes at its own pace. What the stage shows for a slot is the newest thing
 * asked for that is completely ready, and until then whatever it showed before: a piece is
 * never half there, a set arrives as its pieces do, and one that can't be read costs only
 * its own slot. A slot nothing is asked of empties at once. Something warm has nothing left
 * to wait for, so its swap lands in the next frame drawn.
 *
 * Coalescing: calls in the same tick become one change, at most one change waits for a
 * frame, and a newer wish abandons an older one still waiting for the network, so hovering
 * across a grid applies only where the pointer stopped. Pieces of one wish that finish within
 * HOLD_MS of each other land in one frame: a helm and its chest on a fast line are one state,
 * and on a slow one nothing waits longer than that for a sibling. Only the last one left is
 * worth a longer wait (HOLD_LAST_MS): the wish is whole with it.
 */
import type { Object3D, Texture, WebGLRenderTarget } from "three";
import type { SlotId } from "@eclipse/format";
import { isAbort } from "../net/fetchPack";
import { $equipped, $error, $previewing } from "../stores";
import type { Figure } from "../model/figure";
import type { LoadEnv } from "../model/assets";
import { CompositeRenderer } from "./composite";
import { ItemLibrary, disposeItem, itemKey, placePiece, planOutfit, type Piece, type ResolvedItem } from "./outfit";

/** What the engine does for the wardrobe. */
export interface WardrobeHost {
  /** Compiles programs and uploads textures for a subtree that is not yet on stage. */
  prepare(root: Object3D, textures: Texture[]): Promise<void>;
  /** The same for a piece's particles and ribbons. `ownClip`: it plays its own clip, not the body's. */
  prepareEffects(figure: Figure, ownClip: boolean): Promise<void>;
  /** Uploads a texture the outfit paints on the body, so swapping it in costs nothing. */
  prepareTexture(texture: Texture): Promise<void>;
  /** Buffers and bone textures, while the old picture is still up. Once per piece. */
  rehearse(node: Object3D): void;
  /** Applies a change inside the next frame; resolves when that frame has been drawn. */
  applyAtomically(change: OutfitChange): Promise<void>;
  anisotropy(): number;
}

export interface OutfitChange {
  attach: Piece[];
  detach: Piece[];
  visible: Set<number>;
  composite: Texture | null;
  wornTextures: ReadonlyMap<number, Texture>;
}

const COMPOSITE_CACHE = 6;
const HOLD_MS = 100;
const HOLD_LAST_MS = 300;
/** Hovered items kept warm, and on top of them the items that were worn: the last two whole sets, and memory that levels off. */
const KEEP_HOVERED = 8;
const KEEP_WORN = ((globalThis as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory ?? 8) < 4 ? 8 : 20;
/** A set's pieces go in this order: what covers most of the figure is on it first. */
const SLOT_ORDER: readonly SlotId[] = ["chest", "legs", "shoulder", "head", "hands", "feet", "back", "waist", "wrist", "tabard", "shirt", "mainhand", "offhand", "ranged"];

export class Wardrobe {
  private committed = new Map<SlotId, string>();
  private previews = new Map<SlotId, string>();
  /** Hovered, not yet asked to show. Fetched and prepared so the click finds it ready. */
  private prefetched: readonly (readonly [SlotId, string])[] = [];
  private readonly library: ItemLibrary;
  private onStage: Piece[] = [];
  /** Slot -> what the stage shows for it. Trails the wish while something new is on its way. */
  private worn: ReadonlyMap<SlotId, ResolvedItem> = new Map();
  private appliedKey = "";
  /** Item key -> its load and preparation, while running. */
  private readonly preparing = new Map<string, Promise<void>>();
  private readonly prepared = new WeakSet<ResolvedItem>();
  /** Item keys that would not load. Asking again for that slot tries again. */
  private readonly failed = new Set<string>();
  private queued = false;
  /** A change is waiting for its frame: the next one is worked out when it has been drawn. */
  private applying = false;
  /** The wish being held for its siblings, and until when. */
  private holdFor = "";
  private holdSince = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly settledWaiters: (() => void)[] = [];
  private readonly composites = new Map<string, WebGLRenderTarget>();
  /** Plans applied: a burst of hovers should leave this barely moved. */
  applied = 0;
  private disposed = false;

  constructor(
    private readonly body: Figure,
    env: LoadEnv,
    private readonly composer: CompositeRenderer,
    private readonly host: WardrobeHost,
  ) {
    this.library = new ItemLibrary(env, body, KEEP_HOVERED, KEEP_WORN);
  }

  /** Resolves once the stage shows what was asked for, or something newer. */
  equip(slot: SlotId, itemId: string | null): Promise<void> {
    if (itemId) {
      this.committed.set(slot, itemId);
      this.failed.delete(itemKey(itemId, slot));
    } else this.committed.delete(slot);
    this.previews.delete(slot);
    this.publish();
    return this.schedule();
  }

  preview(slot: SlotId, itemId: string | null): Promise<void> {
    if (itemId) {
      this.previews.set(slot, itemId);
      this.failed.delete(itemKey(itemId, slot));
    } else this.previews.delete(slot);
    $previewing.set(Object.fromEntries(this.previews));
    return this.schedule();
  }

  /** The pointer is on these. Nothing shows; a click, or the rest that previews them, finds them ready. */
  prefetch(pieces: readonly (readonly [SlotId, string])[]): void {
    if (this.disposed) return;
    this.prefetched = pieces;
    for (const [slot, id] of pieces) {
      if (!this.failed.has(itemKey(id, slot))) void this.ensure(slot, id);
    }
    this.library.cancelUnwanted(this.wanted(this.effective()));
  }

  /** What the pointer may reach next: its files, into the browser's cache. Nothing is decoded. */
  warm(pieces: readonly (readonly [SlotId, string])[], whole: boolean): void {
    if (!this.disposed) this.library.warm(pieces, whole);
  }

  private publish(): void {
    $equipped.set(Object.fromEntries(this.committed));
    $previewing.set(Object.fromEntries(this.previews));
  }

  /** What is being asked for, slot by slot. A preview that won't load gives way to what is worn. */
  private effective(): Map<SlotId, string> {
    const out = new Map(this.committed);
    for (const [slot, id] of this.previews) {
      if (!this.failed.has(itemKey(id, slot))) out.set(slot, id);
    }
    return out;
  }

  private wanted(target: ReadonlyMap<SlotId, string>): Set<string> {
    const out = new Set<string>();
    for (const [slot, id] of target) out.add(itemKey(id, slot));
    // What is worn under a preview stays on its way: the preview ending needs it.
    for (const [slot, id] of this.committed) out.add(itemKey(id, slot));
    for (const [slot, id] of this.prefetched) out.add(itemKey(id, slot));
    return out;
  }

  private schedule(): Promise<void> {
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(() => {
        this.queued = false;
        this.run();
      });
    }
    return new Promise((resolve) => {
      if (this.disposed) resolve();
      else this.settledWaiters.push(resolve);
    });
  }

  private run(): void {
    if (this.disposed) return;
    const target = this.effective();
    this.library.cancelUnwanted(this.wanted(target));

    const next = new Map<SlotId, ResolvedItem>();
    let pending = 0;
    for (const [slot, id] of target) {
      const key = itemKey(id, slot);
      if (this.failed.has(key)) continue;
      const item = this.library.peek(key);
      if (item && this.prepared.has(item)) {
        next.set(slot, item);
        // What was worn, or a whole set, is what somebody goes back to.
        if (this.committed.get(slot) === id || this.previews.size > 1) this.library.markWorn(key);
        continue;
      }
      pending++;
      void this.ensure(slot, id);
      const old = this.worn.get(slot);
      if (old) next.set(slot, old);
    }

    const key = [...next.entries()]
      .map(([slot, item]) => `${slot}=${item.id}`)
      .sort()
      .join(",");
    if (key !== this.appliedKey) {
      // One change a frame. When it has been drawn this runs again and takes the newest wish.
      if (this.applying) return;
      if (pending > 0) {
        const wish = [...target].map(([s, i]) => `${s}=${i}`).join();
        const now = performance.now();
        if (this.holdFor !== wish) {
          this.holdFor = wish;
          this.holdSince = now;
        }
        const until = this.holdSince + (pending === 1 ? HOLD_LAST_MS : HOLD_MS);
        if (now < until) {
          clearTimeout(this.holdTimer);
          this.holdTimer = setTimeout(() => this.run(), until - now + 1);
          return;
        }
      }
      this.apply(next, key);
      return;
    }
    if (pending === 0 && !this.applying) this.settle();
  }

  private apply(next: ReadonlyMap<SlotId, ResolvedItem>, key: string): void {
    const plan = planOutfit(this.body, next);
    for (const t of plan.wornTextures.values()) void this.host.prepareTexture(t);
    if (this.stowed) {
      for (const piece of plan.pieces) if (piece.slot !== "ranged") placePiece(piece, true);
    }
    // Drawn off stage into its own target, so this is safe at any moment.
    const composite = this.compositeFor(plan.compositeKey, plan.layers);
    const pieces = new Set(plan.pieces);
    const change: OutfitChange = {
      attach: plan.pieces.filter((p) => !this.onStage.includes(p)),
      detach: this.onStage.filter((p) => !pieces.has(p)),
      visible: plan.visible,
      composite,
      wornTextures: plan.wornTextures,
    };
    this.onStage = plan.pieces;
    this.appliedKey = key;
    this.worn = next;
    this.applied++;
    this.applying = true;
    void this.host.applyAtomically(change).then(() => {
      this.applying = false;
      this.trim();
      if (!this.disposed) this.run();
    });
  }

  /** The item's load and preparation, once, however many ask. Done or failed, the wish is looked at again. */
  private ensure(slot: SlotId, id: string): Promise<void> {
    const key = itemKey(id, slot);
    let running = this.preparing.get(key);
    if (running) return running;
    running = this.library
      .resolve(id, slot, SLOT_ORDER.indexOf(slot))
      .then((item) => this.prepare(item))
      .catch((err: unknown) => {
        if (isAbort(err) || this.disposed) return;
        this.failed.add(key);
        console.warn(`[eclipse] item ${id} could not be loaded:`, err);
        // A hover over something broken says nothing: nobody asked to wear it.
        if (this.committed.get(slot) === id) $error.set(`Could not load an item: ${(err as Error).message}`);
      })
      .finally(() => {
        this.preparing.delete(key);
        if (!this.disposed && !this.queued) {
          this.queued = true;
          queueMicrotask(() => {
            this.queued = false;
            this.run();
          });
        }
      });
    this.preparing.set(key, running);
    return running;
  }

  private async prepare(item: ResolvedItem): Promise<void> {
    if (this.prepared.has(item) || this.disposed) return;
    for (const t of item.wornTextures) await this.host.prepareTexture(t.texture);
    await Promise.all(
      item.pieces.map(async (piece) => {
        await this.host.prepare(piece.node, piece.figure.allTextures());
        await this.host.prepareEffects(piece.figure, piece.kind === "attached");
      }),
    );
    if (this.disposed) return;
    for (const piece of item.pieces) this.host.rehearse(piece.node);
    this.prepared.add(item);
  }

  private settle(): void {
    if (this.settledWaiters.length === 0) return;
    const waiters = this.settledWaiters.splice(0, this.settledWaiters.length);
    for (const w of waiters) w();
  }

  /** What stays is read now, not when the change was made: a later change may need more of it. */
  private trim(): void {
    const inUse = this.wanted(this.effective());
    for (const [slot, item] of this.worn) inUse.add(itemKey(item.id, slot));
    void this.library.trim(inUse, disposeItem);
  }

  /** Once per distinct outfit; a preview ending goes back to a composite already drawn. */
  private compositeFor(key: string, layers: ReturnType<typeof planOutfit>["layers"]): Texture | null {
    const manifest = this.body.assets.manifest.composite;
    if (!manifest) return null;
    if (!key) return this.body.baseComposite?.texture ?? null;
    let target = this.composites.get(key);
    if (!target) {
      target = this.composer.render(manifest.width, manifest.height, layers, this.host.anisotropy());
      this.composites.set(key, target);
      if (this.composites.size > COMPOSITE_CACHE) {
        const current = this.body.composite;
        for (const [k, rt] of this.composites) {
          if (rt.texture !== current && k !== key) {
            rt.dispose();
            this.composites.delete(k);
            break;
          }
        }
      }
    } else {
      // Most recently used goes last.
      this.composites.delete(key);
      this.composites.set(key, target);
    }
    return target.texture;
  }

  get pieces(): readonly Piece[] {
    return this.onStage;
  }

  /** Weapons drawn or put away: each moves to its sheath point, and what has none stays in hand. */
  setStowed(stowed: boolean): void {
    this.stowed = stowed;
    const handsFull = this.worn.has("mainhand") || this.worn.has("offhand");
    for (const piece of this.onStage) {
      if (piece.slot === "ranged") placePiece(piece, handsFull || stowed);
      else if (piece.slot === "mainhand" || piece.slot === "offhand") placePiece(piece, stowed);
    }
  }

  private stowed = false;

  /** Slot -> item worn for real, previews left out: what a new body inherits. */
  committedEntries(): [SlotId, string][] {
    return [...this.committed];
  }

  /** Puts these on before the body joins the stage: a body swap keeps the outfit. */
  async restore(entries: readonly [SlotId, string][]): Promise<void> {
    if (entries.length === 0) return;
    for (const [slot, id] of entries) this.committed.set(slot, id);
    this.publish();
    await this.schedule();
  }

  /** The stage just changed hands, and what was asked for during the load counts: the last word wins. */
  adoptCommitted(entries: readonly [SlotId, string][]): void {
    const now = new Map(entries);
    let changed = now.size !== this.committed.size;
    for (const [slot, id] of now) if (this.committed.get(slot) !== id) changed = true;
    if (!changed) {
      this.publish();
      return;
    }
    this.committed = now;
    this.publish();
    void this.schedule();
  }

  /** The look changed under the outfit: what it shows over the new one, worked out now. */
  relook(): { visible: Set<number>; composite: Texture | null } {
    const plan = planOutfit(this.body, this.worn);
    return { visible: plan.visible, composite: this.compositeFor(plan.compositeKey, plan.layers) };
  }

  /** The look changed under the outfit: the geosets it shows, recomputed now. */
  currentGeosets(): Set<number> {
    return planOutfit(this.body, this.worn).visible;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.holdTimer);
    this.library.disposeAll();
    for (const rt of this.composites.values()) rt.dispose();
    this.composites.clear();
    this.onStage = [];
    this.settle();
  }
}
