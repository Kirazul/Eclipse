/** How a zoomed picture is drawn: scaled about the viewer's centre, then moved by x, y. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const UNZOOMED: View = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** Keeps the scaled picture covering the viewer: no edge comes inside the frame. */
function fit(view: View, size: Size): View {
  const scale = clamp(view.scale, 1, MAX_ZOOM);
  const roomX = ((scale - 1) * size.width) / 2;
  const roomY = ((scale - 1) * size.height) / 2;
  // `+ 0` turns -0 into 0, so a picture at rest compares equal to UNZOOMED.
  return { scale, x: clamp(view.x, -roomX, roomX) + 0, y: clamp(view.y, -roomY, roomY) + 0 };
}

/**
 * Zooms to `scale` about `point` (measured from the viewer's centre), so whatever is
 * under the cursor or between the fingers stays there.
 */
export function zoomAt(view: View, scale: number, point: { x: number; y: number }, size: Size): View {
  const next = clamp(scale, 1, MAX_ZOOM);
  const ratio = next / view.scale;
  return fit({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, size);
}

/** Moves a zoomed picture with a drag. */
export function panBy(view: View, by: { x: number; y: number }, size: Size): View {
  return fit({ ...view, x: view.x + by.x, y: view.y + by.y }, size);
}
