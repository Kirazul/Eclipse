/**
 * What a GPU tier buys. Tiers 1 to 3 match Khada; tier 0 is scaled down where he
 * gives it the full device pixel ratio, and anisotropy follows the tier where he
 * leaves GLB textures at the default of 1.
 */
export function pixelRatioFor(tier: number, dpr: number, opts: { mobile?: boolean; failed?: boolean } = {}): number {
  if (opts.failed) return dpr * 0.8;
  if (tier <= 0) return dpr * 0.7;
  if (opts.mobile) return dpr * 0.8;
  if (tier === 1) return dpr * 0.8;
  if (tier === 2) return dpr * 0.9;
  return dpr;
}

export function anisotropyFor(tier: number, max: number): number {
  const cap = tier <= 0 ? 2 : tier === 1 ? 4 : tier === 2 ? 8 : max;
  return Math.max(1, Math.min(cap, max));
}

/**
 * detect-gpu answers tier 1, type FALLBACK, for a GPU missing from its table. That
 * is mostly a card newer than the table, which would be scaled down on the strongest
 * machines (measured here: an RTX 5060 Ti). A known discrete brand counts as tier 3;
 * anything else unknown as tier 2.
 */
export function effectiveTier(result: { tier: number; type?: string }, rendererName: string): number {
  if (result.type !== "FALLBACK") return result.tier;
  return /nvidia|geforce|radeon rx|radeon pro|intel.*arc/i.test(rendererName) ? 3 : 2;
}

/** Software rasterisers are known at once; no benchmark table is needed for them. */
export function isSoftwareRenderer(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}
