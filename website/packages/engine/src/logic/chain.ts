/**
 * Sequences and playlists as plain data: which step plays, how it loops, and what
 * comes next. The engine owns the mixer; this owns the arithmetic.
 */
export interface Chain {
  kind: "sequence" | "playlist";
  clips: string[];
  /** 1-based step now playing. */
  index: number;
  loopEntire: boolean;
}

export function startChain(clips: string[], opts: { loopEntire: boolean; kind: Chain["kind"]; startIndex?: number }): Chain {
  return { kind: opts.kind, clips, index: (opts.startIndex ?? 0) + 1, loopEntire: opts.loopEntire };
}

/** Only the last step of a chain that does not loop repeats; every other step plays once and clamps. */
export function stepLoop(chain: Chain, zeroBased: number): { repeat: boolean; clamp: boolean } {
  const terminal = !chain.loopEntire && zeroBased === chain.clips.length - 1;
  return { repeat: terminal, clamp: !terminal };
}

/** The step after the current one, or null when a non-looping chain has ended. */
export function nextStep(chain: Chain): number | null {
  if (chain.index >= chain.clips.length) return chain.loopEntire ? 0 : null;
  return chain.index;
}

export function jumpIndex(oneBased: number, length: number): number {
  return (((oneBased - 1) % length) + length) % length;
}

/**
 * A new playlist while one is playing: keep the clip on screen and just re-index.
 * Null means the current clip left the list, so the caller must restart it.
 */
export function reindex(chain: Chain, clips: string[], currentId: string | null): Chain | null {
  if (currentId === null) return null;
  const same = chain.index - 1;
  if (same >= 0 && same < clips.length && clips[same] === currentId) {
    return { ...chain, clips, index: same + 1 };
  }
  const found = clips.indexOf(currentId);
  if (found < 0) return null;
  return { ...chain, clips, index: found + 1 };
}
