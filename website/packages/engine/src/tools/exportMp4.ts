/** MP4 export: offline at fixed steps, or live from the canvas with a wake lock. */
import { BufferTarget, CanvasSource, MediaStreamVideoTrackSource, Mp4OutputFormat, Output } from "mediabunny";
import type { WebGLRenderer } from "three";
import { Vector2 } from "three";
import { MP4 } from "../constants";

/**
 * Steps the animation at a fixed dt with the render loop stopped, encoding each
 * frame. AVC needs even dimensions, so the drawing buffer is rounded down for the
 * run and restored after.
 */
export async function renderClipToMp4(
  canvas: HTMLCanvasElement,
  renderer: WebGLRenderer,
  seconds: number,
  opts: { fps: number; signal: AbortSignal; onProgress: (fraction: number, phase: "capture" | "encode") => void },
  step: (dt: number) => void,
): Promise<Blob | null> {
  const fps = Math.max(1, Math.floor(opts.fps));
  const dt = 1 / fps;
  const total = Math.max(1, Math.ceil(seconds * fps));
  const size = renderer.getDrawingBufferSize(new Vector2());
  const ratio = renderer.getPixelRatio();
  const cssSize = renderer.getSize(new Vector2());
  const w = Math.floor(size.x / 2) * 2;
  const h = Math.floor(size.y / 2) * 2;
  if (w !== size.x || h !== size.y) renderer.setDrawingBufferSize(w / ratio, h / ratio, ratio);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: MP4.offline.fastStart }), target });
  const source = new CanvasSource(canvas, {
    codec: MP4.offline.codec,
    bitrate: MP4.offline.bitrate,
    bitrateMode: MP4.offline.mode,
    keyFrameInterval: MP4.offline.keyFrameInterval,
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) {
        await output.cancel();
        return null;
      }
      step(i === 0 ? 0 : dt);
      await source.add(i * dt, dt);
      opts.onProgress((i + 1) / total, "capture");
    }
    opts.onProgress(0, "encode");
    await output.finalize();
    opts.onProgress(1, "encode");
    return new Blob([target.buffer!], { type: "video/mp4" });
  } finally {
    if (w !== size.x || h !== size.y) renderer.setSize(cssSize.x, cssSize.y, false);
  }
}

export async function recordCanvas(
  canvas: HTMLCanvasElement,
  onTick: (seconds: number) => void,
): Promise<{ stop(): Promise<Blob | null> }> {
  const stream = canvas.captureStream(60);
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("the canvas gave no video track");
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: MP4.offline.fastStart }), target });
  const source = new MediaStreamVideoTrackSource(track, {
    codec: MP4.live.codec,
    bitrate: MP4.live.bitrate,
    bitrateMode: MP4.live.mode,
  });
  output.addVideoTrack(source, { frameRate: 60 });
  await output.start();

  let wake: WakeLockSentinel | null = null;
  try {
    wake = await navigator.wakeLock?.request("screen");
  } catch {
    // The recording still works; only the screen may sleep.
  }
  const started = performance.now();
  const timer = setInterval(() => onTick((performance.now() - started) / 1000), 1000);
  return {
    async stop() {
      clearInterval(timer);
      track.stop();
      await output.finalize();
      await wake?.release();
      return target.buffer ? new Blob([target.buffer], { type: "video/mp4" }) : null;
    },
  };
}
