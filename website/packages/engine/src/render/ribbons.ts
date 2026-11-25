/**
 * Drawing a retail ribbon (the simulation is ribbonsSim.ts).
 *
 * Retail ships three textures over one material on most ribbons. Three or more textures
 * are its `gpuribbon` program, one pass: t0 x t1 x t2 x colour x 4 with per-layer scale
 * and scrolled offset. Fewer are one pass per texture, each with its own material.
 *
 * three.js has no strip mode, so the strip is a fixed index buffer of two triangles per
 * edge, twice around the ring (the client's own trick for a wrapping strip), and a draw
 * range picks the live part. Nothing is rebuilt and a frame allocates nothing.
 */
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  NoBlending,
  ShaderMaterial,
  Vector2,
  Vector4,
  type Texture,
} from "three";
import { blendState } from "../wow/programs";
import { whiteTexture } from "../model/loaders";
import { BLEND_FACTORS } from "./particles";
import { RIBBON_STRIDE, type RibbonEmitterSim } from "./ribbonsSim";

const VERT = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aColor;
uniform vec4 uLayer0;
uniform vec4 uLayer1;
uniform vec4 uLayer2;
varying vec4 vColor;
varying vec4 vUv01;
varying vec2 vUv2;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
  vUv01 = vec4(aUv * uLayer0.xy + uLayer0.zw, aUv * uLayer1.xy + uLayer1.zw);
  vUv2 = aUv * uLayer2.xy + uLayer2.zw;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
// x three textures, y alpha key
uniform vec2 uMode;
varying vec4 vColor;
varying vec4 vUv01;
varying vec2 vUv2;

void main() {
  vec4 out0 = texture2D(uT0, vUv01.xy);
  if (uMode.x > 0.5) out0 = out0 * texture2D(uT1, vUv01.zw) * texture2D(uT2, vUv2) * vColor * 4.0;
  else out0 = out0 * vColor;
  if (uMode.y > 0.5 && out0.a < 0.501960814) discard;
  gl_FragColor = out0;
}`;

export class RibbonMesh {
  /** One per pass. */
  readonly meshes: Mesh[] = [];
  readonly materials: ShaderMaterial[] = [];
  private readonly geometry: BufferGeometry;
  private readonly buffer: InterleavedBuffer;
  readonly three: boolean;

  constructor(
    readonly sim: RibbonEmitterSim,
    renderOrder: number,
  ) {
    const geometry = new BufferGeometry();
    this.buffer = new InterleavedBuffer(sim.vertices, RIBBON_STRIDE);
    this.buffer.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", new InterleavedBufferAttribute(this.buffer, 3, 0));
    geometry.setAttribute("aUv", new InterleavedBufferAttribute(this.buffer, 2, 3));
    geometry.setAttribute("aColor", new InterleavedBufferAttribute(this.buffer, 4, 5));
    const E = sim.edges;
    const index = new (E * 2 > 0xffff ? Uint32Array : Uint16Array)(E * 2 * 6);
    for (let i = 0; i < E * 2; i++) {
      const a = (i % E) * 2;
      const c = ((i + 1) % E) * 2;
      index.set([a, a + 1, c, c, a + 1, c + 1], i * 6);
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    this.geometry = geometry;

    const data = sim.data;
    this.three = data.tex.length >= 3;
    // A texture past the last material has no pass (Eclipse's fit_ribbon_layers).
    const passes = this.three ? 1 : Math.min(data.tex.length, Math.max(1, data.mats.length));
    for (let p = 0; p < passes; p++) {
      const mat = data.mats[p] ?? data.mats[0] ?? { blend: 2, flags: 1 };
      const state = blendState(mat.blend, mat.flags);
      const layer = (k: number) => {
        const l = this.three ? data.layers?.[k] : undefined;
        return new Vector4(l?.scale[0] ?? 1, l?.scale[1] ?? 1, 0, 0);
      };
      const material = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uT0: { value: whiteTexture() },
          uT1: { value: whiteTexture() },
          uT2: { value: whiteTexture() },
          uLayer0: { value: layer(0) },
          uLayer1: { value: layer(1) },
          uLayer2: { value: layer(2) },
          uMode: { value: new Vector2(this.three ? 1 : 0, mat.blend === 1 ? 1 : 0) },
        },
        side: DoubleSide,
        depthTest: (mat.flags & 8) === 0,
        depthWrite: (mat.flags & 16) === 0,
        transparent: state.blended,
        toneMapped: false,
        fog: false,
        lights: false,
      });
      if (state.blended) {
        material.blending = CustomBlending;
        material.blendEquation = AddEquation;
        material.blendSrc = BLEND_FACTORS[state.src];
        material.blendDst = BLEND_FACTORS[state.dst];
        material.blendSrcAlpha = BLEND_FACTORS[state.srcAlpha];
        material.blendDstAlpha = BLEND_FACTORS[state.dstAlpha];
      } else {
        material.blending = NoBlending;
      }
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = renderOrder + p;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.materials.push(material);
    }
  }

  setTexture(pass: number, unit: number, texture: Texture): void {
    const key = unit === 0 ? "uT0" : unit === 1 ? "uT1" : "uT2";
    const m = this.materials[pass];
    if (m) m.uniforms[key]!.value = texture;
  }

  /** Uploads the ring and sets the live range. Allocates nothing. */
  draw(): void {
    const sim = this.sim;
    const segments = sim.segments;
    const visible = segments > 0;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]!.visible = visible;
    if (!visible) return;
    this.geometry.setDrawRange(sim.readPos * 6, segments * 6);
    this.buffer.needsUpdate = true;
    if (this.three) {
      const u = this.materials[0]!.uniforms;
      const o = sim.offsets;
      (u.uLayer0!.value as Vector4).z = o[0]!;
      (u.uLayer0!.value as Vector4).w = o[1]!;
      (u.uLayer1!.value as Vector4).z = o[2]!;
      (u.uLayer1!.value as Vector4).w = o[3]!;
      (u.uLayer2!.value as Vector4).z = o[4]!;
      (u.uLayer2!.value as Vector4).w = o[5]!;
    }
  }

  hide(): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]!.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
