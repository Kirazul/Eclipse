/** PNG export. Nothing is waited on: the frame is drawn at the new scale and read at once. */
import type { WebGLRenderer } from "three";

export async function captureCanvasPng(
  renderer: WebGLRenderer,
  scale: number,
  trim: boolean,
  redraw: () => void,
): Promise<Blob> {
  const ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(ratio * scale);
  redraw();
  const canvas = renderer.domElement;
  try {
    const source = trim ? trimmed(canvas) : canvas;
    return await new Promise<Blob>((resolve, reject) => {
      source.toBlob((b) => (b ? resolve(b) : reject(new Error("the canvas gave no image"))), "image/png");
    });
  } finally {
    renderer.setPixelRatio(ratio);
    redraw();
  }
}

/** Crops to what is not fully transparent. */
function trimmed(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const copy = document.createElement("canvas");
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return copy;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(copy, -x0, -y0);
  return out;
}
