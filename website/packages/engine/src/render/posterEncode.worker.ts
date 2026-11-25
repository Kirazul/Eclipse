/**
 * A drawn poster, flipped to straight alpha and encoded, off the main thread: encoding alone
 * takes 40 ms of it on a real machine, which is a click or a frame someone waits for.
 */
import { toStraightAlpha } from "@eclipse/format";

self.onmessage = async (e: MessageEvent<{ id: number; pixels: Uint8Array; width: number; height: number }>) => {
  const { id, pixels, width, height } = e.data;
  try {
    const { rgba } = toStraightAlpha(pixels, width, height);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
