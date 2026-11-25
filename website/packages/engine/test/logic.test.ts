import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FrameStatsRing } from "../src/logic/frameStats";
import { boundarySize, depthRange, depthResolution, filterOutlierBoxes, fitShadow, frameStyle, iqrLimits } from "../src/logic/framing";
import { resolveShortcut } from "../src/logic/keyboard";
import { anisotropyFor, effectiveTier, isSoftwareRenderer, pixelRatioFor } from "../src/logic/gpuTier";
import { clipCycle, defaultClipId, neighbourClipIds, nextClipId, playableClips, previousClipId } from "../src/logic/clipOrder";
import { jumpIndex, nextStep, reindex, startChain, stepLoop } from "../src/logic/chain";
import { ByteProgress } from "../src/logic/progress";
import { GeosetLook, outfitGeosets } from "../src/logic/geosets";
import { COMP, EMPTY_SLOT, HAND_FLAGS, SLOTS, geosetValues, handPose, resolveValue, type GeoSlot } from "../src/logic/retailGeo";
import { DEFAULT_SECTIONS, componentSlot, slotView } from "../src/logic/slots";
import { batchProgram, batchRenderOrder, blendState, pixelProgram, vertexProgram } from "../src/wow/programs";
import { blendTexel } from "../src/wow/compositeMath";
import { FxRuntime, compileKeys, compileTrack, sampleTrack, type FxTarget } from "../src/wow/fx";
import { boneIndex, unbakeTranslations } from "../src/logic/pivots";
import type { ClipEntry, FxData, SubmeshExtras } from "@eclipse/format";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8")) as T;

const box = (min: number[], max: number[]) => ({ min: min as never, max: max as never });

describe("frame stats", () => {
  it("returns Khada's fields and his percentile formula", () => {
    const ring = new FrameStatsRing();
    expect(ring.read()).toBeNull();
    let t = 1000;
    ring.sample(t);
    for (let i = 1; i <= 100; i++) {
      t += i;
      ring.sample(t);
    }
    const s = ring.read()!;
    expect(s.count).toBe(100);
    expect(s.renderer).toBe("webgl");
    expect(s.minMs).toBe(1);
    expect(s.maxMs).toBe(100);
    expect(s.p50Ms).toBe(51);
    expect(s.p90Ms).toBe(91);
    expect(s.p99Ms).toBe(100);
    expect(s.meanMs).toBeCloseTo(50.5, 3);
    expect(s.fps).toBeCloseTo(1000 / 50.5, 3);
  });
  it("ignores gaps of a second or more and wraps at 3600", () => {
    const ring = new FrameStatsRing();
    ring.sample(100);
    ring.sample(1100);
    expect(ring.read()).toBeNull();
    ring.sample(1110);
    expect(ring.read()!.count).toBe(1);
    let t = 2000;
    for (let i = 0; i < 4000; i++) ring.sample((t += 16));
    expect(ring.read()!.count).toBe(3600);
    ring.gap();
    ring.sample(t + 5000);
    expect(ring.read()!.count).toBe(3600);
    ring.reset();
    expect(ring.read()).toBeNull();
  });
});

describe("framing", () => {
  it("IQR x 50 drops only the far outlier", () => {
    const boxes = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((v) => box([v, v, v], [v + 1, v + 1, v + 1]));
    const outlier = box([500, 0, 0], [501, 1, 1]);
    const kept = filterOutlierBoxes([...boxes, outlier]);
    expect(kept).toHaveLength(8);
    expect(kept).not.toContain(outlier);
    const lim = iqrLimits([1, 2, 3, 4]);
    // Same quartile picks as Khada: sorted[floor(n * .25)] and sorted[floor(n * .75)].
    expect(lim.lower).toBe(2 - 2 * 50);
    expect(lim.upper).toBe(4 + 2 * 50);
  });
  it("keeps everything when the filter would leave nothing", () => {
    expect(filterOutlierBoxes([box([0, 0, 0], [1, 1, 1])], 0)).toHaveLength(1);
    expect(filterOutlierBoxes([])).toEqual([]);
  });
  it("boundary is size x max(2, maxDim), at least 1 per axis", () => {
    expect(boundarySize([0.1, 1.9, 0.2])).toEqual([1, 3.8, 1]);
    expect(boundarySize([3, 1, 2])).toEqual([9, 3, 6]);
  });
  it("padding and rotation per style", () => {
    const d = frameStyle("default", true, 1);
    expect(d.padding.paddingBottom).toBeCloseTo(0.3, 10);
    expect(d.padding.paddingTop).toBeCloseTo(0.2, 10);
    expect(d.padding.paddingLeft).toBe(0.1);
    expect(d.padding.paddingRight).toBe(0.1);
    expect(d.polar).toBeCloseTo(Math.PI / 3, 10);
    expect(d.azimuth).toBe(0);
    const p = frameStyle("default", false, 0);
    expect(p.padding).toEqual({ paddingBottom: 0.3, paddingLeft: 0.3, paddingRight: 0.3, paddingTop: 0.3 });
    const m = frameStyle("mobile", true, 5);
    expect(m.padding).toEqual({ paddingBottom: 0.8, paddingLeft: 0.2, paddingRight: 0.2, paddingTop: 0.5 });
    expect(m.polar).toBeCloseTo((70 * Math.PI) / 180, 10);
    const l = frameStyle("lol", true, 5);
    expect(l.padding.paddingTop).toBe(0.3);
    expect(l.azimuth).toBeCloseTo((-15 * Math.PI) / 180, 10);
  });
  it("the per-model depth range is far finer than the fixed .1 / 100", () => {
    const { near, far } = depthRange(15, 1.2);
    expect(near).toBeGreaterThan(10);
    expect(far).toBeLessThan(25);
    const fixed = depthResolution(0.1, 100, 15);
    const ours = depthResolution(near, far, 15);
    expect(fixed).toBeGreaterThan(1e-4);
    expect(fixed / ours).toBeGreaterThan(100);
  });
  it("close up, the range still contains the camera's reach", () => {
    expect(depthRange(0.8, 1.2).near).toBe(0.1);
    expect(depthRange(79, 1).far).toBe(85);
    expect(depthRange(99, 1).far).toBe(100);
  });
  it("the shadow frustum is a whole number of texels, on the grid, and stable", () => {
    const light: [number, number, number] = [8, 18, 4];
    const a = fitShadow(box([-1, 0, -1.3], [1, 2, -0.7]), light, 4096);
    expect(Number.isInteger(a.gridX)).toBe(true);
    expect(Number.isInteger(a.gridY)).toBe(true);
    expect(a.half / a.texel).toBeCloseTo(2048, 8);
    // A hair's change in the bounds moves the frustum by whole texels or not at all.
    const b = fitShadow(box([-1.001, 0, -1.3], [1.001, 2.002, -0.7]), light, 4096);
    expect(b.texel).toBe(a.texel);
    expect(Math.abs(b.gridY - a.gridY) + Math.abs(b.gridX - a.gridX)).toBeLessThan(4);
    const worldDelta = Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2]);
    const dz = 0.001;
    expect(worldDelta).toBeLessThan(a.texel * 4 + dz);
  });
  it("the shadow frustum covers the box", () => {
    const f = fitShadow(box([-1, 0, -1.3], [1, 2, -0.7]), [8, 18, 4], 4096);
    expect(f.half).toBeGreaterThan(1);
    expect(f.far).toBeGreaterThan(20);
  });
});

describe("keyboard", () => {
  const key = (code: string, o: Partial<Parameters<typeof resolveShortcut>[0]> = {}) =>
    resolveShortcut({ code, ctrlKey: false, metaKey: false, altKey: false, targetTag: "BODY", ignoreArrows: false, ...o });
  it("follows the table, with the arrows as labelled", () => {
    expect(key("KeyP")).toBe("pause");
    expect(key("KeyK")).toBe("pause");
    expect(key("KeyT")).toBe("timeScale");
    expect(key("ArrowLeft")).toBe("previous");
    expect(key("ArrowRight")).toBe("next");
    expect(key("Comma")).toBe("stepBack");
    expect(key("Period")).toBe("stepForward");
    expect(key("KeyF")).toBe("fullscreen");
    expect(key("KeyP", { altKey: true })).toBe("png");
    expect(key("KeyQ")).toBeNull();
  });
  it("stays out of inputs, and off with Ctrl or Cmd", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT", "LI", "input"]) expect(key("KeyP", { targetTag: tag })).toBeNull();
    expect(key("KeyK", { ctrlKey: true })).toBeNull();
    expect(key("KeyK", { metaKey: true })).toBeNull();
    expect(key("ArrowLeft", { ignoreArrows: true })).toBeNull();
    expect(key("KeyP", { ignoreArrows: true })).toBe("pause");
  });
});

describe("gpu tier", () => {
  it("matches Khada on tiers 1 to 3 and scales tier 0 down", () => {
    expect(pixelRatioFor(1, 2)).toBeCloseTo(1.6, 8);
    expect(pixelRatioFor(2, 2)).toBeCloseTo(1.8, 8);
    expect(pixelRatioFor(3, 2)).toBe(2);
    expect(pixelRatioFor(0, 2)).toBeCloseTo(1.4, 8);
    expect(pixelRatioFor(3, 2, { mobile: true })).toBeCloseTo(1.6, 8);
    expect(pixelRatioFor(3, 2, { failed: true })).toBeCloseTo(1.6, 8);
  });
  it("caps anisotropy by tier", () => {
    expect(anisotropyFor(3, 16)).toBe(16);
    expect(anisotropyFor(2, 16)).toBe(8);
    expect(anisotropyFor(1, 16)).toBe(4);
    expect(anisotropyFor(0, 16)).toBe(2);
    expect(anisotropyFor(3, 1)).toBe(1);
  });
  it("does not punish a GPU newer than the benchmark table", () => {
    expect(effectiveTier({ tier: 1, type: "FALLBACK" }, "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti)")).toBe(3);
    expect(effectiveTier({ tier: 1, type: "FALLBACK" }, "Something Unknown")).toBe(2);
    expect(effectiveTier({ tier: 1, type: "BENCHMARK" }, "NVIDIA")).toBe(1);
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan (SwiftShader Device))")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (NVIDIA)")).toBe(false);
  });
});

const clip = (id: string, name: string, key = "k", variation = 0): ClipEntry => ({ id, name, animId: 0, variation, durationMs: 1000, loops: true, key, bytes: 1 });

describe("clip order", () => {
  const clips = playableClips([clip("4.0", "Walk"), clip("0.0", "Stand"), clip("9.9", "Hidden", ""), clip("0.1", "Stand", "k", 1), clip("5.0", "Run")]);
  it("drops unbaked clips and sorts by name then variation", () => {
    expect(clips.map((c) => c.id)).toEqual(["5.0", "0.0", "0.1", "4.0"]);
  });
  it("walks with T-Pose first and wraps both ways", () => {
    const cycle = clipCycle(clips);
    expect(cycle).toEqual(["T-Pose", "5.0", "0.0", "0.1", "4.0"]);
    expect(nextClipId(cycle, "T-Pose")).toBe("5.0");
    expect(nextClipId(cycle, null)).toBe("5.0");
    expect(nextClipId(cycle, "4.0")).toBe("T-Pose");
    expect(previousClipId(cycle, "5.0")).toBe("T-Pose");
    expect(previousClipId(cycle, "T-Pose")).toBe("4.0");
    expect(previousClipId(cycle, null)).toBe("4.0");
    expect(previousClipId(cycle, "4.0")).toBe("0.1");
  });
  it("picks the default clip", () => {
    expect(defaultClipId("4.0", clips)).toBe("4.0");
    expect(defaultClipId("missing", clips)).toBe("0.0");
    expect(defaultClipId("missing", [clip("7.0", "Fly")])).toBe("7.0");
    expect(defaultClipId("missing", [])).toBeNull();
  });
  it("finds neighbours to prefetch", () => {
    expect(neighbourClipIds(clips, "0.0")).toEqual(["0.1", "5.0"]);
    expect(neighbourClipIds(clips, "5.0")).toEqual(["0.0", "4.0"]);
    expect(neighbourClipIds([], "x")).toEqual([]);
  });
});

describe("chains", () => {
  it("non-terminal steps play once with clamp; the last of a sequence repeats", () => {
    const seq = startChain(["a", "b"], { loopEntire: false, kind: "sequence" });
    expect(seq.index).toBe(1);
    expect(stepLoop(seq, 0)).toEqual({ repeat: false, clamp: true });
    expect(stepLoop(seq, 1)).toEqual({ repeat: true, clamp: false });
    const pl = startChain(["a", "b"], { loopEntire: true, kind: "playlist" });
    expect(stepLoop(pl, 1)).toEqual({ repeat: false, clamp: true });
  });
  it("advances, wraps a playlist and ends a sequence", () => {
    const seq = startChain(["a", "b"], { loopEntire: false, kind: "sequence" });
    expect(nextStep(seq)).toBe(1);
    expect(nextStep({ ...seq, index: 2 })).toBeNull();
    const pl = startChain(["a", "b"], { loopEntire: true, kind: "playlist", startIndex: 1 });
    expect(pl.index).toBe(2);
    expect(nextStep(pl)).toBe(0);
  });
  it("jumpChainTo is 1-based and wraps", () => {
    expect(jumpIndex(1, 3)).toBe(0);
    expect(jumpIndex(3, 3)).toBe(2);
    expect(jumpIndex(4, 3)).toBe(0);
    expect(jumpIndex(0, 3)).toBe(2);
    expect(jumpIndex(-1, 3)).toBe(1);
  });
  it("re-indexes a playlist without restarting, or asks for a restart", () => {
    const pl = startChain(["a", "b", "c"], { loopEntire: true, kind: "playlist" });
    expect(reindex(pl, ["a", "x"], "a")!.index).toBe(1);
    expect(reindex(pl, ["x", "a"], "a")!.index).toBe(2);
    expect(reindex(pl, ["x", "y"], "a")).toBeNull();
    expect(reindex(pl, ["x", "y"], null)).toBeNull();
  });
});

describe("byte progress", () => {
  it("is byte-accurate, monotonic, and reaches 1 only when told", () => {
    const seen: number[] = [];
    const p = new ByteProgress((f) => seen.push(f));
    p.expect(1000);
    p.add(250);
    expect(seen[seen.length - 1]).toBe(0.25);
    p.expect(1000);
    p.add(250);
    expect(seen[seen.length - 1]).toBe(0.25);
    p.add(1500);
    expect(seen[seen.length - 1]).toBe(0.999);
    p.finish();
    expect(seen[seen.length - 1]).toBe(1);
    expect(p.bytes).toBe(2000);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});

describe("geoset look", () => {
  const ids = new Set([0, 1, 2, 401, 402, 501, 502, 1301, 1302, 1303, 802, 1102, 2001]);
  it("starts at the default look; setGeoset swaps within the group", () => {
    const look = new GeosetLook([0, 1, 401, 1301], ids);
    look.set(4, 2);
    expect(look.has(402)).toBe(true);
    expect(look.has(401)).toBe(false);
    expect(look.has(1301)).toBe(true);
    look.set(0, 2);
    expect(look.has(2)).toBe(true);
    expect(look.has(1)).toBe(false);
    expect(look.has(0), "the bare body stays through hair changes").toBe(true);
    expect(look.valueIn(0)).toBe(2);
    expect(look.valueIn(50)).toBe(-1);
  });
  it("nothing worn: exactly the body's own look", () => {
    const look = new GeosetLook([0, 1, 401, 1301], ids);
    const slots = Array.from({ length: SLOTS }, () => EMPTY_SLOT);
    expect(outfitGeosets(look, slots, 0, [])).toEqual(new Set([0, 1, 401, 1301]));
  });
  it("a helm hides its groups, showing the under-helm value if the model has one", () => {
    const look = new GeosetLook([0, 2, 401, 1301], ids);
    const slots = Array.from({ length: SLOTS }, () => EMPTY_SLOT);
    const out = outfitGeosets(look, slots, 0, [0, 13]);
    expect(out.has(2)).toBe(false);
    expect(out.has(1), "group 0 has value 1 here").toBe(true);
    expect(out.has(1301), "value 1 is the player's own choice here, so the group goes").toBe(false);
    expect(out.has(0)).toBe(true);
  });
  it("a worn slot's rules write only retail's groups", () => {
    const look = new GeosetLook([0, 1, 401, 1301], ids);
    const slots: GeoSlot[] = Array.from({ length: SLOTS }, () => EMPTY_SLOT);
    slots[COMP.chest] = { worn: true, gg: [1, 0, 0, 0, 0, 0], pad: 0, regions: 0 };
    const out = outfitGeosets(look, slots, 0, []);
    expect(out.has(802)).toBe(true);
    expect(out.has(401), "the chest's sleeve rule sends arms to the look's value").toBe(true);
    expect(out.has(1), "group 0 is not a rule group").toBe(true);
  });
});

describe("retail geoset rules, held to Eclipse's Python twin", () => {
  it("agrees with races_itemgeo.retail_values on 800 random outfits", () => {
    const cases = fixture<{ slots: Record<string, { gg: number[]; pad: number; regions: number }>; flags: number; keep: boolean; have: number[]; values: Record<string, number> }[]>("oracle-geosets.json");
    expect(cases.length).toBeGreaterThanOrEqual(800);
    for (const c of cases) {
      const slots: GeoSlot[] = Array.from({ length: SLOTS }, () => EMPTY_SLOT);
      for (const [k, s] of Object.entries(c.slots)) slots[Number(k)] = { worn: true, ...s };
      const have = new Set(c.have);
      const v = geosetValues(slots, c.flags, (id) => have.has(id), c.keep);
      for (let g = 0; g < 54; g++) expect(v[g], `group ${g} of ${JSON.stringify(c)}`).toBe(c.values[g] ?? -2);
    }
  });
  it("resolves -2 to the equipped default and -1 to the base, else the naked default", () => {
    expect(resolveValue(7, -2)).toBe(2);
    expect(resolveValue(7, -1)).toBe(1);
    expect(resolveValue(7, -1, 5)).toBe(5);
    expect(resolveValue(7, 9)).toBe(9);
  });
  it("hand items mirror by their display's bits", () => {
    expect(handPose(0, 0, false)).toEqual({ scale: [1, 1, 1], mirrored: false });
    expect(handPose(HAND_FLAGS.mirrorMain, 0, false)).toEqual({ scale: [-1, 1, 1], mirrored: true });
    expect(handPose(HAND_FLAGS.mirrorOff, 0, false).mirrored).toBe(false);
    expect(handPose(HAND_FLAGS.mirrorOff, 1, false).mirrored).toBe(true);
    expect(handPose(HAND_FLAGS.mirrorSheathed, 0, true).mirrored).toBe(true);
    expect(handPose(HAND_FLAGS.mirrorMain | HAND_FLAGS.mirrorSheathed, 0, true).mirrored).toBe(false);
    expect(handPose(HAND_FLAGS.flipSheathed, 0, true)).toEqual({ scale: [-1, -1, 1], mirrored: false });
    expect(handPose(HAND_FLAGS.flipSheathed, 0, false).scale).toEqual([1, 1, 1]);
  });
});

describe("slots", () => {
  const bounds = { min: [-0.6, 0, -0.2] as [number, number, number], max: [0.6, 2, 0.2] as [number, number, number] };
  it("frames the head low of centre, the back from behind, the feet at the floor", () => {
    const head = slotView("head", bounds);
    expect(head.max[1]).toBeLessThan(2);
    expect(head.min[1]).toBeGreaterThan(1.4);
    expect(head.max[0] - head.min[0]).toBeCloseTo(0.6, 8);
    expect(slotView("back", bounds).azimuth).toBeCloseTo(Math.PI, 10);
    expect(slotView("feet", bounds).min[1]).toBe(0);
    expect(slotView("mainhand", bounds).max[1]).toBe(2);
  });
  it("maps slots to the rules' component numbers", () => {
    expect(componentSlot("chest")).toBe(COMP.chest);
    expect(componentSlot("waist")).toBe(COMP.belt);
    expect(componentSlot("back")).toBe(COMP.cape);
    expect(componentSlot("head")).toBe(-1);
  });
  it("sections lie inside the composite", () => {
    for (const s of Object.values(DEFAULT_SECTIONS)) {
      expect(s.x + s.w).toBeLessThanOrEqual(1);
      expect(s.y + s.h).toBeLessThanOrEqual(1);
    }
  });
});

describe("programs, held to Eclipse's retail_programs.py", () => {
  it("agrees on every table entry and a sweep of explicit ids", () => {
    const rows = fixture<[number, number, number, string, number[], boolean, string][]>("oracle-programs.json");
    expect(rows.length).toBeGreaterThan(1000);
    for (const [units, shader, combiner, vs, uvs, fade, ps] of rows) {
      const got = batchProgram(units, shader);
      expect(pixelProgram(units, shader)).toBe(ps);
      expect(vertexProgram(units, shader)).toBe(vs);
      expect(got.combiner, `shader ${shader} with ${units} units`).toBe(combiner);
      expect(got.edgeFade).toBe(fade);
      expect(got.uvSources.slice(0, uvs.length)).toEqual(uvs);
    }
  });
  it("unit 0 is opaque unless shader & 0x70, then mod; unit 1 reads shader & 7", () => {
    expect(pixelProgram(1, 0)).toBe("Combiners_Opaque");
    expect(pixelProgram(1, 0x10)).toBe("Combiners_Mod");
    expect(pixelProgram(2, 0x13)).toBe("Combiners_Mod_Add");
    expect(pixelProgram(2, 0x03)).toBe("Combiners_Opaque_AddAlpha");
    expect(pixelProgram(2, 0x07)).toBe("Combiners_Opaque_AddAlpha");
    expect(pixelProgram(2, 0x04)).toBe("Combiners_Opaque_Mod2x");
  });
  it("blend states: 7 is ONE, INVSRCALPHA with the visibility in the colour", () => {
    const seven = blendState(7, 0);
    expect([seven.src, seven.dst]).toEqual(["one", "invSrcAlpha"]);
    expect(seven.premultiply).toBe(true);
    expect(seven.depthWrite).toBe(false);
    expect(blendState(4, 0)).toMatchObject({ src: "srcAlpha", dst: "one", srcAlpha: "zero", dstAlpha: "one" });
    expect(blendState(3, 0)).toMatchObject({ src: "one", dst: "one" });
    expect(blendState(2, 0)).toMatchObject({ src: "srcAlpha", dst: "invSrcAlpha", dstAlpha: "invSrcAlpha" });
    expect(blendState(5, 0)).toMatchObject({ src: "dstColor", dst: "zero" });
    expect(blendState(6, 0)).toMatchObject({ src: "dstColor", dst: "srcColor" });
  });
  it("alpha key writes depth unless flagged; blended batches never do", () => {
    expect(blendState(1, 0)).toMatchObject({ alphaKey: true, depthWrite: true, blended: false });
    expect(blendState(1, 16).depthWrite).toBe(false);
    expect(blendState(0, 0)).toMatchObject({ opaque: true, depthWrite: true, blended: false });
    expect(blendState(2, 0).depthWrite).toBe(false);
  });
  it("draw order: unique, priority first, then submesh, then layer", () => {
    expect(batchRenderOrder(0, 5)).toBeLessThan(batchRenderOrder(1, 0));
    expect(batchRenderOrder(1, 0)).toBeLessThan(batchRenderOrder(1, 1));
    expect(batchRenderOrder(100, 4000, 0)).toBeLessThan(batchRenderOrder(-100, 0, 1));
    expect(batchRenderOrder(-128, 0)).toBe(0);
  });
});

describe("composite math", () => {
  it("copy, alpha, multiply, overlay, screen as blend_into does them", () => {
    const d = [0.5, 0.5, 0.5, 1] as const;
    const s = [1, 0, 0, 0.5] as const;
    expect(blendTexel(d, s, 0)).toEqual([1, 0, 0, 0.5]);
    expect(blendTexel(d, s, 9)).toEqual([0.75, 0.25, 0.25, 1]);
    expect(blendTexel(d, s, 15)).toEqual([0.75, 0.25, 0.25, 0.75]);
    expect(blendTexel(d, s, 4)[3]).toBeCloseTo(0.25 + 1 * 0.5, 8);
    const screen = blendTexel(d, [1, 1, 1, 1], 7);
    expect(screen).toEqual([1, 1, 1, 1]);
    const overlayDark = blendTexel(d, [0.25, 0.25, 0.25, 1], 6);
    expect(overlayDark[0]).toBeCloseTo(0.25, 8);
    expect(() => blendTexel(d, s, 3)).toThrow();
  });
});

describe("pivots", () => {
  it("turns a baked translation back into retail's t", () => {
    const p: [number, number, number] = [1, 2, 3];
    // 90 degrees about Z, and a true translation of (0.5, 0, 0).
    const s = Math.SQRT1_2;
    const q = [0, 0, s, s];
    // R p = (-2, 1, 3), so T = p + t - R p.
    const baked = [1 + 0.5 + 2, 2 - 1, 3 - 3];
    const position = { name: "b4.position", times: new Float32Array([0]), values: new Float32Array(baked) };
    const quaternion = { name: "b4.quaternion", times: new Float32Array([0]), values: new Float32Array(q) };
    const pivots = new Array(5 * 3).fill(0);
    pivots[12] = p[0];
    pivots[13] = p[1];
    pivots[14] = p[2];
    expect(unbakeTranslations([position, quaternion], pivots)).toBe(1);
    expect(position.values[0]).toBeCloseTo(0.5, 5);
    expect(position.values[1]).toBeCloseTo(0, 5);
    expect(position.values[2]).toBeCloseTo(0, 5);
  });
  it("leaves bones at the origin alone and reads prefixed names", () => {
    const position = { name: "b0.position", times: new Float32Array([0]), values: new Float32Array([1, 1, 1]) };
    expect(unbakeTranslations([position], [0, 0, 0])).toBe(0);
    expect(position.values[0]).toBe(1);
    expect(boneIndex("b12")).toBe(12);
    expect(boneIndex("p3_b7")).toBe(7);
    expect(boneIndex("mesh")).toBe(-1);
  });
});

describe("fx", () => {
  it("sorts keys, samples linearly, loops global time, holds the ends", () => {
    const k = compileKeys([[1000, 0], [10, 0]])!;
    expect(Array.from(k.times)).toEqual([0, 1000]);
    expect(Array.from(k.values)).toEqual([0, 10]);
    const t = compileTrack({ globalLoop: 0, clips: { "*": [[0, 1000], [0, 10]] } }, [1000])!;
    const out = new Float32Array(1);
    sampleTrack(t, 500, out);
    expect(out[0]).toBe(5);
    sampleTrack(t, 1500, out);
    expect(out[0]).toBe(5);
    const held = compileTrack({ clips: { "*": [[100, 200], [1, 3]] } }, [])!;
    sampleTrack(held, 0, out);
    expect(out[0]).toBe(1);
    sampleTrack(held, 999, out);
    expect(out[0]).toBe(3);
  });
  it("a track follows the clip it is keyed for, and falls back to any-clip", () => {
    const t = compileTrack({ clips: { "*": [[0], [1]], walk: [[0], [2]] } }, [])!;
    const out = new Float32Array(1);
    t.now = t.byClip.get("walk")!;
    sampleTrack(t, 0, out);
    expect(out[0]).toBe(2);
    t.now = t.fallback;
    sampleTrack(t, 0, out);
    expect(out[0]).toBe(1);
  });
  it("drives colour, opacity and UV matrices, and setClip re-points tracks", () => {
    const extras: SubmeshExtras = { hash: 0, geoset: 0, units: [{ tex: 0, uvSet: 0, wrapS: true, wrapT: true, uvAnim: 0 }], shader: 0, blend: 2, flags: 0, priority: 0, color: 0, opacity: 0 };
    const colour = { x: 0, y: 0, z: 0, set(a: number, b: number, c: number) { this.x = a; this.y = b; this.z = c; return this; } };
    const weight = { x: 0, y: 0, z: 0, set(a: number, b: number, c: number) { this.x = a; this.y = b; this.z = c; return this; } };
    const target: FxTarget = {
      extras,
      uniforms: {
        uColor: { value: colour },
        uAlpha: { value: 1 },
        uWeight: { value: weight },
        uUv0: { value: { elements: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
        uUv1: { value: { elements: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
      },
    };
    const fx: FxData = {
      globalLoops: [1000],
      colors: [{ color: { clips: { "*": [[0], [[0.5, 0.25, 1]]] } }, alpha: { clips: { "*": [[0], [0.5]] } } }],
      opacity: [{ clips: { a: [[0], [0.5]], b: [[0], [1]] } }],
      uvAnims: [{ translation: { globalLoop: 0, clips: { "*": [[0, 1000], [[0, 0, 0], [1, 0, 0]]] } } }],
      particles: [],
      ribbons: [],
    };
    const rt = new FxRuntime(fx, [target]);
    expect(rt.animated).toBe(true);
    rt.setClip("a");
    rt.update(0, 250);
    expect(colour.x).toBeCloseTo(0.5, 6);
    expect(colour.y).toBeCloseTo(0.25, 6);
    expect(target.uniforms.uAlpha.value).toBeCloseTo(0.25, 6);
    expect(weight.x).toBeCloseTo(0.5, 6);
    expect(target.uniforms.uUv0.value.elements[6]).toBeCloseTo(0.25, 6);
    rt.setClip("b");
    rt.update(0, 250);
    expect(target.uniforms.uAlpha.value).toBeCloseTo(0.5, 6);
  });
  it("no fx at all is fine", () => {
    const rt = new FxRuntime(null, []);
    expect(rt.animated).toBe(false);
    rt.setClip("x");
    rt.update(0, 0);
  });
});
