import { describe, expect, it } from "vitest";
import { arrowStep } from "./studio-gallery";

// The full-screen viewer is a portal: in the page it sits outside the gallery, but React
// still bubbles its key presses up to the gallery, which would step a second time.
describe("the screenshot gallery's arrow keys", () => {
  const inside = {};
  const gallery = { contains: (node: unknown) => node === gallery || node === inside };
  const press = (key: string, target: unknown) => arrowStep({ key, target, currentTarget: gallery } as never);

  it("steps once per press inside the gallery", () => {
    expect(press("ArrowRight", inside)).toBe(1);
    expect(press("ArrowLeft", gallery)).toBe(-1);
    expect(press("Enter", inside)).toBe(0);
  });

  it("leaves a press in the full-screen viewer to the viewer", () => {
    const viewer = {};
    expect(press("ArrowRight", viewer)).toBe(0);
    expect(press("ArrowLeft", viewer)).toBe(0);
  });
});
