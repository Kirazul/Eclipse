/**
 * Synthetic packs for the engine's tests, in the real contract's shapes: a boxy
 * figure with retail-style materials, streamed clips, a composite, fx, geosets, and a
 * set of ItemManifests. Each model has its own flat colours, which is what lets the
 * flicker gates tell two models apart by a pixel. No game data: everything is made here.
 *
 *   pnpm exec tsx engine/test/fixtures/build.ts [outDir]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, type Material } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { meshopt, reorder, quantize } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import {
  KHR_DF_FLAG_ALPHA_STRAIGHT,
  KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
  KHR_DF_MODEL_RGBSDA,
  KHR_DF_PRIMARIES_BT709,
  KHR_DF_SAMPLE_DATATYPE_LINEAR,
  KHR_DF_TRANSFER_LINEAR,
  KHR_DF_VENDORID_KHRONOS,
  KHR_DF_VERSION,
  VK_FORMAT_R8G8B8A8_UNORM,
  createDefaultContainer,
  write as writeKtx,
} from "three/examples/jsm/libs/ktx-parse.module.js";
import type {
  Attachment,
  ClipEntry,
  CompositeLayer,
  FxData,
  ItemManifest,
  ModelManifest,
  SetManifest,
  SlotId,
  SubmeshExtras,
  TextureEntry,
} from "@eclipse/format";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? join(HERE, "..", "..", "..", "tests", "parity", "dist", "packs"));

type RGBA = [number, number, number, number];
type V3 = [number, number, number];

function put(name: string, data: Uint8Array | string): void {
  const file = join(OUT, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

function blob(data: Uint8Array | string, ext: string): { key: string; bytes: number } {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  const key = `blobs/${hash}.${ext}`;
  put(key, bytes);
  return { key, bytes: bytes.length };
}

// --- Textures ---------------------------------------------------------------

function ktx(w: number, h: number, pixel: (x: number, y: number) => RGBA): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      for (let i = 0; i < 4; i++) data[(y * w + x) * 4 + i] = c[i]!;
    }
  }
  const c = createDefaultContainer();
  c.vkFormat = VK_FORMAT_R8G8B8A8_UNORM;
  c.pixelWidth = w;
  c.pixelHeight = h;
  c.pixelDepth = 0;
  c.layerCount = 0;
  c.faceCount = 1;
  c.levelCount = 1;
  c.levels = [{ levelData: data, uncompressedByteLength: data.length }];
  c.dataFormatDescriptor = [
    {
      vendorId: KHR_DF_VENDORID_KHRONOS,
      descriptorType: KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
      versionNumber: KHR_DF_VERSION,
      colorModel: KHR_DF_MODEL_RGBSDA,
      colorPrimaries: KHR_DF_PRIMARIES_BT709,
      transferFunction: KHR_DF_TRANSFER_LINEAR,
      flags: KHR_DF_FLAG_ALPHA_STRAIGHT,
      texelBlockDimension: [0, 0, 0, 0],
      bytesPlane: [4, 0, 0, 0, 0, 0, 0, 0],
      samples: [0, 1, 2, 15].map((channel, i) => ({
        channelType: channel,
        bitOffset: i * 8,
        bitLength: 7,
        samplePosition: [0, 0, 0, 0],
        sampleLower: 0,
        sampleUpper: 255,
      })),
    },
  ] as never;
  return writeKtx(c, { keepWriter: false });
}

const solid = (c: RGBA, size = 4) => ktx(size, size, () => c);

function texEntry(kind: TextureEntry["kind"], type: number, data: Uint8Array | null, w = 4, h = 4, alpha = false): TextureEntry {
  const b = data ? blob(data, "ktx2") : { key: "", bytes: 0 };
  return { type, kind, key: b.key, bytes: b.bytes, width: w, height: h, alpha };
}

// --- Geometry ---------------------------------------------------------------

interface Prim {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  joints: number[];
  weights: number[];
  extras: SubmeshExtras;
}

function extras(p: Partial<SubmeshExtras> & { hash: number }): SubmeshExtras {
  return { geoset: 0, units: [], shader: 0, blend: 0, flags: 0, priority: 0, color: -1, opacity: -1, ...p };
}

const unit = (tex: number, uvAnim = -1) => ({ tex, uvSet: 0, wrapS: true, wrapT: true, uvAnim });

/** A subdivided box, weighted to one bone. `uv` is its rect in the texture. */
function box(min: V3, max: V3, bone: number, uv: [number, number, number, number], e: SubmeshExtras, cuts = 2): Prim {
  const p: Prim = { positions: [], normals: [], uvs: [], indices: [], joints: [], weights: [], extras: e };
  const faces: { n: V3; a: V3; b: V3; o: V3 }[] = [
    { n: [0, 0, 1], o: [min[0], min[1], max[2]], a: [max[0] - min[0], 0, 0], b: [0, max[1] - min[1], 0] },
    { n: [0, 0, -1], o: [max[0], min[1], min[2]], a: [min[0] - max[0], 0, 0], b: [0, max[1] - min[1], 0] },
    { n: [1, 0, 0], o: [max[0], min[1], max[2]], a: [0, 0, min[2] - max[2]], b: [0, max[1] - min[1], 0] },
    { n: [-1, 0, 0], o: [min[0], min[1], min[2]], a: [0, 0, max[2] - min[2]], b: [0, max[1] - min[1], 0] },
    { n: [0, 1, 0], o: [min[0], max[1], max[2]], a: [max[0] - min[0], 0, 0], b: [0, 0, min[2] - max[2]] },
    { n: [0, -1, 0], o: [min[0], min[1], min[2]], a: [max[0] - min[0], 0, 0], b: [0, 0, max[2] - min[2]] },
  ];
  for (const f of faces) {
    const base = p.positions.length / 3;
    for (let j = 0; j <= cuts; j++) {
      for (let i = 0; i <= cuts; i++) {
        const u = i / cuts;
        const v = j / cuts;
        p.positions.push(f.o[0] + f.a[0] * u + f.b[0] * v, f.o[1] + f.a[1] * u + f.b[1] * v, f.o[2] + f.a[2] * u + f.b[2] * v);
        p.normals.push(...f.n);
        p.uvs.push(uv[0] + uv[2] * u, uv[1] + uv[3] * (1 - v));
        p.joints.push(bone, 0, 0, 0);
        p.weights.push(1, 0, 0, 0);
      }
    }
    for (let j = 0; j < cuts; j++) {
      for (let i = 0; i < cuts; i++) {
        const a = base + j * (cuts + 1) + i;
        const b = a + 1;
        const c = a + cuts + 1;
        const d = c + 1;
        p.indices.push(a, b, d, a, d, c);
      }
    }
  }
  return p;
}

/** A flat sheet facing +Z. */
function sheet(min: V3, max: V3, bone: number, e: SubmeshExtras): Prim {
  const p: Prim = { positions: [], normals: [], uvs: [], indices: [], joints: [], weights: [], extras: e };
  p.positions.push(min[0], min[1], min[2], max[0], min[1], min[2], max[0], max[1], min[2], min[0], max[1], min[2]);
  for (let i = 0; i < 4; i++) {
    p.normals.push(0, 0, 1);
    p.joints.push(bone, 0, 0, 0);
    p.weights.push(1, 0, 0, 0);
  }
  p.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
  p.indices.push(0, 1, 2, 0, 2, 3);
  return p;
}

const BONES: { name: string; parent: number; pivot: V3 }[] = [
  { name: "b0", parent: -1, pivot: [0, 0, 0] },
  { name: "b1", parent: 0, pivot: [0, 1.0, 0] },
  { name: "b2", parent: 1, pivot: [0, 1.55, 0] },
  { name: "b3", parent: 1, pivot: [0.25, 1.49, 0] },
  { name: "b4", parent: 3, pivot: [0.8, 1.49, 0] },
  { name: "b5", parent: 1, pivot: [-0.25, 1.49, 0] },
  { name: "b6", parent: 5, pivot: [-0.8, 1.49, 0] },
  { name: "b7", parent: 0, pivot: [0.12, 0.95, 0] },
  { name: "b8", parent: 0, pivot: [-0.12, 0.95, 0] },
];

function buildGlb(prims: Prim[], withSkin = true, compress = false): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const mesh = doc.createMesh();
  for (const p of prims) {
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.positions)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p.normals)).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(p.uvs)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(p.indices)).setBuffer(buffer));
    if (withSkin) {
      prim.setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(new Uint8Array(p.joints)).setBuffer(buffer));
      prim.setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array(p.weights)).setBuffer(buffer));
    }
    const material: Material = doc.createMaterial(`m${p.extras.hash}`).setExtras(p.extras as never);
    prim.setMaterial(material);
    mesh.addPrimitive(prim);
  }
  const meshNode = doc.createNode("Mesh").setMesh(mesh);
  scene.addChild(meshNode);
  if (withSkin) {
    const nodes = BONES.map((b) => doc.createNode(b.name));
    BONES.forEach((b, i) => {
      if (b.parent >= 0) nodes[b.parent]!.addChild(nodes[i]!);
      else scene.addChild(nodes[i]!);
    });
    const ibm = new Float32Array(16 * BONES.length);
    for (let i = 0; i < BONES.length; i++) ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
    const skin = doc.createSkin().setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer));
    for (const n of nodes) skin.addJoint(n);
    meshNode.setSkin(skin);
  }
  return writeDoc(doc, compress);
}

async function writeDoc(doc: Document, compress: boolean): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  if (compress) {
    await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder }));
  }
  return io.writeBinary(doc);
}

// --- Clips ------------------------------------------------------------------

type Pose = (bone: number, t: number) => { angle?: number; axis?: V3; lift?: V3 };

function quat(axis: V3, angle: number): [number, number, number, number] {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

function rotate(q: [number, number, number, number], v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

const ARMS_DOWN = (82 * Math.PI) / 180;

/** Arms hang, so the bind pose's arms-out silhouette is unmistakably a T-Pose. */
function armsDown(bone: number): number {
  if (bone === 3) return -ARMS_DOWN;
  if (bone === 5) return ARMS_DOWN;
  return 0;
}

async function buildClip(seconds: number, pose: Pose, keys = 16): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const nodes = BONES.map((b) => doc.createNode(b.name));
  BONES.forEach((b, i) => {
    if (b.parent >= 0) nodes[b.parent]!.addChild(nodes[i]!);
    else scene.addChild(nodes[i]!);
  });
  const anim = doc.createAnimation("clip");
  const times = new Float32Array(keys + 1);
  for (let k = 0; k <= keys; k++) times[k] = (seconds * k) / keys;
  const input = doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer);
  BONES.forEach((b, i) => {
    const rot = new Float32Array((keys + 1) * 4);
    const tra = new Float32Array((keys + 1) * 3);
    for (let k = 0; k <= keys; k++) {
      const p = pose(i, k / keys);
      const q = quat(p.axis ?? [0, 0, 1], (p.angle ?? 0) + armsDown(i));
      const r = rotate(q, b.pivot);
      const lift = p.lift ?? [0, 0, 0];
      rot.set(q, k * 4);
      tra.set([b.pivot[0] + lift[0] - r[0], b.pivot[1] + lift[1] - r[1], b.pivot[2] + lift[2] - r[2]], k * 3);
    }
    const sR = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType("VEC4").setArray(rot).setBuffer(buffer));
    const sT = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType("VEC3").setArray(tra).setBuffer(buffer));
    anim.addSampler(sR).addSampler(sT);
    anim.addChannel(doc.createAnimationChannel().setTargetNode(nodes[i]!).setTargetPath("rotation").setSampler(sR));
    anim.addChannel(doc.createAnimationChannel().setTargetNode(nodes[i]!).setTargetPath("translation").setSampler(sT));
  });
  return writeDoc(doc, false);
}

const wave = (t: number, amp: number, n = 1) => Math.sin(t * Math.PI * 2 * n) * amp;
const CLIPS: { id: string; name: string; animId: number; seconds: number; pose: Pose }[] = [
  { id: "0.0", name: "Stand", animId: 0, seconds: 2, pose: (b, t) => (b === 1 ? { angle: wave(t, 0.015) } : b === 2 ? { angle: wave(t, 0.02) } : {}) },
  { id: "4.0", name: "Walk", animId: 4, seconds: 1, pose: (b, t) => (b === 7 ? { axis: [1, 0, 0], angle: wave(t, 0.5) } : b === 8 ? { axis: [1, 0, 0], angle: wave(t, -0.5) } : {}) },
  { id: "5.0", name: "Run", animId: 5, seconds: 0.7, pose: (b, t) => (b === 7 ? { axis: [1, 0, 0], angle: wave(t, 0.8) } : b === 8 ? { axis: [1, 0, 0], angle: wave(t, -0.8) } : {}) },
  { id: "57.0", name: "Attack", animId: 57, seconds: 1.2, pose: (b, t) => (b === 6 ? { axis: [1, 0, 0], angle: wave(t, 0.9) } : {}) },
  { id: "67.0", name: "Wave", animId: 67, seconds: 1.5, pose: (b, t) => (b === 4 ? { angle: wave(t, 0.5, 2) } : {}) },
  { id: "69.0", name: "Dance", animId: 69, seconds: 2.4, pose: (b, t) => (b === 1 ? { axis: [0, 1, 0], angle: wave(t, 0.4) } : {}) },
  // Arm straight overhead: a 160 degree swing from Stand, the crossfade's hard case.
  { id: "99.0", name: "Reach", animId: 99, seconds: 2, pose: (b) => (b === 3 ? { angle: (160 * Math.PI) / 180 } : {}) },
];

// --- Models -----------------------------------------------------------------

const UV = {
  torso: [0.5, 0, 0.25, 0.25],
  sleeve: [0, 0, 0.25, 0.25],
  leg: [0.5, 0.375, 0.25, 0.25],
  other: [0.8, 0.5, 0.2, 0.5],
} as const;

const ATTACHMENTS: Attachment[] = [
  { id: 1, bone: 6, position: [-1.0, 1.49, 0] },
  { id: 2, bone: 4, position: [1.0, 1.49, 0] },
  { id: 5, bone: 3, position: [0.28, 1.6, 0] },
  { id: 6, bone: 5, position: [-0.28, 1.6, 0] },
  { id: 11, bone: 2, position: [0, 1.9, 0] },
  { id: 26, bone: 1, position: [0, 1.4, -0.15] },
];

interface BodyOptions {
  id: string;
  name: string;
  skin: RGBA;
  /** Extra sheets 0.2 mm apart over the chest: the depth buffer's stress case. */
  zfight?: boolean;
  noPivots?: boolean;
}

/** The clips are shared, as a real pack's would be per skeleton. */
let clipEntries: ClipEntry[] | null = null;
async function sharedClips(): Promise<ClipEntry[]> {
  if (clipEntries) return clipEntries;
  clipEntries = [];
  for (const c of CLIPS) {
    const b = blob(await buildClip(c.seconds, c.pose), "glb");
    clipEntries.push({ id: c.id, name: c.name, animId: c.animId, variation: 0, durationMs: c.seconds * 1000, loops: true, key: b.key, bytes: b.bytes });
  }
  return clipEntries;
}

async function buildBody(o: BodyOptions): Promise<void> {
  const textures: TextureEntry[] = [
    texEntry("skin", 1, null, 256, 128),
    texEntry("hair", 6, ktx(8, 8, (x, y) => [40, 30, 20, (x + y) % 2 === 0 ? 255 : 0]), 8, 8, true),
    texEntry("static", 0, solid([200, 180, 120, 150]), 4, 4, true),
    texEntry("static", 0, solid([255, 160, 40, 200]), 4, 4, true),
    texEntry("static", 0, ktx(16, 16, (x) => [x < 8 ? 255 : 40, x < 8 ? 240 : 40, x < 8 ? 80 : 40, 255]), 16, 16),
    texEntry("static", 0, solid([60, 200, 90, 255])),
    texEntry("static", 0, solid([230, 230, 80, 255])),
    texEntry("static", 0, solid([70, 90, 230, 255])),
  ];
  const SKIN = 0;
  const prims: Prim[] = [
    box([-0.25, 0.95, -0.12], [0.25, 1.55, 0.12], 1, [...UV.torso], extras({ hash: 0, units: [unit(SKIN)] }), 4),
    box([-0.14, 1.55, -0.14], [0.14, 1.9, 0.14], 2, [...UV.other], extras({ hash: 1, units: [unit(SKIN)] }), 4),
    box([0.25, 1.42, -0.07], [0.8, 1.56, 0.07], 3, [...UV.sleeve], extras({ hash: 2, units: [unit(SKIN)], geoset: 401 }), 4),
    box([-0.8, 1.42, -0.07], [-0.25, 1.56, 0.07], 5, [...UV.sleeve], extras({ hash: 3, units: [unit(SKIN)], geoset: 401 }), 4),
    box([0.8, 1.43, -0.06], [1.0, 1.55, 0.06], 4, [...UV.other], extras({ hash: 4, units: [unit(SKIN)] })),
    box([-1.0, 1.43, -0.06], [-0.8, 1.55, 0.06], 6, [...UV.other], extras({ hash: 5, units: [unit(SKIN)] })),
    box([0.02, 0.0, -0.09], [0.22, 0.95, 0.09], 7, [...UV.leg], extras({ hash: 6, units: [unit(SKIN)], geoset: 1301 }), 6),
    box([-0.22, 0.0, -0.09], [-0.02, 0.95, 0.09], 8, [...UV.leg], extras({ hash: 7, units: [unit(SKIN)], geoset: 1301 }), 6),
    // A glove and a boot: hidden in the default look, shown by setGeoset or the rules.
    box([0.24, 1.41, -0.08], [0.82, 1.57, 0.08], 3, [0, 0, 1, 1], extras({ hash: 8, units: [unit(5)], geoset: 402 })),
    box([0.01, 0, -0.1], [0.23, 0.3, 0.1], 7, [0, 0, 1, 1], extras({ hash: 9, units: [unit(6)], geoset: 502 })),
    // Sleeve for the chest rule.
    box([-0.27, 1.3, -0.14], [0.27, 1.56, 0.14], 1, [0, 0, 1, 1], extras({ hash: 10, units: [unit(7)], geoset: 802 })),
    // Hair: an alpha-keyed batch, value 5 of group 0.
    box([-0.15, 1.75, -0.15], [0.15, 1.92, 0.15], 2, [0, 0, 1, 1], extras({ hash: 11, units: [unit(1)], geoset: 5, blend: 1, flags: 4 })),
    // Two blended sheets behind the figure, in fixed order: alpha, then additive.
    sheet([-0.42, 0.5, -0.2], [0.42, 1.5, -0.2], 1, extras({ hash: 12, units: [unit(2)], blend: 2, flags: 4, priority: 0 })),
    sheet([-0.32, 0.6, -0.22], [0.32, 1.4, -0.22], 1, extras({ hash: 13, units: [unit(3)], blend: 4, flags: 4, priority: 1 })),
    // A scrolling band, unlit, driven by fx.
    sheet([-0.2, 1.1, 0.14], [0.2, 1.2, 0.14], 1, extras({ hash: 14, units: [unit(4, 0)], blend: 0, flags: 1 })),
  ];
  if (o.zfight) {
    prims.push(
      sheet([-0.2, 1.25, 0.1301], [0.2, 1.5, 0.1301], 1, extras({ hash: 15, units: [unit(6)], flags: 1 })),
      sheet([-0.2, 1.25, 0.1303], [0.2, 1.5, 0.1303], 1, extras({ hash: 16, units: [unit(7)], flags: 1 })),
    );
  }

  const layers: CompositeLayer[] = [
    { layer: 0, targetType: 1, rect: { x: 0, y: 0, w: 256, h: 128 }, blend: 0, ...blob(solid(o.skin), "ktx2") },
    // Darker legs by multiply, so a layer's blend mode shows in the picture too.
    { layer: 1, targetType: 1, rect: { x: 128, y: 48, w: 64, h: 32 }, blend: 4, ...blob(solid([180, 180, 180, 255]), "ktx2") },
  ];

  const fx: FxData = {
    globalLoops: [2000],
    colors: [],
    opacity: [],
    uvAnims: [{ translation: { globalLoop: 0, clips: { "*": [[0, 2000], [[0, 0, 0], [1, 0, 0]]] } } }],
    particles: [],
    ribbons: [],
  };
  const fxBlob = blob(JSON.stringify(fx), "json");
  const glb = blob(await buildGlb(prims), "glb");
  const clips = await sharedClips();

  const manifest: ModelManifest = {
    formatVersion: 1,
    id: o.id,
    kind: "body",
    name: o.name,
    build: "fixture",
    source: { m2: 0, skin: 0 },
    glb,
    fx: fxBlob,
    bounds: { min: [-1.0, 0, -0.25], max: [1.0, 1.92, 0.25] },
    boneCount: BONES.length,
    // fx-nopivot exists to measure what a pack without pivots does in a crossfade.
    pivots: o.noPivots ? undefined : BONES.flatMap((b) => b.pivot),
    clips,
    defaultClip: "0.0",
    textures,
    defaultGeosets: [0, 5, 401, 1301],
    composite: { width: 256, height: 128, layers },
    attachments: ATTACHMENTS,
    warnings: [],
  };
  put(`models/${o.id}/manifest.json`, JSON.stringify(manifest));
}

async function buildProp(id: string, color: RGBA, size: V3, offset: V3 = [0, 0, 0]): Promise<void> {
  const min: V3 = [offset[0] - size[0] / 2, offset[1], offset[2] - size[2] / 2];
  const max: V3 = [offset[0] + size[0] / 2, offset[1] + size[1], offset[2] + size[2] / 2];
  const glb = blob(await buildGlb([box(min, max, 0, [0, 0, 1, 1], extras({ hash: 0, units: [unit(0)], flags: 1 }))], false), "glb");
  const manifest: ModelManifest = {
    formatVersion: 1,
    id,
    kind: "item",
    name: id,
    build: "fixture",
    source: { m2: 0, skin: 0 },
    glb,
    bounds: { min, max },
    boneCount: 0,
    clips: [],
    defaultClip: "",
    textures: [texEntry("object", 2, solid(color))],
    defaultGeosets: [0],
    attachments: [],
    warnings: [],
  };
  put(`models/${id}/manifest.json`, JSON.stringify(manifest));
}

/** A coat as a skinned collection, over some of the body's bones by name. */
async function buildCollection(id: string, color: RGBA): Promise<void> {
  const prims = [
    box([-0.28, 0.6, -0.15], [0.28, 1.5, 0.15], 1, [0, 0, 1, 1], extras({ hash: 0, units: [unit(0)], flags: 1 })),
    box([0.27, 1.41, -0.09], [0.6, 1.57, 0.09], 3, [0, 0, 1, 1], extras({ hash: 1, units: [unit(0)], flags: 1 })),
    box([-0.6, 1.41, -0.09], [-0.27, 1.57, 0.09], 5, [0, 0, 1, 1], extras({ hash: 2, units: [unit(0)], flags: 1 })),
  ];
  const glb = blob(await buildGlb(prims), "glb");
  const manifest: ModelManifest = {
    formatVersion: 1,
    id,
    kind: "item",
    name: id,
    build: "fixture",
    source: { m2: 0, skin: 0 },
    glb,
    bounds: { min: [-0.6, 0.6, -0.15], max: [0.6, 1.57, 0.15] },
    boneCount: BONES.length,
    clips: [],
    defaultClip: "",
    textures: [texEntry("object", 2, solid(color))],
    defaultGeosets: [0],
    attachments: [],
    warnings: [],
  };
  put(`models/${id}/manifest.json`, JSON.stringify(manifest));
}

function item(id: string, slot: SlotId, parts: Partial<ItemManifest> = {}): void {
  const manifest: ItemManifest = { formatVersion: 1, id, slot, attached: [], collections: {}, bodyLayers: [], geosetGroups: {}, ...parts };
  put(`items/${id}/manifest.json`, JSON.stringify(manifest));
}

function set(id: string, pieces: Partial<Record<SlotId, string>>): void {
  const manifest: SetManifest = { formatVersion: 1, id, pieces };
  put(`sets/${id}/manifest.json`, JSON.stringify(manifest));
}

/** Throwaway real-geometry GLBs from an earlier bake test, when this machine has them. */
function buildHuman(scratch: string): void {
  if (!existsSync(join(scratch, "all_noanim_pack.glb"))) return;
  const read = (f: string) => new Uint8Array(readFileSync(join(scratch, f)));
  const clips: ClipEntry[] = ["all_clip0_pack.glb", "all_clip1_pack.glb", "all_clip2_pack.glb"].map((f, i) => {
    const b = blob(read(f), "glb");
    return { id: `${i}.0`, name: `Seq ${i}`, animId: i, variation: 0, durationMs: 0, loops: true, ...b };
  });
  const manifest: ModelManifest = {
    formatVersion: 1,
    id: "fixture-human",
    kind: "body",
    name: "Human geometry (scratch)",
    build: "scratch",
    source: { m2: 0, skin: 0 },
    glb: blob(read("all_noanim_pack.glb"), "glb"),
    bounds: { min: [-0.81, -0.62, 0], max: [0.81, 0.62, 2.1] },
    boneCount: 215,
    clips,
    defaultClip: "0.0",
    textures: [],
    defaultGeosets: [0],
    attachments: [],
    warnings: ["scratch geometry: no extras, no textures, Z-up"],
  };
  put("models/fixture-human/manifest.json", JSON.stringify(manifest));
}

async function main(): Promise<void> {
  await buildBody({ id: "fx-a", name: "Red figure", skin: [220, 40, 40, 255] });
  await buildBody({ id: "fx-b", name: "Blue figure", skin: [40, 60, 220, 255] });
  await buildBody({ id: "fx-z", name: "Depth stress", skin: [150, 150, 150, 255], zfight: true });
  await buildBody({ id: "fx-nopivot", name: "No pivots", skin: [150, 150, 150, 255], noPivots: true });

  await buildProp("helm-green-model", [40, 230, 60, 255], [0.34, 0.16, 0.34]);
  await buildProp("helm-yellow-model", [240, 240, 40, 255], [0.34, 0.16, 0.34]);
  await buildProp("sword-model", [230, 230, 240, 255], [0.05, 0.9, 0.02], [0.04, 0, 0]);
  await buildCollection("coat-gold-model", [230, 180, 40, 255]);

  item("helm-green", "head", { attached: [{ attachment: 11, manifest: "helm-green-model" }], helmetHide: { "*": [0] } });
  item("helm-yellow", "head", { attached: [{ attachment: 11, manifest: "helm-yellow-model" }] });
  const cyan = blob(solid([40, 230, 230, 255]), "ktx2");
  item("chest-cyan", "chest", { bodyLayers: [{ section: 3, ...cyan }], geosetGroups: { 0: 1 } });
  const white = blob(solid([250, 250, 250, 255]), "ktx2");
  item("chest-white", "chest", { bodyLayers: [{ section: 3, ...white }] });
  item("coat-gold", "back", { collections: { "*": { manifest: "coat-gold-model" } } });
  item("sword-main", "mainhand", { attached: [{ attachment: 1, manifest: "sword-model" }] });
  item("sword-off", "offhand", { attached: [{ attachment: 2, manifest: "sword-model", handFlags: 0x100 }] });
  item("gloves-geo", "hands", { geosetGroups: { 0: 1 } });
  set("set-a", { head: "helm-green", chest: "chest-cyan" });

  // Forty distinct grid rows: chest paint plus a helm on some.
  for (let i = 0; i < 40; i++) {
    const hue = (i * 29) % 256;
    const paint = blob(solid([hue, 255 - hue, (hue * 3) % 256, 255]), "ktx2");
    item(`row-${i}`, "chest", { bodyLayers: [{ section: 3, ...paint }] });
  }

  const scratch = process.env.ECLIPSE_SCRATCH_GLBS;
  if (scratch) buildHuman(scratch);
  console.log(`fixtures written to ${OUT}`);
}

await main();
