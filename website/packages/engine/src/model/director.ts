/**
 * Which clip plays. Clips are streamed, so a click may take a while: the clip on
 * screen keeps playing until the new one arrives, then they crossfade. Only the
 * newest request counts; a superseded fetch is cancelled and its result dropped.
 */
import { LoopOnce, LoopRepeat, type AnimationAction, type AnimationClip } from "three";
import { CROSSFADE_S, TPOSE } from "../constants";
import { jumpIndex, nextStep, reindex, startChain, stepLoop, type Chain } from "../logic/chain";
import { clipCycle, neighbourClipIds, nextClipId, previousClipId } from "../logic/clipOrder";
import { isAbort } from "../net/fetchPack";
import { $clipLoading, $currentClip, $error, $paused, $playlist, $timeScale } from "../stores";
import type { Figure } from "./figure";

export class ClipDirector {
  current: AnimationAction | null = null;
  currentId: string = TPOSE;
  chain: Chain | null = null;
  /** Bumped by every request: an older one finding this changed gives up. */
  private seq = 0;
  private wanted: string | null = null;
  private readonly fading: AnimationAction[] = [];
  private altClone: { source: AnimationClip; clone: AnimationClip } | null = null;
  private idleHandle = 0;
  private onFinished: ((e: { action: AnimationAction }) => void) | null = null;

  constructor(
    private readonly figure: Figure,
    /** Lite previews never fetch beyond the default clip. */
    private readonly lite: boolean,
    private readonly invalidate: () => void,
  ) {}

  get isPlaying(): boolean {
    return (this.current !== null && !this.current.paused) || this.fading.length > 0;
  }

  /** Applied before the first frame: no fade, no T-Pose. */
  startDefault(id: string | null, timeScale: number): void {
    this.figure.mixer.timeScale = timeScale;
    if (!id) return;
    const clip = this.figure.assets.clips.cached(id);
    if (!clip) return;
    // No store is touched: this figure is not on stage yet, and may never be.
    const action = this.figure.mixer.clipAction(this.figure.adaptClip(clip));
    action.clampWhenFinished = true;
    action.setLoop(LoopRepeat, Infinity);
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    this.current = action;
    this.currentId = id;
    this.figure.fx.setClip(id);
    this.figure.mixer.update(0);
    this.schedulePrefetch();
  }

  async play(id: string): Promise<void> {
    if (this.chain) this.clearChain();
    return this.request(id);
  }

  private async request(id: string, after?: (action: AnimationAction) => void): Promise<void> {
    const seq = ++this.seq;
    this.cancelWanted(id);
    if (id === this.currentId && !after) {
      $clipLoading.set(false);
      return;
    }
    if (id === TPOSE) {
      $clipLoading.set(false);
      this.stopAll();
      return;
    }
    const store = this.figure.assets.clips;
    let clip = store.cached(id);
    if (!clip) {
      this.wanted = id;
      $clipLoading.set(true);
      try {
        clip = await store.get(id, "high");
      } catch (err) {
        if (seq === this.seq) {
          this.wanted = null;
          $clipLoading.set(false);
          if (!isAbort(err)) $error.set(`Could not load clip ${id}`);
        }
        return;
      }
      if (seq !== this.seq) return;
      this.wanted = null;
      $clipLoading.set(false);
    }
    this.crossfade(id, clip, CROSSFADE_S);
    if (after && this.current) after(this.current);
    this.schedulePrefetch();
  }

  /** Newest click wins: the fetch nobody wants any more stops using the line. */
  private cancelWanted(next: string): void {
    if (this.wanted && this.wanted !== next) this.figure.assets.clips.cancel(this.wanted);
    this.wanted = null;
  }

  private crossfade(id: string, clip: AnimationClip, seconds: number): AnimationAction {
    const prev = this.current;
    if (prev) {
      prev.fadeOut(seconds);
      this.fading.push(prev);
    }
    const action = this.figure.mixer.clipAction(this.figure.adaptClip(clip));
    action.enabled = true;
    action.clampWhenFinished = true;
    action.setLoop(LoopRepeat, Infinity);
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(seconds).play();
    this.current = action;
    this.currentId = id;
    this.figure.fx.setClip(id);
    $currentClip.set(id);
    $paused.set(false);
    this.invalidate();
    return action;
  }

  private stopAll(): void {
    this.current?.stop();
    for (const a of this.fading) a.stop();
    this.fading.length = 0;
    this.current = null;
    this.currentId = TPOSE;
    this.figure.fx.setClip(null);
    $currentClip.set(TPOSE);
    $paused.set(true);
    this.invalidate();
  }

  /** Called each frame. Allocates nothing; a finished fade leaves the active list. */
  update(dt: number): void {
    this.figure.mixer.update(dt);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const a = this.fading[i]!;
      if (a.getEffectiveWeight() === 0 && a !== this.current) {
        a.stop();
        this.fading.splice(i, 1);
      }
    }
  }

  // --- Next, previous -----------------------------------------------------

  private cycle(): string[] {
    return clipCycle(this.figure.assets.clips.entries);
  }

  next(): Promise<void> {
    if (this.chain?.kind === "playlist") return this.jump(this.chain.index + 1);
    return this.play(nextClipId(this.cycle(), this.targetId()));
  }

  previous(): Promise<void> {
    if (this.chain?.kind === "playlist") return this.jump(this.chain.index - 1);
    return this.play(previousClipId(this.cycle(), this.targetId()));
  }

  /** While a clip is coming, next means next after that one. */
  private targetId(): string {
    return this.wanted ?? this.currentId;
  }

  // --- Chains -------------------------------------------------------------

  private clearChain(): void {
    this.stopChainListener();
    this.chain = null;
    $playlist.set([]);
  }

  private stopChainListener(): void {
    if (this.onFinished) {
      this.figure.mixer.removeEventListener("finished", this.onFinished as never);
      this.onFinished = null;
    }
  }

  playChain(clips: string[], loopEntire: boolean, kind: Chain["kind"], startIndex = 0): Promise<void> {
    if (clips.length === 0) return Promise.resolve();
    this.stopChainListener();
    this.chain = startChain(clips, { loopEntire, kind, startIndex });
    $playlist.set(kind === "playlist" ? clips : []);
    this.onFinished = (e) => {
      if (e.action !== this.current || !this.chain) return;
      const next = nextStep(this.chain);
      if (next === null) {
        this.stopChainListener();
        return;
      }
      void this.playStep(next);
    };
    this.figure.mixer.addEventListener("finished", this.onFinished as never);
    return this.playStep(startIndex);
  }

  private async playStep(zeroBased: number): Promise<void> {
    const chain = this.chain;
    if (!chain) return;
    const id = chain.clips[zeroBased];
    if (id === undefined) return;
    const { repeat, clamp } = stepLoop(chain, zeroBased);
    const shape = (action: AnimationAction) => {
      action.setLoop(repeat ? LoopRepeat : LoopOnce, repeat ? Infinity : 1);
      action.clampWhenFinished = clamp;
    };

    // Worth having ready before this one ends.
    const after = chain.clips[(zeroBased + 1) % chain.clips.length];
    if (after && after !== id && !this.lite) void this.figure.assets.clips.get(after, "low").catch(() => undefined);

    const store = this.figure.assets.clips;
    const adapt = (clip: AnimationClip) => this.figure.adaptClip(clip);
    if (id === this.currentId && this.current) {
      // The same clip twice in a row: a clone, so the two actions can crossfade.
      const clip = store.cached(id);
      if (clip) {
        const prev = this.current;
        let alt = this.altClone;
        if (!alt || alt.source !== clip) {
          if (alt) this.figure.mixer.uncacheClip(alt.clone);
          alt = { source: clip, clone: clip.clone() };
          this.altClone = alt;
        }
        const useClip = prev.getClip() === alt.source ? alt.clone : alt.source;
        const action = this.figure.mixer.clipAction(adapt(useClip));
        action.enabled = true;
        shape(action);
        prev.fadeOut(CROSSFADE_S);
        this.fading.push(prev);
        action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(CROSSFADE_S).play();
        this.current = action;
        $paused.set(false);
        chain.index = zeroBased + 1;
        this.invalidate();
        return;
      }
    }
    chain.index = zeroBased + 1;
    await this.request(id, shape);
  }

  jump(oneBased: number): Promise<void> {
    if (!this.chain) return Promise.resolve();
    const { clips, loopEntire, kind } = this.chain;
    return this.playChain(clips, loopEntire, kind, jumpIndex(oneBased, clips.length));
  }

  updatePlaylist(clips: string[]): void {
    if (clips.length < 2) return;
    if (!this.chain || this.chain.kind !== "playlist") {
      void this.playChain(clips, true, "playlist");
      return;
    }
    const kept = reindex(this.chain, clips, this.current ? this.currentId : null);
    if (!kept) {
      void this.playChain(clips, true, "playlist");
      return;
    }
    this.chain = kept;
    $playlist.set(clips);
  }

  stopChain(): void {
    this.clearChain();
    const a = this.current;
    if (a) {
      a.setLoop(LoopRepeat, Infinity);
      a.clampWhenFinished = false;
    }
  }

  // --- Prefetch -----------------------------------------------------------

  private schedulePrefetch(): void {
    if (this.lite) return;
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const run = () => {
      this.idleHandle = 0;
      const store = this.figure.assets.clips;
      for (const id of neighbourClipIds(store.entries, this.currentId)) {
        if (!store.cached(id)) void store.get(id, "low").catch(() => undefined);
      }
    };
    if (this.idleHandle) return;
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    this.idleHandle = idle ? idle(run, { timeout: 2000 }) : (setTimeout(run, 500) as unknown as number);
  }

  // --- Time ----------------------------------------------------------------

  togglePause(): void {
    if (this.current) this.setPaused(!this.current.paused);
  }

  setPaused(paused: boolean): void {
    if (!this.current) return;
    this.current.paused = paused;
    $paused.set(paused);
    this.invalidate();
  }

  setTime(seconds: number): void {
    if (!this.current) return;
    this.setPaused(true);
    this.current.time = seconds;
    this.invalidate();
  }

  nextTimeScale(scales: readonly number[]): void {
    const m = this.figure.mixer;
    m.timeScale = scales[(scales.indexOf(m.timeScale) + 1) % scales.length]!;
    $timeScale.set(m.timeScale);
    this.setPaused(false);
  }

  duration(): number {
    return this.current?.getClip().duration ?? 0;
  }

  time(): number {
    return this.current?.time ?? 0;
  }

  dispose(): void {
    this.seq++;
    this.stopChainListener();
    this.chain = null;
    this.cancelWanted("");
    if (this.idleHandle) {
      const cancel = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cancel) cancel(this.idleHandle);
      else clearTimeout(this.idleHandle);
      this.idleHandle = 0;
    }
  }
}
