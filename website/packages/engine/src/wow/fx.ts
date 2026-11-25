/**
 * Colour, opacity and UV animation from a model's FxData. Tracks compile to typed
 * arrays at load, keys sorted, with a cursor per track, so evaluating them each frame
 * allocates nothing. Global loops run on elapsed time modulo the loop.
 */
import type { FxColor, FxData, FxTrack, FxUvAnim, SubmeshExtras } from "@eclipse/format";

export interface Keys {
  times: Float32Array;
  values: Float32Array;
  stride: number;
}

export interface CompiledTrack {
  byClip: Map<string, Keys>;
  fallback: Keys | null;
  /** Milliseconds, 0 when the track follows the clip. */
  loopMs: number;
  now: Keys | null;
  cursor: number;
}

export function compileKeys(raw: [number[], (number | number[])[]]): Keys | null {
  const [times, values] = raw;
  const n = Math.min(times?.length ?? 0, values?.length ?? 0);
  if (n === 0) return null;
  const first = values[0]!;
  const stride = Array.isArray(first) ? first.length : 1;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a]! - times[b]!);
  const t = new Float32Array(n);
  const v = new Float32Array(n * stride);
  order.forEach((from, to) => {
    t[to] = times[from]!;
    const value = values[from]!;
    if (Array.isArray(value)) v.set(value, to * stride);
    else v[to * stride] = value;
  });
  return { times: t, values: v, stride };
}

export function compileTrack(track: FxTrack | undefined, loops: readonly number[]): CompiledTrack | null {
  if (!track?.clips) return null;
  const byClip = new Map<string, Keys>();
  for (const [clip, raw] of Object.entries(track.clips)) {
    const keys = compileKeys(raw);
    if (keys) byClip.set(clip, keys);
  }
  if (byClip.size === 0) return null;
  const loopMs = track.globalLoop !== undefined && track.globalLoop >= 0 ? (loops[track.globalLoop] ?? 0) : 0;
  const fallback = byClip.get("*") ?? null;
  return { byClip, fallback, loopMs, now: fallback, cursor: 0 };
}

/** Samples into `out` from `offset`, linear between keys. Writes nothing when no keys apply. */
export function sampleTrack(track: CompiledTrack, timeMs: number, out: Float32Array, offset = 0): boolean {
  const k = track.now;
  if (!k) return false;
  const { times, values, stride } = k;
  const n = times.length;
  const t = track.loopMs > 0 ? timeMs % track.loopMs : timeMs;
  if (n === 1 || t <= times[0]!) {
    for (let i = 0; i < stride; i++) out[offset + i] = values[i]!;
    return true;
  }
  if (t >= times[n - 1]!) {
    const at = (n - 1) * stride;
    for (let i = 0; i < stride; i++) out[offset + i] = values[at + i]!;
    return true;
  }
  let c = track.cursor;
  if (c >= n - 1 || times[c]! > t) c = 0;
  while (times[c + 1]! < t) c++;
  track.cursor = c;
  const t0 = times[c]!;
  const f = (t - t0) / (times[c + 1]! - t0);
  const a = c * stride;
  const b = a + stride;
  for (let i = 0; i < stride; i++) out[offset + i] = values[a + i]! + (values[b + i]! - values[a + i]!) * f;
  return true;
}

function isAnimated(track: CompiledTrack | null): boolean {
  if (!track) return false;
  for (const keys of track.byClip.values()) if (keys.times.length > 1) return true;
  return false;
}

/** A material's fx targets, kept structurally so this file needs no three.js. */
export interface FxTarget {
  extras: SubmeshExtras;
  uniforms: {
    uColor: { value: { set(x: number, y: number, z: number): unknown } };
    uAlpha: { value: number };
    uWeight: { value: { set(x: number, y: number, z: number): unknown } };
    uUv0: { value: { elements: number[] } };
    uUv1: { value: { elements: number[] } };
  };
}

interface ColorBind {
  target: FxTarget;
  color: CompiledTrack | null;
  alpha: CompiledTrack | null;
  weight: CompiledTrack | null;
}
interface UvBind {
  target: FxTarget;
  unit: 0 | 1;
  translation: CompiledTrack | null;
  rotation: CompiledTrack | null;
  scale: CompiledTrack | null;
}

const scratch = new Float32Array(8);

export class FxRuntime {
  readonly animated: boolean;
  private readonly colors: ColorBind[] = [];
  private readonly uvs: UvBind[] = [];
  private readonly tracks: CompiledTrack[] = [];

  constructor(fx: FxData | null, targets: readonly FxTarget[]) {
    let animated = false;
    if (fx) {
      const loops = fx.globalLoops ?? [];
      const compile = (t: FxTrack | undefined) => {
        const c = compileTrack(t, loops);
        if (c) {
          this.tracks.push(c);
          animated ||= isAnimated(c);
        }
        return c;
      };
      const colorCache = new Map<number, { color: CompiledTrack | null; alpha: CompiledTrack | null }>();
      const weightCache = new Map<number, CompiledTrack | null>();
      const uvCache = new Map<number, Omit<UvBind, "target" | "unit">>();
      for (const target of targets) {
        const { color, opacity, units } = target.extras;
        let c: { color: CompiledTrack | null; alpha: CompiledTrack | null } | undefined;
        let w: CompiledTrack | null | undefined;
        if (color >= 0) {
          c = colorCache.get(color);
          if (!c) {
            const raw = fx.colors?.[color] as FxColor | undefined;
            c = { color: compile(raw?.color), alpha: compile(raw?.alpha) };
            colorCache.set(color, c);
          }
        }
        if (opacity >= 0) {
          w = weightCache.get(opacity);
          if (w === undefined) {
            w = compile(fx.opacity?.[opacity] as FxTrack | undefined);
            weightCache.set(opacity, w);
          }
        }
        if (c || w) this.colors.push({ target, color: c?.color ?? null, alpha: c?.alpha ?? null, weight: w ?? null });
        for (let u = 0; u < Math.min(units.length, 2); u++) {
          const anim = units[u]!.uvAnim;
          if (anim === undefined || anim < 0) continue;
          let bind = uvCache.get(anim);
          if (!bind) {
            const raw = fx.uvAnims?.[anim] as FxUvAnim | undefined;
            bind = { translation: compile(raw?.translation), rotation: compile(raw?.rotation), scale: compile(raw?.scale) };
            uvCache.set(anim, bind);
          }
          if (bind.translation || bind.rotation || bind.scale) this.uvs.push({ target, unit: u as 0 | 1, ...bind });
        }
      }
    }
    this.animated = animated;
  }

  /** Points every track at this clip's keys. Called on a clip change, not per frame. */
  setClip(id: string | null): void {
    for (const t of this.tracks) {
      t.now = (id !== null ? t.byClip.get(id) : undefined) ?? t.fallback;
      t.cursor = 0;
    }
  }

  update(clipMs: number, elapsedMs: number): void {
    for (let i = 0; i < this.colors.length; i++) {
      const b = this.colors[i]!;
      const u = b.target.uniforms;
      if (b.color && sampleTrack(b.color, b.color.loopMs ? elapsedMs : clipMs, scratch)) {
        u.uColor.value.set(scratch[0]!, scratch[1]!, scratch[2]!);
      }
      let alpha = 1;
      if (b.alpha && sampleTrack(b.alpha, b.alpha.loopMs ? elapsedMs : clipMs, scratch)) alpha = scratch[0]!;
      if (b.weight && sampleTrack(b.weight, b.weight.loopMs ? elapsedMs : clipMs, scratch)) {
        const w = scratch[0]!;
        alpha *= w;
        u.uWeight.value.set(w, w, w);
      }
      u.uAlpha.value = alpha;
    }
    for (let i = 0; i < this.uvs.length; i++) {
      const b = this.uvs[i]!;
      let tx = 0;
      let ty = 0;
      let sx = 1;
      let sy = 1;
      let cos = 1;
      let sin = 0;
      if (b.translation && sampleTrack(b.translation, b.translation.loopMs ? elapsedMs : clipMs, scratch)) {
        tx = scratch[0]!;
        ty = scratch[1] ?? 0;
      }
      if (b.scale && sampleTrack(b.scale, b.scale.loopMs ? elapsedMs : clipMs, scratch)) {
        sx = scratch[0]!;
        sy = scratch[1] ?? 1;
      }
      if (b.rotation && sampleTrack(b.rotation, b.rotation.loopMs ? elapsedMs : clipMs, scratch)) {
        // The rotation about Z of a unit quaternion, without building one.
        const z = scratch[2]!;
        const w = scratch[3]!;
        const l = Math.hypot(z, w) || 1;
        cos = (w * w - z * z) / (l * l);
        sin = (2 * z * w) / (l * l);
      }
      // T(.5,.5) * T(t) * R * S * T(-.5,-.5), column-major.
      const e = (b.unit === 0 ? b.target.uniforms.uUv0 : b.target.uniforms.uUv1).value.elements;
      const a00 = cos * sx;
      const a01 = -sin * sy;
      const a10 = sin * sx;
      const a11 = cos * sy;
      e[0] = a00;
      e[1] = a10;
      e[2] = 0;
      e[3] = a01;
      e[4] = a11;
      e[5] = 0;
      e[6] = 0.5 + tx - 0.5 * a00 - 0.5 * a01;
      e[7] = 0.5 + ty - 0.5 * a10 - 0.5 * a11;
      e[8] = 1;
    }
  }
}
