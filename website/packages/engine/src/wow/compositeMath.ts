/**
 * One texel of the body composite, in the CPU form: Eclipse's blend_into
 * (tools/races/races_spec.py), itself wow.export's compositor. The GPU pass in
 * composite.ts must agree with this within rounding; the browser test checks it.
 * Values are 0..1 RGBA.
 */
export type Rgba = readonly [number, number, number, number];

export function blendTexel(dst: Rgba, src: Rgba, mode: number): [number, number, number, number] {
  const sa = src[3];
  if (mode === 0 || mode === 1) return [src[0], src[1], src[2], src[3]];
  if (mode === 9 || mode === 15) {
    const a = mode === 9 ? sa + dst[3] * (1 - sa) : sa * sa + dst[3] * (1 - sa);
    return [
      src[0] * sa + dst[0] * (1 - sa),
      src[1] * sa + dst[1] * (1 - sa),
      src[2] * sa + dst[2] * (1 - sa),
      a,
    ];
  }
  let c: [number, number, number, number];
  if (mode === 4) {
    c = [dst[0] * src[0], dst[1] * src[1], dst[2] * src[2], dst[3] * src[3]];
  } else if (mode === 7) {
    c = [1 - (1 - dst[0]) * (1 - src[0]), 1 - (1 - dst[1]) * (1 - src[1]), 1 - (1 - dst[2]) * (1 - src[2]), sa];
  } else if (mode === 6) {
    const o = (d: number, s: number) => (s < 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s));
    c = [o(dst[0], src[0]), o(dst[1], src[1]), o(dst[2], src[2]), sa];
  } else {
    throw new Error(`blend mode ${mode} is not one retail uses here`);
  }
  const ca = c[3];
  return [
    c[0] * ca + dst[0] * (1 - ca),
    c[1] * ca + dst[1] * (1 - ca),
    c[2] * ca + dst[2] * (1 - ca),
    ca * ca + dst[3] * (1 - ca),
  ];
}
