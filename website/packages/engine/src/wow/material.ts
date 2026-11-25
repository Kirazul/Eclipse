/**
 * Retail's M2 batch as a ShaderMaterial. Materials stay data: everything comes from
 * SubmeshExtras, so a rule fix needs no re-bake. The source of each combiner case is
 * in programs.ts. One program per combiner case in use (three caches by source),
 * so a figure compiles a handful of programs however many batches it has.
 *
 * The whole path is in gamma space, as retail's is: textures are read raw and the
 * result is written raw. Composition after the case is retail's: alpha test at
 * 128/255, opacity x vertex alpha x visibility, specular added after lighting.
 */
import {
  AddEquation,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  FrontSide,
  Matrix3,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  SrcColorFactor,
  Vector3,
  Vector4,
  ZeroFactor,
  type BlendingDstFactor,
  type BlendingSrcFactor,
  type Texture,
} from "three";
import type { SubmeshExtras } from "@eclipse/format";
import { ALPHA_KEY, EDGE_FADE, LIGHTING } from "../constants";
import { COMBINER_GLSL, batchProgram, blendState, type BlendFactor, type BlendState } from "./programs";

const FACTORS: Record<BlendFactor, BlendingSrcFactor & BlendingDstFactor> = {
  one: OneFactor,
  zero: ZeroFactor,
  srcAlpha: SrcAlphaFactor,
  invSrcAlpha: OneMinusSrcAlphaFactor,
  dstColor: DstColorFactor as never,
  srcColor: SrcColorFactor,
};

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform mat3 uUv0;
uniform mat3 uUv1;
uniform vec3 uUvSrc;
uniform vec4 uEdge;
varying vec4 vUv01;
varying vec2 vUv2;
varying vec3 vNormalV;
varying float vVis;

vec2 unitUv(float src, mat3 m, vec2 t0, vec2 t1, vec2 env) {
  if (src > 1.5) return env;
  return (m * vec3(src > 0.5 ? t1 : t0, 1.0)).xy;
}

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 n = normalize(normalMatrix * objectNormal);
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mv;

  vec2 t0 = uv;
  #ifdef USE_UV1
    vec2 t1 = uv1;
  #else
    vec2 t1 = uv;
  #endif
  // Retail's sphere map.
  vec3 np = -normalize(mv.xyz);
  vec3 r = np - n * (2.0 * dot(np, n));
  r.z += 1.0;
  vec2 env = normalize(r).xy * 0.5 + 0.5;
  vUv01 = vec4(unitUv(uUvSrc.x, uUv0, t0, t1, env), unitUv(uUvSrc.y, uUv1, t0, t1, env));
  vUv2 = unitUv(uUvSrc.z, mat3(1.0), t0, t1, env);

  vNormalV = n;
  float vis = 1.0;
  if (uEdge.w > 0.5) {
    float c = min(abs(dot(np, n)), 1.0);
    float span = uEdge.x - uEdge.y;
    span = abs(span) < 0.000001 ? 0.000001 : span;
    vis = pow(clamp((c - uEdge.y) / span, 0.0, 1.0), uEdge.z);
  }
  vVis = vis;
}`;

function fragmentFor(combiner: number): string {
  const c = COMBINER_GLSL[combiner] ?? COMBINER_GLSL[0]!;
  const [ar, ag, ab] = LIGHTING.ambient;
  const [sr, sg, sb] = LIGHTING.sun;
  const l = Math.hypot(...LIGHTING.sunDir);
  const [dx, dy, dz] = LIGHTING.sunDir.map((v) => v / l) as [number, number, number];
  const f = (v: number) => v.toFixed(5);
  return /* glsl */ `
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uWeight;
uniform vec4 uFlags;
uniform float uLit;
uniform float uSolid;
uniform vec3 uTint;
uniform float uUserOpacity;
uniform sampler2D uEm;
uniform float uEmOn;
varying vec4 vUv01;
varying vec2 vUv2;
varying vec3 vNormalV;
varying float vVis;

void main() {
  vec4 t0 = texture2D(uT0, vUv01.xy);
  ${c.samples > 1 ? "vec4 t1 = texture2D(uT1, vUv01.zw);" : ""}
  ${c.samples > 2 ? "vec4 t2 = texture2D(uT2, vUv2);" : ""}
  vec3 d = t0.rgb;
  vec3 s = vec3(0.0);
  float a = 1.0;
  ${c.body}
  if (uFlags.x > 0.5) {
    if (a < ${ALPHA_KEY.toFixed(8)}) discard;
    a = 1.0;
  } else if (uFlags.y > 0.5) {
    a = 1.0;
  }
  float opacity = a * uAlpha;
  if (uFlags.w > 0.5) opacity *= vVis;

  vec3 lit = vec3(1.0);
  if (uLit > 0.5) {
    vec3 n = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
    float ndl = clamp(dot(n, vec3(${f(dx)}, ${f(dy)}, ${f(dz)})), 0.0, 1.0);
    lit = clamp(vec3(${f(ar)}, ${f(ag)}, ${f(ab)}) + vec3(${f(sr)}, ${f(sg)}, ${f(sb)}) * ndl, 0.0, 1.0);
  }
  vec3 rgb = d * clamp(uColor * lit, 0.0, 1.0) + s;
  // Retail's emissive channel: the skin batch's add term, after lighting.
  if (uEmOn > 0.5) rgb += texture2D(uEm, vUv01.xy).rgb;
  float alpha = opacity * vVis;
  if (uFlags.z > 0.5) rgb *= vVis;
  gl_FragColor = vec4(rgb * uTint, uSolid > 0.5 ? 1.0 : alpha * uUserOpacity);
}`;
}

const fragmentCache = new Map<number, string>();

export interface BatchUniforms {
  uT0: { value: Texture | null };
  uT1: { value: Texture | null };
  uT2: { value: Texture | null };
  uUv0: { value: Matrix3 };
  uUv1: { value: Matrix3 };
  uUvSrc: { value: Vector3 };
  uEdge: { value: Vector4 };
  uColor: { value: Vector3 };
  uAlpha: { value: number };
  uWeight: { value: Vector3 };
  uFlags: { value: Vector4 };
  uLit: { value: number };
  uSolid: { value: number };
  uTint: { value: Vector3 };
  uUserOpacity: { value: number };
  uEm: { value: Texture | null };
  uEmOn: { value: number };
}

export class BatchMaterial extends ShaderMaterial {
  declare uniforms: BatchUniforms & ShaderMaterial["uniforms"];
  readonly state: BlendState;
  readonly combiner: number;
  /** The user's transparency toggle sits over retail's own state. */
  userTransparent = false;

  /** `twoUvSets`: the geometry has TEXCOORD_1. */
  constructor(readonly extras: SubmeshExtras, twoUvSets = false) {
    const program = batchProgram(extras.units.length, extras.shader);
    let fragmentShader = fragmentCache.get(program.combiner);
    if (!fragmentShader) {
      fragmentShader = fragmentFor(program.combiner);
      fragmentCache.set(program.combiner, fragmentShader);
    }
    const state = blendState(extras.blend, extras.flags);
    const uniforms: BatchUniforms = {
      uT0: { value: null },
      uT1: { value: null },
      uT2: { value: null },
      uUv0: { value: new Matrix3() },
      uUv1: { value: new Matrix3() },
      uUvSrc: { value: new Vector3(...program.uvSources) },
      uEdge: { value: new Vector4(EDGE_FADE[0], EDGE_FADE[1], EDGE_FADE[2], program.edgeFade ? 1 : 0) },
      uColor: { value: new Vector3(1, 1, 1) },
      uAlpha: { value: 1 },
      uWeight: { value: new Vector3(1, 1, 1) },
      uFlags: { value: new Vector4(state.alphaKey ? 1 : 0, state.opaque ? 1 : 0, state.premultiply ? 1 : 0, program.combiner === 36 ? 1 : 0) },
      uLit: { value: extras.flags & 1 ? 0 : 1 },
      uSolid: { value: state.blended ? 0 : 1 },
      uTint: { value: new Vector3(1, 1, 1) },
      uUserOpacity: { value: 1 },
      uEm: { value: null },
      uEmOn: { value: 0 },
    };
    super({
      vertexShader: VERT,
      fragmentShader,
      uniforms: uniforms as unknown as ShaderMaterial["uniforms"],
      // three only declares `uv1` for a built-in map on channel 1, and this material has none:
      // said here, or every unit on UV set 2 reads set 1 and a flame's mask covers nothing.
      ...(twoUvSets ? { defines: { USE_UV1: "" } } : {}),
      side: extras.flags & 4 ? DoubleSide : FrontSide,
      name: `batch-${extras.hash}`,
    });
    this.state = state;
    this.combiner = program.combiner;
    this.applyBlend(state);
    this.toneMapped = false;
  }

  private applyBlend(s: BlendState): void {
    if (!s.blended) {
      this.blending = NoBlending;
      this.transparent = false;
      this.depthWrite = s.depthWrite;
      return;
    }
    this.blending = CustomBlending;
    this.transparent = true;
    this.blendEquation = AddEquation;
    this.blendSrc = FACTORS[s.src];
    this.blendDst = FACTORS[s.dst];
    this.blendSrcAlpha = FACTORS[s.srcAlpha];
    this.blendDstAlpha = FACTORS[s.dstAlpha];
    this.depthWrite = s.depthWrite;
  }

  /** The Model Parts toggle. Off returns the batch to retail's own state. */
  setUserTransparent(on: boolean): void {
    this.userTransparent = on;
    if (on) {
      this.applyBlend({ ...blendState(2, 0), depthWrite: this.depthWrite });
      this.uniforms.uSolid.value = 0;
    } else {
      const depthWrite = this.depthWrite;
      this.applyBlend(this.state);
      this.depthWrite = depthWrite;
      this.uniforms.uSolid.value = this.state.blended ? 0 : 1;
    }
    this.needsUpdate = true;
  }

  /** Alpha-key batches cut their shadow too: three reads `map` and `alphaTest` for that. */
  setShadowCut(texture: Texture | null): void {
    if (!this.state.alphaKey || !texture) return;
    (this as unknown as { map: Texture }).map = texture;
    this.alphaTest = ALPHA_KEY;
  }
}
