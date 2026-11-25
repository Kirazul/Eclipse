/**
 * Which retail program draws a batch, from its shader id. A port of the rules in
 * Eclipse's tools/retailmounts/retail_programs.py (retail's uber combiner cases)
 * and tools/lib/m2_port.py (retail_ops); no three.js in here, so it can be tested.
 */

/** Retail pixel program -> uber combiner case. */
const PIXEL: Record<string, number> = {
  Combiners_Opaque: 0, Combiners_Mod: 1, Combiners_Opaque_Mod: 2, Combiners_Opaque_Mod2x: 3,
  Combiners_Opaque_Mod2xNA: 4, Combiners_Opaque_Opaque: 5, Combiners_Mod_Mod: 6, Combiners_Mod_Mod2x: 7,
  Combiners_Mod_Add: 8, Combiners_Mod_Mod2xNA: 9, Combiners_Mod_AddNA: 10, Combiners_Mod_Opaque: 11,
  Combiners_Opaque_Mod2xNA_Alpha: 12, Combiners_Opaque_AddAlpha: 13, Combiners_Opaque_AddAlpha_Alpha: 14,
  Combiners_Opaque_Mod2xNA_Alpha_Add: 15, Combiners_Mod_AddAlpha: 16, Combiners_Mod_AddAlpha_Alpha: 17,
  Combiners_Opaque_Alpha_Alpha: 18, Combiners_Opaque_Mod2xNA_Alpha_3s: 19, Combiners_Opaque_AddAlpha_Wgt: 20,
  Combiners_Mod_Add_Alpha: 21, Combiners_Opaque_ModNA_Alpha: 22, Combiners_Mod_AddAlpha_Wgt: 23,
  Combiners_Opaque_Mod_Add_Wgt: 24, Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha: 25, Combiners_Mod_Dual_Crossfade: 26,
  Combiners_Opaque_Mod2xNA_Alpha_Alpha: 27, Combiners_Mod_Masked_Dual_Crossfade: 28, Combiners_Opaque_Alpha: 29,
  Guild: 30, Guild_NoBorder: 31, Guild_Opaque: 32, Combiners_Mod_Depth: 33, Illum: 34,
  Combiners_Mod_Mod_Mod_Const: 35, Combiners_Mod_Mod_Depth: 36,
};

/** Retail vertex program -> UV source per unit (0 UV set 1, 1 UV set 2, 2 sphere map) and edge fade. */
const VERTEX: Record<string, readonly [readonly number[], boolean]> = {
  Diffuse_T1: [[0], false], Diffuse_T2: [[1], false], Diffuse_Env: [[2], false],
  Diffuse_T1_T2: [[0, 1], false], Diffuse_T1_Env: [[0, 2], false], Diffuse_Env_T1: [[2, 0], false],
  Diffuse_Env_Env: [[2, 2], false], Diffuse_T1_Env_T1: [[0, 2, 0], false], Diffuse_T1_T1: [[0, 0], false],
  Diffuse_T1_T1_T1: [[0, 0, 0], false], Diffuse_EdgeFade_T1: [[0], true], Diffuse_EdgeFade_T1_T2: [[0, 1], true],
  Diffuse_EdgeFade_Env: [[2], true], Diffuse_T1_Env_T2: [[0, 2, 1], false], Diffuse_T1_T2_T1: [[0, 1, 0], false],
  Diffuse_T1_T2_T3: [[0, 1, 1], false], Color_T1_T2_T3: [[0, 1, 1], false],
};

/** Retail's M2 shader table: entry = shader id & 0x7FFF when bit 0x8000 is set. */
const TABLE: readonly (readonly [string, string])[] = [
  ["Combiners_Opaque_Mod2xNA_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_AddAlpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_AddAlpha_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_Mod2xNA_Alpha_Add", "Diffuse_T1_Env_T1"],
  ["Combiners_Mod_AddAlpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_AddAlpha", "Diffuse_T1_T1"],
  ["Combiners_Mod_AddAlpha", "Diffuse_T1_T1"],
  ["Combiners_Mod_AddAlpha_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_Alpha_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_Mod2xNA_Alpha_3s", "Diffuse_T1_Env_T1"],
  ["Combiners_Opaque_AddAlpha_Wgt", "Diffuse_T1_T1"],
  ["Combiners_Mod_Add_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Opaque_ModNA_Alpha", "Diffuse_T1_Env"],
  ["Combiners_Mod_AddAlpha_Wgt", "Diffuse_T1_Env"],
  ["Combiners_Mod_AddAlpha_Wgt", "Diffuse_T1_T1"],
  ["Combiners_Opaque_AddAlpha_Wgt", "Diffuse_T1_T2"],
  ["Combiners_Opaque_Mod_Add_Wgt", "Diffuse_T1_Env"],
  ["Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha", "Diffuse_T1_Env_T1"],
  ["Combiners_Mod_Dual_Crossfade", "Diffuse_T1"],
  ["Combiners_Mod_Depth", "Diffuse_EdgeFade_T1"],
  ["Combiners_Opaque_Mod2xNA_Alpha_Alpha", "Diffuse_T1_Env_T2"],
  ["Combiners_Mod_Mod", "Diffuse_EdgeFade_T1_T2"],
  ["Combiners_Mod_Masked_Dual_Crossfade", "Diffuse_T1_T2"],
  ["Combiners_Opaque_Alpha", "Diffuse_T1_T1"],
  ["Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha", "Diffuse_T1_Env_T2"],
  ["Combiners_Mod_Depth", "Diffuse_EdgeFade_Env"],
  ["Guild", "Diffuse_T1_T2_T1"],
  ["Guild_NoBorder", "Diffuse_T1_T2"],
  ["Guild_Opaque", "Diffuse_T1_T2_T1"],
  ["Illum", "Diffuse_T1_T1"],
  ["Combiners_Mod_Mod_Mod_Const", "Diffuse_T1_T2_T3"],
  ["Combiners_Mod_Mod_Mod_Const", "Color_T1_T2_T3"],
  ["Combiners_Opaque", "Diffuse_T1"],
  ["Combiners_Mod_Mod2x", "Diffuse_EdgeFade_T1_T2"],
  ["Combiners_Mod", "Diffuse_EdgeFade_T1"],
  ["Combiners_Mod_Mod_Depth", "Diffuse_EdgeFade_T1_T2"],
];

export function vertexProgram(units: number, shader: number): string {
  if (shader & 0x8000) return TABLE[shader & 0x7fff]?.[1] ?? "Diffuse_T1";
  if (units <= 1) {
    if (shader & 0x80) return "Diffuse_Env";
    return shader & 0x4000 ? "Diffuse_T2" : "Diffuse_T1";
  }
  if (shader & 0x80) return shader & 0x8 ? "Diffuse_Env_Env" : "Diffuse_Env_T1";
  if (shader & 0x8) return "Diffuse_T1_Env";
  return shader & 0x4000 ? "Diffuse_T1_T2" : "Diffuse_T1_T1";
}

export function pixelProgram(units: number, shader: number): string {
  if (shader & 0x8000) return TABLE[shader & 0x7fff]?.[0] ?? "Combiners_Opaque";
  if (units <= 1) return shader & 0x70 ? "Combiners_Mod" : "Combiners_Opaque";
  const low = shader & 7;
  if (shader & 0x70) {
    if (low === 3) return "Combiners_Mod_Add";
    if (low === 4) return "Combiners_Mod_Mod2x";
    if (low === 6) return "Combiners_Mod_Mod2xNA";
    if (low === 7) return "Combiners_Mod_AddNA";
    return "Combiners_Mod_Mod";
  }
  if (low === 0) return "Combiners_Opaque_Opaque";
  if (low === 3 || low === 7) return "Combiners_Opaque_AddAlpha";
  if (low === 4) return "Combiners_Opaque_Mod2x";
  if (low === 6) return "Combiners_Opaque_Mod2xNA";
  return "Combiners_Opaque_Mod";
}

export interface BatchProgram {
  /** Uber combiner case. */
  combiner: number;
  /** Textures the case samples. */
  samples: number;
  uvSources: [number, number, number];
  edgeFade: boolean;
}

/**
 * Combiner cases as GLSL. d = diffuse (lit), s = specular (added after lighting),
 * a = alpha. These are Eclipse's retail_shaders.py CASES, statement for statement.
 * APPROXIMATE marks programs Eclipse has not ported either: their base stands in.
 */
export const COMBINER_GLSL: Record<number, { samples: number; body: string; approximate?: boolean }> = {
  0: { samples: 1, body: "d = t0.rgb; a = 1.0;" },
  1: { samples: 1, body: "d = t0.rgb; a = t0.a;" },
  2: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t1.a;" },
  3: { samples: 2, body: "d = t0.rgb * t1.rgb * 2.0; a = t1.a * 2.0;" },
  4: { samples: 2, body: "d = t0.rgb * t1.rgb * 2.0; a = 1.0;" },
  5: { samples: 2, body: "d = t0.rgb * t1.rgb; a = 1.0;" },
  6: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t0.a * t1.a;" },
  7: { samples: 2, body: "d = t0.rgb * t1.rgb * 2.0; a = t0.a * t1.a * 2.0;" },
  8: { samples: 2, body: "d = t0.rgb; s = t1.rgb; a = t0.a + t1.a;" },
  9: { samples: 2, body: "d = t0.rgb * t1.rgb * 2.0; a = t0.a;" },
  10: { samples: 2, body: "d = t0.rgb; s = t1.rgb; a = t0.a;" },
  11: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t0.a;" },
  12: { samples: 2, body: "d = mix(t0.rgb * t1.rgb * 2.0, t0.rgb, t0.a); a = 1.0;" },
  13: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a; a = 1.0;" },
  14: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a * (1.0 - t0.a); a = 1.0;" },
  15: { samples: 3, body: "d = mix(t0.rgb * t1.rgb * 2.0, t0.rgb, t0.a); s = t2.rgb * t2.a * uWeight.z; a = 1.0;" },
  16: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a; a = t0.a;" },
  17: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a * (1.0 - t0.a); a = t0.a + t1.a * (0.3 * t1.r + 0.59 * t1.g + 0.11 * t1.b);" },
  18: { samples: 2, body: "d = mix(mix(t0.rgb, t1.rgb, t1.a), t0.rgb, t0.a); a = 1.0;" },
  19: { samples: 3, body: "d = mix(t0.rgb * t1.rgb * 2.0, t2.rgb, t2.a); a = 1.0;" },
  20: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a * uWeight.y; a = 1.0;" },
  21: { samples: 2, body: "d = t0.rgb; s = t1.rgb * (1.0 - t0.a); a = t0.a + t1.a;" },
  22: { samples: 2, body: "d = mix(t0.rgb * t1.rgb, t0.rgb, t0.a); a = 1.0;" },
  23: { samples: 2, body: "d = t0.rgb; s = t1.rgb * t1.a * uWeight.y; a = t0.a;" },
  24: { samples: 2, body: "d = mix(t0.rgb, t1.rgb, t1.a); s = t0.rgb * t0.a * uWeight.x; a = 1.0;" },
  25: { samples: 3, body: "float g = clamp(t2.a * uWeight.z, 0.0, 1.0); d = mix(t0.rgb * t1.rgb * 2.0, t0.rgb, t0.a) * (1.0 - g); s = t2.rgb * g; a = 1.0;" },
  26: { samples: 1, body: "d = t0.rgb; a = t0.a;", approximate: true },
  27: { samples: 3, body: "d = mix(mix(t0.rgb * t1.rgb * 2.0, t2.rgb, t2.a), t0.rgb, t0.a); a = 1.0;" },
  28: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t0.a * t1.a;", approximate: true },
  29: { samples: 2, body: "d = mix(t0.rgb, t1.rgb, t1.a); a = 1.0;" },
  30: { samples: 2, body: "d = mix(t0.rgb, t1.rgb, t1.a); a = 1.0;", approximate: true },
  31: { samples: 2, body: "d = mix(t0.rgb, t1.rgb, t1.a); a = t0.a;", approximate: true },
  32: { samples: 2, body: "d = mix(t0.rgb, t1.rgb, t1.a); a = 1.0;", approximate: true },
  33: { samples: 1, body: "d = t0.rgb; a = t0.a;", approximate: true },
  34: { samples: 1, body: "d = t0.rgb; a = 1.0;", approximate: true },
  35: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t0.a * t1.a;", approximate: true },
  36: { samples: 2, body: "d = t0.rgb * t1.rgb; a = t0.a * t1.a;" },
};

export function batchProgram(units: number, shader: number): BatchProgram {
  const combiner = PIXEL[pixelProgram(units, shader)] ?? 0;
  const [uvs, edgeFade] = VERTEX[vertexProgram(units, shader)] ?? VERTEX.Diffuse_T1!;
  return {
    combiner,
    samples: COMBINER_GLSL[combiner]?.samples ?? 1,
    uvSources: [uvs[0] ?? 0, uvs[1] ?? 0, uvs[2] ?? 0],
    edgeFade,
  };
}

/**
 * The batch programs the item catalogue uses, most common first: 26 keys over every GLB of
 * its 3,274 items (a program is one per combiner case, side and alpha key). A shader id here
 * only picks the case.
 */
export const CATALOGUE_PROGRAMS: readonly { units: number; shader: number; blend: number; flags: number }[] = [
  { units: 2, shader: 0x8000, blend: 0, flags: 0 }, { units: 2, shader: 0x11, blend: 2, flags: 4 }, { units: 2, shader: 0x11, blend: 2, flags: 0 },
  { units: 3, shader: 0x8003, blend: 0, flags: 0 }, { units: 1, shader: 0x10, blend: 2, flags: 0 }, { units: 1, shader: 0, blend: 0, flags: 0 },
  { units: 1, shader: 0x10, blend: 1, flags: 0 }, { units: 2, shader: 0x14, blend: 2, flags: 4 }, { units: 2, shader: 0x8000, blend: 0, flags: 4 },
  { units: 2, shader: 0x8002, blend: 0, flags: 0 }, { units: 1, shader: 0x10, blend: 1, flags: 4 }, { units: 1, shader: 0x10, blend: 2, flags: 4 },
  { units: 2, shader: 6, blend: 0, flags: 0 }, { units: 2, shader: 0x16, blend: 2, flags: 0 }, { units: 3, shader: 0x8003, blend: 0, flags: 4 },
  { units: 2, shader: 0x8002, blend: 0, flags: 4 }, { units: 2, shader: 0x13, blend: 2, flags: 0 }, { units: 2, shader: 0x14, blend: 2, flags: 0 },
  { units: 2, shader: 0x8017, blend: 0, flags: 0 }, { units: 1, shader: 0, blend: 0, flags: 4 }, { units: 2, shader: 0x800b, blend: 2, flags: 0 },
  { units: 2, shader: 0x8001, blend: 0, flags: 0 }, { units: 2, shader: 0x8023, blend: 2, flags: 4 }, { units: 2, shader: 0x11, blend: 1, flags: 4 },
  { units: 2, shader: 0x8017, blend: 0, flags: 4 }, { units: 2, shader: 0x800a, blend: 0, flags: 0 },
];

/** GL blend state for a retail blend mode, in terms the renderer can apply. */
export type BlendFactor = "one" | "zero" | "srcAlpha" | "invSrcAlpha" | "dstColor" | "srcColor";
export interface BlendState {
  blended: boolean;
  src: BlendFactor;
  dst: BlendFactor;
  srcAlpha: BlendFactor;
  dstAlpha: BlendFactor;
  /** Batch writes depth. Only opaque and alpha-key do. */
  depthWrite: boolean;
  alphaKey: boolean;
  /** Opacity forced to 1, the batch is opaque. */
  opaque: boolean;
  /** Visibility is carried in the colour: the destination ignores source alpha. */
  premultiply: boolean;
}

/**
 * Colour factors are retail's own (Eclipse: re/verify/verify_retail_render.py and
 * tools/lib/m2_port.py). Alpha factors keep the canvas's alpha meaningful for the
 * page behind it: the canvas is premultiplied and sits over a CSS scene, so glows
 * add to the page (alpha untouched) and alpha blends accumulate coverage.
 * Blend 7 is ONE, INVSRCALPHA: treated as plain alpha it was about 6x too dark.
 */
export function blendState(blend: number, flags: number): BlendState {
  const noDepth = (flags & 16) !== 0;
  const solid = { blended: false, src: "one", dst: "zero", srcAlpha: "one", dstAlpha: "zero", premultiply: false } as const;
  const keepAlpha = { srcAlpha: "zero", dstAlpha: "one" } as const;
  const overAlpha = { srcAlpha: "one", dstAlpha: "invSrcAlpha" } as const;
  switch (blend) {
    case 0:
      return { ...solid, depthWrite: !noDepth, alphaKey: false, opaque: true };
    case 1:
      return { ...solid, depthWrite: !noDepth, alphaKey: true, opaque: false };
    case 2:
      return { blended: true, src: "srcAlpha", dst: "invSrcAlpha", ...overAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: false };
    case 3:
      return { blended: true, src: "one", dst: "one", ...keepAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: false };
    case 4:
      return { blended: true, src: "srcAlpha", dst: "one", ...keepAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: false };
    case 5:
      return { blended: true, src: "dstColor", dst: "zero", ...keepAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: false };
    case 6:
      return { blended: true, src: "dstColor", dst: "srcColor", ...keepAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: false };
    case 7:
      return { blended: true, src: "one", dst: "invSrcAlpha", ...overAlpha, depthWrite: false, alphaKey: false, opaque: false, premultiply: true };
    default:
      return { ...solid, depthWrite: !noDepth, alphaKey: false, opaque: true };
  }
}

/**
 * A stable draw order: retail's priority plane, then the batch's order in the
 * submesh list, then the piece's layer. Every value is unique within a figure, so
 * the renderer's distance sort never decides anything and cannot flip between frames.
 */
export function batchRenderOrder(priority: number, submeshOrder: number, layer = 0): number {
  return layer * 1e7 + (priority + 128) * 4096 + submeshOrder;
}
