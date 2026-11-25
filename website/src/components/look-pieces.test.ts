import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedOutfit, ResolvedSlot } from "@/lib/catalog";
import { LookPieces } from "./look-pieces";

const piece = (slot: number, over: Partial<ResolvedSlot> = {}): ResolvedSlot =>
  ({ slot, label: "", item: 40000 + slot, name: `Piece ${slot}`, icon: null, quality: 4, display: null, ...over });

const render = (slots: ResolvedSlot[]) =>
  renderToStaticMarkup(createElement(LookPieces, { resolved: { slots } as unknown as ResolvedOutfit }));

describe("a look's pieces", () => {
  it("lists only what the code wears, in the order a person reads a character", () => {
    const html = render([piece(9), piece(0), piece(4)]);
    expect(html.indexOf("Piece 0")).toBeLessThan(html.indexOf("Piece 4"));
    expect(html.indexOf("Piece 4")).toBeLessThan(html.indexOf("Piece 9"));
    expect(html).not.toContain("Your own gear");
  });

  it("counts the pieces in its heading", () => {
    expect(render([piece(0), piece(4)])).toMatch(/Pieces[^<]*<[^>]*>2</);
  });

  it("says nothing about the 3D preview", () => {
    expect(render([piece(0, { display: null })])).not.toContain("3D");
  });

  it("keeps a slot the code hides on purpose, named as hidden", () => {
    const html = render([piece(0), piece(3, { item: 0, name: null })]);
    expect(html).toContain("Hidden");
  });

  it("links each worn piece to every look that wears it", () => {
    expect(render([piece(0)])).toContain('href="/community-gallery?item=40000"');
  });

  it("leaves itself out when the code wears nothing", () => {
    expect(render([])).toBe("");
  });
});
