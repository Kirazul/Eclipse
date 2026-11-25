/**
 * GLB export: the body refetched, the clips merged in, the textures now on screen
 * written as PNG. `minimal` keeps only the clip that is playing; `removeHidden` drops
 * primitives that are not showing. Bones are matched by node name.
 */
import { Accessor, Document, WebIO, type Animation, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import {
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import { packUrl } from "@eclipse/format";
import { TPOSE } from "../constants";
import type { Figure } from "../model/figure";
import { whiteTexture } from "../model/loaders";

interface GlbOptions {
  base: string;
  minimal: boolean;
  removeHidden: boolean;
  currentClip: string | null;
}

async function readDoc(io: WebIO, url: string): Promise<Document> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return io.readBinary(new Uint8Array(await res.arrayBuffer()));
}

/** Any texture, compressed or a render target, to PNG bytes. */
function textureToPng(renderer: WebGLRenderer, texture: Texture, w: number, h: number): Promise<Uint8Array> {
  const target = new WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const material = new ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: "uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }",
    uniforms: { t: { value: texture } },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const keep = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const pixels = new Uint8ClampedArray(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  renderer.setRenderTarget(keep);
  target.dispose();
  material.dispose();
  quad.geometry.dispose();

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.putImageData(new ImageData(pixels, w, h), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("the canvas gave no image"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
}

function copyClip(from: Document, to: Document, name: string, nodes: Map<string, GltfNode>): Animation | null {
  const source = from.getRoot().listAnimations()[0];
  if (!source) return null;
  const anim = to.createAnimation(name);
  const buffer = to.getRoot().listBuffers()[0] ?? to.createBuffer();
  const copy = (a: Accessor) => to.createAccessor().setType(a.getType()).setArray(a.getArray()).setBuffer(buffer).setNormalized(a.getNormalized());
  for (const channel of source.listChannels()) {
    const target = channel.getTargetNode();
    const node = target ? nodes.get(target.getName()) : undefined;
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (!node || !sampler || !input || !output) continue;
    const s = to.createAnimationSampler().setInterpolation(sampler.getInterpolation()).setInput(copy(input)).setOutput(copy(output));
    anim.addSampler(s);
    anim.addChannel(to.createAnimationChannel().setTargetNode(node).setTargetPath(channel.getTargetPath()!).setSampler(s));
  }
  return anim;
}

export async function exportGlb(figure: Figure, renderer: WebGLRenderer, opts: GlbOptions): Promise<Blob> {
  await MeshoptDecoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const manifest = figure.assets.manifest;
  const doc = await readDoc(io, packUrl(opts.base, manifest.glb.key));
  const root = doc.getRoot();

  // Written uncompressed, so any tool reads it.
  for (const ext of root.listExtensionsUsed()) {
    if (ext.extensionName === EXTMeshoptCompression.EXTENSION_NAME) ext.dispose();
  }
  doc.createExtension(KHRMeshQuantization).setRequired(true);

  // Same order as the loader's traversal: one primitive per submesh.
  const primitives = root.listMeshes().flatMap((m) => m.listPrimitives());
  const pngCache = new Map<Texture, ReturnType<typeof doc.createTexture>>();
  for (let i = 0; i < primitives.length; i++) {
    const part = figure.parts[i];
    const primitive = primitives[i]!;
    if (!part) continue;
    if (opts.removeHidden && !part.mesh.visible) {
      primitive.dispose();
      continue;
    }
    const texture = part.material.uniforms.uT0.value;
    if (!texture || texture === whiteTexture()) continue;
    let image = pngCache.get(texture);
    if (!image) {
      const data = texture.image as { width?: number; height?: number } | undefined;
      const entry = manifest.textures[part.extras.units[0]?.tex ?? -1];
      const w = data?.width ?? entry?.width ?? 1024;
      const h = data?.height ?? entry?.height ?? 512;
      image = doc.createTexture(`tex-${pngCache.size}`).setImage(await textureToPng(renderer, texture, w, h)).setMimeType("image/png");
      pngCache.set(texture, image);
    }
    const material = primitive.getMaterial() ?? doc.createMaterial();
    material.setBaseColorTexture(image);
    primitive.setMaterial(material);
  }

  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const wanted = figure.assets.clips.entries.filter((c) => (opts.minimal ? c.id === opts.currentClip && c.id !== TPOSE : true));
  for (const entry of wanted) {
    const clip = await readDoc(io, packUrl(opts.base, entry.key));
    copyClip(clip, doc, entry.name, nodes);
  }

  await doc.transform(prune({ keepAttributes: true, keepLeaves: true }));
  const bytes = await io.writeBinary(doc);
  return new Blob([bytes.buffer as ArrayBuffer], { type: "model/gltf-binary" });
}
