import type { ClipEntry } from "@eclipse/format";
import { TPOSE } from "../constants";

/** Playable clips (a clip with no key was not baked), sorted as the list shows them. */
export function playableClips(clips: readonly ClipEntry[]): ClipEntry[] {
  return clips
    .filter((c) => !!c.key)
    .sort((a, b) => a.name.localeCompare(b.name) || a.variation - b.variation || a.id.localeCompare(b.id));
}

/** The list next and previous walk: T-Pose first, then every clip. */
export function clipCycle(clips: readonly ClipEntry[]): string[] {
  return [TPOSE, ...clips.map((c) => c.id)];
}

export function nextClipId(cycle: readonly string[], current: string | null): string {
  const at = current === null || current === TPOSE ? 0 : cycle.indexOf(current);
  const next = at + 1;
  return cycle[next === cycle.length ? 0 : next] ?? TPOSE;
}

export function previousClipId(cycle: readonly string[], current: string | null): string {
  if (current === null || current === TPOSE) return cycle[cycle.length - 1] ?? TPOSE;
  const at = cycle.indexOf(current);
  return at <= 0 ? TPOSE : cycle[at - 1]!;
}

/** The manifest's choice, else a stand clip, else the first playable one. */
export function defaultClipId(defaultClip: string, clips: readonly ClipEntry[]): string | null {
  if (clips.some((c) => c.id === defaultClip)) return defaultClip;
  const stand = clips.find((c) => /^stand/i.test(c.name));
  return stand?.id ?? clips[0]?.id ?? null;
}

/** The clips worth having ready: one either side of the current one. */
export function neighbourClipIds(clips: readonly ClipEntry[], current: string | null): string[] {
  if (clips.length === 0) return [];
  const at = clips.findIndex((c) => c.id === current);
  const out: string[] = [];
  const push = (i: number) => {
    const c = clips[(i + clips.length) % clips.length];
    if (c && c.id !== current && !out.includes(c.id)) out.push(c.id);
  };
  push(at + 1);
  push(at < 0 ? clips.length - 1 : at - 1);
  return out;
}
