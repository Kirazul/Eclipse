/**
 * Drawing one retail emitter: GPU-instanced quads, one draw per emitter. The simulation
 * is particlesSim.ts; this writes its particles into one interleaved buffer, uploads
 * only the live part, and builds each quad in the vertex shader, as the client's
 * CParticleEmitter2::BuildVertex does on the CPU.
 *
 * The pixel program is retail's Particle_Unlit_T1 and Particle_Unlit_3Tex (Eclipse's
 * tools/retailmounts/retail_shaders.py, PPS). All particle programs are one source,
 * compiled once, so a model of forty emitters links one program.
 */
import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DoubleSide,
  DstColorFactor,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  SrcColorFactor,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
  type BlendingDstFactor,
  type BlendingSrcFactor,
  type Texture,
} from "three";
import { blendState, type BlendFactor } from "../wow/programs";
import { whiteTexture } from "../model/loaders";
import { INSTANCE_STRIDE, type ParticleEmitterSim } from "./particlesSim";

export const BLEND_FACTORS: Record<BlendFactor, BlendingSrcFactor & BlendingDstFactor> = {
  one: OneFactor,
  zero: ZeroFactor,
  srcAlpha: SrcAlphaFactor,
  invSrcAlpha: OneMinusSrcAlphaFactor,
  dstColor: DstColorFactor as never,
  srcColor: SrcColorFactor,
};

/**
 * The floor, for every emitter at once. Retail authors foot-strike bursts below the
 * ground, rising through it: in the game the terrain hides what is still under it, and
 * the stage's floor writes no depth, so this does the same. The camera's world-matrix
 * row for Y turns a view-space point into its height above the floor.
 */
export const FLOOR_ROW = { value: new Vector4(0, 1, 0, 0) };

const VERT = /* glsl */ `
attribute vec4 a0;
attribute vec4 a1;
attribute vec4 a2;
attribute vec4 a3;
attribute vec4 a4;
attribute vec4 a5;
uniform vec2 uCell;
uniform vec2 uMode;
uniform vec3 uFlatA;
uniform vec3 uFlatB;
uniform vec2 uLayerScale;
uniform vec4 uFloorRow;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vLayer;
varying vec3 vCut;

void main() {
  vec4 mv = modelViewMatrix * vec4(a0.xyz, 1.0);
  vec3 c = mv.xyz;
  mat3 rot = mat3(modelViewMatrix);
  vec2 corner = position.xy;
  vec2 size = a3.xy;
  vec2 uv01 = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  vec2 cell;
  vec3 p;
  if (position.z > 0.5) {
    // The tail: from the particle back along its velocity, in the view plane.
    cell = a4.xy;
    vec3 tail = rot * (-a1.xyz) * a1.w;
    float flat2 = dot(tail.xy, tail.xy);
    if (flat2 < 0.00077160494) {
      p = c + vec3(corner * size, 0.0);
    } else {
      float inv = 1.0 / sqrt(flat2);
      vec2 perp = vec2(tail.x * size.x * inv, tail.y * size.y * inv);
      vec3 base = corner.x > 0.0 ? c + tail : c;
      p = base + vec3(-perp.y, perp.x, 0.0) * corner.y;
    }
  } else {
    cell = a3.zw;
    if (uMode.x > 0.5 && dot(a1.xyz, a1.xyz) > 2.3841858e-7) {
      // Retail flag 4: stretched along its travel.
      vec3 dir = rot * (-a1.xyz);
      float flat2 = dot(dir.xy, dir.xy);
      float inv = flat2 > 2.3841858e-7 ? 1.0 / sqrt(flat2) : 0.0;
      vec2 axis = dir.xy * inv;
      vec2 sz = size;
      if (inv > 2.3841858e-7) sz.x = sqrt(flat2 / dot(dir, dir)) * size.x;
      vec2 o = corner * sz;
      p = c + vec3(o.x * axis.x - o.y * axis.y, o.x * axis.y + o.y * axis.x, 0.0);
    } else {
      float cs = cos(a0.w);
      float sn = sin(a0.w);
      vec2 o = corner * size;
      vec2 r = vec2(o.x * cs - o.y * sn, o.x * sn + o.y * cs);
      if (uMode.y > 0.5) {
        // Retail flag 0x1000: flat in the emitter's plane, not facing the camera.
        p = c + normalize(rot * uFlatA) * r.x + normalize(rot * uFlatB) * r.y;
      } else {
        p = c + vec3(r, 0.0);
      }
    }
  }
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vUv = cell + uv01 * uCell;
  vColor = a2;
  // Layers read from the corner, not the cell (client 0x10119F690).
  vLayer = vec4(a5.xy + uv01 * uLayerScale.x, a5.zw + uv01 * uLayerScale.y);
  vCut = vec3(a4.z, gl_Position.w, dot(uFloorRow, vec4(p, 1.0)));
}`;

const FRAG = /* glsl */ `
uniform sampler2D uT0;
uniform sampler2D uT1;
uniform sampler2D uT2;
// x three textures, y material bit 0, z material bit 1, w colorMult
uniform vec4 uP;
// x BlendAdd, y alpha key
uniform vec2 uQ;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vLayer;
varying vec3 vCut;

void main() {
  if (vCut.z < 0.0) discard;
  vec4 t0 = texture2D(uT0, vUv);
  vec3 c = t0.rgb;
  float a = t0.a;
  float tested = t0.a;
  if (uP.x > 0.5) {
    vec4 t1 = texture2D(uT1, vLayer.xy);
    vec4 t2 = texture2D(uT2, vLayer.zw);
    vec4 m = t0 * t1;
    if (uP.y > 0.5) m *= t2;
    else m.a *= t2.a;
    tested = m.a;
    c = m.rgb * (uP.y > 0.5 ? 4.0 : 2.0) * uP.w;
    a = m.a * (uP.z > 0.5 ? 4.0 : 2.0);
  }
  if (uQ.y > 0.5 && a < 0.501960814) discard;
  // Retail's visibility: the EXP2 cutoff, and the near fade every particle program has.
  float vis = step(vCut.x, tested) * pow(clamp(vCut.y * 0.0606060624, 0.0, 1.0), 0.6);
  vec3 rgb = c * vColor.rgb;
  float alpha = a * vColor.a * vis;
  gl_FragColor = uQ.x > 0.5 ? vec4(rgb * vis, alpha) : vec4(rgb, alpha);
}`;

function keepRanges(): void {
  // The range stays: see the constructor.
}

const CORNERS = new Float32Array([
  -1, 1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0,
  -1, 1, 1, -1, -1, 1, 1, 1, 1, 1, -1, 1,
]);

export class ParticleMesh {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly geometry: InstancedBufferGeometry;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly range = { start: 0, count: 0 };

  constructor(
    readonly sim: ParticleEmitterSim,
    renderOrder: number,
  ) {
    const geometry = new InstancedBufferGeometry();
    // The array is shared, the GL buffer is not: disposing a geometry frees its buffers.
    geometry.setAttribute("position", new BufferAttribute(CORNERS, 3));
    const head = sim.head;
    const tail = sim.tail;
    const index: number[] = [];
    if (head) index.push(0, 1, 2, 2, 1, 3);
    if (tail) index.push(4, 5, 6, 6, 5, 7);
    geometry.setIndex(index);
    geometry.instanceCount = 0;
    this.data = new Float32Array(sim.capacity * INSTANCE_STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, INSTANCE_STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    // One range for life: three clears the list after each upload, which frees its
    // storage, and the next push would allocate it again every frame.
    this.buffer.updateRanges.push(this.range);
    this.buffer.clearUpdateRanges = keepRanges;
    for (let k = 0; k < 6; k++) geometry.setAttribute(`a${k}`, new InterleavedBufferAttribute(this.buffer, 4, k * 4));
    this.geometry = geometry;

    const blend = sim.data.blend;
    const state = blendState(blend, 0);
    const multi = sim.data.multi;
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uT0: { value: whiteTexture() },
        uT1: { value: whiteTexture() },
        uT2: { value: whiteTexture() },
        uCell: { value: new Vector2(sim.cellW, sim.cellH) },
        uMode: { value: new Vector2(sim.aligned ? 1 : 0, sim.flat ? 1 : 0) },
        uFlatA: { value: sim.local ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1) },
        uFlatB: { value: sim.local ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0) },
        uLayerScale: { value: multi ? new Vector2(multi.scale[0], multi.scale[1]) : new Vector2(1, 1) },
        uFloorRow: FLOOR_ROW,
        uP: { value: new Vector4(multi ? 1 : 0, multi ? multi.mat & 1 : 0, multi ? (multi.mat >> 1) & 1 : 0, multi ? multi.colorMult : 1) },
        uQ: { value: new Vector2(blend === 7 ? 1 : 0, blend === 1 ? 1 : 0) },
      },
      side: DoubleSide,
      depthTest: true,
      depthWrite: state.depthWrite,
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
    this.material = material;

    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    this.mesh = mesh;
  }

  /** Its textures, layer by layer. A missing one stays white until it arrives. */
  setTexture(unit: number, texture: Texture): void {
    const key = unit === 0 ? "uT0" : unit === 1 ? "uT1" : "uT2";
    this.material.uniforms[key]!.value = texture;
  }

  /** Writes and uploads this frame's particles. Allocates nothing. */
  draw(viewInverse: ArrayLike<number>): void {
    const sim = this.sim;
    const mesh = this.mesh;
    if (sim.local) {
      // World matrices are already done this frame; `root` is identity.
      mesh.matrix.fromArray(sim.xform);
      mesh.matrixWorld.copy(mesh.matrix);
    }
    if (sim.sorted) {
      // The third row of model-view: the camera's depth of a particle.
      const v = viewInverse;
      const z = sim.viewZ;
      if (sim.local) {
        const m = sim.xform;
        z[0] = v[2]! * m[0]! + v[6]! * m[1]! + v[10]! * m[2]!;
        z[1] = v[2]! * m[4]! + v[6]! * m[5]! + v[10]! * m[6]!;
        z[2] = v[2]! * m[8]! + v[6]! * m[9]! + v[10]! * m[10]!;
        z[3] = v[2]! * m[12]! + v[6]! * m[13]! + v[10]! * m[14]! + v[14]!;
      } else {
        z[0] = v[2]!;
        z[1] = v[6]!;
        z[2] = v[10]!;
        z[3] = v[14]!;
      }
    }
    const n = sim.write(this.data);
    this.geometry.instanceCount = n;
    mesh.visible = n > 0;
    if (n > 0) {
      this.range.count = n * INSTANCE_STRIDE;
      this.buffer.needsUpdate = true;
    }
  }

  hide(): void {
    this.mesh.visible = false;
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
