import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LookModel } from "./look-model";

const BACKDROP = "/scene.webp";
const SHOT = "https://example.test/capture.webp";

const render = (props: Partial<Parameters<typeof LookModel>[0]>) =>
  renderToStaticMarkup(
    createElement(LookModel, { pieces: {}, wearer: null, gallery: [], backdrop: BACKDROP, title: "Raid night", ...props }),
  );

// The 3D figure streams its models from the viewer's pack host, which is slow and is not
// ours to spend, so nothing about it loads until a visitor asks for it.
describe("a look's stage", () => {
  it("shows the game's screenshots first, with the 3D preview one click away", () => {
    const html = render({ pieces: { 0: 179769 }, gallery: [SHOT] });
    expect(html).toContain(SHOT);
    expect(html).not.toContain("<canvas");
    expect(html).toContain("Show 3D preview");
  });

  it("draws no figure on open for a look without screenshots, only offers one", () => {
    const html = render({ pieces: { 0: 179769, 4: 168954 } });
    expect(html).not.toContain("<canvas");
    expect(html).toContain("Show 3D preview");
  });

  it("offers a look's own body when it wears no pieces", () => {
    expect(render({ pieces: {}, wearer: { race: 1, gender: 1 } })).toContain("Show 3D preview");
  });

  // Most pieces in real looks have no baked model, and a figure missing most of a look
  // shows a look that is not there: the screenshots tell the truth instead.
  it("offers the preview only when at least 70% of the look's pieces are in it", () => {
    const pieces = (baked: number, missing: number) =>
      Object.fromEntries([
        ...Array.from({ length: baked }, (_, i) => [i, 179769 + i]),
        ...Array.from({ length: missing }, (_, i) => [baked + i, null]),
      ]);
    const wearer = { race: 1, gender: 1 };
    expect(render({ pieces: pieces(7, 3), wearer, gallery: [SHOT] })).toContain("Show 3D preview");
    expect(render({ pieces: pieces(2, 1), wearer, gallery: [SHOT] })).not.toContain("Show 3D preview");
    expect(render({ pieces: pieces(1, 1), wearer })).not.toContain("Show 3D preview");
    expect(render({ pieces: { 0: null }, wearer })).not.toContain("Show 3D preview");
    expect(render({ pieces: pieces(2, 1), wearer, gallery: [SHOT] })).toContain(SHOT);
  });

  it("warns before the preview that it will miss pieces", () => {
    expect(render({ pieces: { 0: 179769, 1: 1, 2: 2, 3: 3, 4: null } })).toContain("Some pieces");
    expect(render({ pieces: { 0: 179769 } })).not.toContain("Some pieces");
  });

  it("offers no preview when the figure would wear nothing", () => {
    const html = render({ pieces: { 0: null, 4: null }, gallery: [SHOT] });
    expect(html).toContain(SHOT);
    expect(html).not.toContain("Show 3D preview");
  });

  it("says so when there is neither a screenshot nor anything to preview", () => {
    const html = render({ pieces: { 0: null, 4: null } });
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Show 3D preview");
    expect(html).toContain("not in the 3D preview");
  });
});
