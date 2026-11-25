import { describe, expect, it } from "vitest";
import { MAX_ZOOM, panBy, UNZOOMED, zoomAt } from "./zoom";

// A 1000 x 600 viewer. Points are measured from its centre, as the viewer reads them.
const SIZE = { width: 1000, height: 600 };

describe("zooming a screenshot", () => {
  it("keeps the point under the cursor where it was", () => {
    const point = { x: 200, y: -100 };
    const view = zoomAt(UNZOOMED, 2, point, SIZE);
    // The image point under the cursor was (200, -100); at 2x it is drawn at 2 * p + offset.
    expect(view.scale).toBe(2);
    expect(2 * point.x + view.x).toBe(point.x);
    expect(2 * point.y + view.y).toBe(point.y);
  });

  it("zooms about the centre without moving anything", () => {
    expect(zoomAt(UNZOOMED, 3, { x: 0, y: 0 }, SIZE)).toEqual({ scale: 3, x: 0, y: 0 });
  });

  it("stays between whole and the maximum", () => {
    expect(zoomAt(UNZOOMED, 0.2, { x: 0, y: 0 }, SIZE).scale).toBe(1);
    expect(zoomAt(UNZOOMED, 99, { x: 0, y: 0 }, SIZE).scale).toBe(MAX_ZOOM);
  });

  it("settles back to the whole picture, centred, when zoomed out", () => {
    const zoomed = zoomAt(UNZOOMED, 2, { x: 400, y: 250 }, SIZE);
    expect(zoomAt(zoomed, 1, { x: -300, y: 0 }, SIZE)).toEqual(UNZOOMED);
  });

  it("never lets the picture's edge come past the viewer's", () => {
    // Zooming at the far corner can only reach the corner, not beyond it.
    const view = zoomAt(UNZOOMED, 4, { x: 5000, y: 5000 }, SIZE);
    expect(Math.abs(view.x)).toBeLessThanOrEqual((4 - 1) * SIZE.width / 2);
    expect(Math.abs(view.y)).toBeLessThanOrEqual((4 - 1) * SIZE.height / 2);
  });
});

describe("dragging a zoomed screenshot", () => {
  it("moves it with the pointer", () => {
    const view = panBy({ scale: 2, x: 0, y: 0 }, { x: 30, y: -20 }, SIZE);
    expect(view).toEqual({ scale: 2, x: 30, y: -20 });
  });

  it("stops at the picture's edge", () => {
    const view = panBy({ scale: 2, x: 0, y: 0 }, { x: 10_000, y: -10_000 }, SIZE);
    expect(view).toEqual({ scale: 2, x: 500, y: -300 });
  });

  it("does nothing to a picture shown whole", () => {
    expect(panBy(UNZOOMED, { x: 50, y: 50 }, SIZE)).toEqual(UNZOOMED);
  });
});
