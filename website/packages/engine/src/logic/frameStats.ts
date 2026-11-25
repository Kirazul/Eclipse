import { FRAME_GAP_MS, FRAME_STATS_SAMPLES } from "../constants";
import type { FrameStats } from "../stores";

/** A ring of frame intervals. `sample` allocates nothing: it runs every frame. */
export class FrameStatsRing {
  private readonly buffer = new Float32Array(FRAME_STATS_SAMPLES);
  private index = 0;
  private filled = false;
  private last = 0;

  sample(nowMs: number): void {
    if (this.last > 0) {
      const dt = nowMs - this.last;
      if (dt < FRAME_GAP_MS) {
        this.buffer[this.index] = dt;
        this.index = (this.index + 1) % FRAME_STATS_SAMPLES;
        if (this.index === 0) this.filled = true;
      }
    }
    this.last = nowMs;
  }

  /** A frame was not drawn: the next interval must not span the gap. */
  gap(): void {
    this.last = 0;
  }

  reset(): void {
    this.index = 0;
    this.filled = false;
    this.last = 0;
  }

  read(): FrameStats | null {
    const n = this.filled ? FRAME_STATS_SAMPLES : this.index;
    if (n === 0) return null;
    const sorted = Float32Array.from(this.buffer.subarray(0, n)).sort();
    const at = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))]!;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i]!;
    const mean = sum / n;
    return {
      renderer: "webgl",
      count: n,
      meanMs: mean,
      p50Ms: at(50),
      p90Ms: at(90),
      p99Ms: at(99),
      minMs: sorted[0]!,
      maxMs: sorted[n - 1]!,
      fps: 1000 / mean,
    };
  }
}
