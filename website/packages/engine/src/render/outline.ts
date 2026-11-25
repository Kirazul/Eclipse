/**
 * The hover outline, loaded the first time a part is hovered. The values are
 * Khada's. His gamma pass is left out because this pipeline's shaders already write
 * gamma-space colour, and so the edge colours go in unconverted.
 */
import { Bone, BufferAttribute, BufferGeometry, LinearSRGBColorSpace, Mesh, Skeleton, SkinnedMesh, Vector2, type Material, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OUTLINE } from "../constants";
import type { Part } from "../model/figure";
import { boneIndices } from "../model/loaders";
import { linkInBackground } from "./linking";

export class OutlineRig {
  active = false;
  private readonly composer: EffectComposer;
  private readonly pass: OutlinePass;
  private hovered: readonly Part[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new OutlinePass(new Vector2(width, height), scene, camera);
    this.pass.visibleEdgeColor.setHex(OUTLINE.edge, LinearSRGBColorSpace);
    this.pass.hiddenEdgeColor.setHex(OUTLINE.hidden, LinearSRGBColorSpace);
    this.pass.edgeStrength = OUTLINE.strength;
    this.pass.edgeGlow = OUTLINE.glow;
    this.pass.edgeThickness = OUTLINE.thickness;
    this.pass.pulsePeriod = OUTLINE.pulse;
    this.composer.addPass(this.pass);
  }

  /**
   * Links what it will draw with, in the background. The pass's own materials once, on a skinned
   * stand-in where the selected meshes are skinned, and the figure's own in the frame it renders to.
   */
  async prepare(root: Object3D): Promise<void> {
    const { renderer, scene, camera } = this;
    const own = this.pass as unknown as Record<"depthMaterial" | "prepareMaskMaterial" | "edgeDetectionMaterial" | "separableBlurMaterial1" | "separableBlurMaterial2" | "overlayMaterial" | "materialCopy", Material>;
    await linkInBackground(renderer, () => {
      const target = this.composer.renderTarget1;
      const links: Promise<unknown>[] = [];
      renderer.setRenderTarget(target);
      links.push(renderer.compileAsync(root, camera, scene));
      if (!this.linked) {
        this.linked = true;
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
        geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
        geometry.setAttribute("skinIndex", boneIndices(new Uint16Array(12)));
        geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(12), 4));
        for (const material of [own.depthMaterial, own.prepareMaskMaterial]) {
          const mesh = new SkinnedMesh(geometry, material);
          const bone = new Bone();
          mesh.add(bone);
          mesh.bind(new Skeleton([bone]));
          links.push(renderer.compileAsync(mesh, camera, scene));
        }
        for (const material of [own.edgeDetectionMaterial, own.separableBlurMaterial1, own.separableBlurMaterial2, own.overlayMaterial, own.materialCopy]) {
          links.push(renderer.compileAsync(new Mesh(geometry, material), camera, scene));
        }
      }
      renderer.setRenderTarget(null);
      return Promise.all(links);
    });
  }

  private linked = false;

  select(parts: readonly Part[]): void {
    this.hovered = parts;
    this.pass.selectedObjects = parts.map((p) => p.mesh as Mesh);
    this.active = parts.length > 0;
  }

  render(all: readonly Part[], dt: number): void {
    const hovered = this.hovered;
    // A part hidden by the look shows faintly while hovered.
    const wasHidden: Part[] = [];
    for (const part of hovered) {
      if (!part.mesh.visible) {
        wasHidden.push(part);
        part.mesh.visible = true;
        part.material.setUserTransparent(true);
        part.material.uniforms.uUserOpacity.value = OUTLINE.hiddenOpacity;
      }
    }
    for (const part of all) {
      if (!hovered.includes(part) && part.mesh.visible) part.material.uniforms.uTint.value.setScalar(OUTLINE.dimOthers);
    }
    this.composer.render(dt);
    for (const part of all) part.material.uniforms.uTint.value.setScalar(1);
    for (const part of wasHidden) {
      part.mesh.visible = false;
      part.material.setUserTransparent(false);
      part.material.uniforms.uUserOpacity.value = 1;
    }
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.pass.resolution.set(width, height);
  }

  dispose(): void {
    this.pass.dispose();
    this.composer.dispose();
  }
}
