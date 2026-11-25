/**
 * Shaders link in the background, and nothing stalls the page for them.
 *
 * `compileAsync` only gets half of it. The GPU process links in parallel, but the first
 * question anybody asks about a linked program waits for it, 45 to 130 ms each, measured on a
 * real card, and three asks in the first draw that uses it: several programs at once add up to
 * one long stall of the main thread. So they are asked here, one to a task, with the page's
 * input and frames between them.
 */
import { ShaderMaterial, type Camera, type Material, type Mesh, type Object3D, type Scene, type WebGLRenderer } from "three";

interface Linked {
  getUniforms(): unknown;
  getAttributes(): unknown;
}

const asked = new WeakMap<WebGLRenderer, WeakSet<object>>();
const kept = new WeakMap<WebGLRenderer, { programs: WeakSet<object>; materials: Material[] }>();

/** The next task, after whatever input and frames are waiting. */
export const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * `start` calls compileAsync (more than once if it likes, each under its own render target).
 * `turn` runs each question when the page has a moment: by default, the next task.
 */
export async function linkInBackground(
  renderer: WebGLRenderer,
  start: () => Promise<unknown>,
  turn: (work: () => Promise<void>) => Promise<void> = async (work) => {
    await nextTask();
    await work();
  },
): Promise<void> {
  const done = start();
  let seen = asked.get(renderer);
  if (!seen) asked.set(renderer, (seen = new WeakSet()));
  const fresh: Linked[] = [];
  for (const p of renderer.info.programs ?? []) {
    if (seen.has(p)) continue;
    seen.add(p);
    fresh.push(p as unknown as Linked);
  }
  await done;
  for (const p of fresh) {
    await turn(async () => {
      p.getUniforms();
      p.getAttributes();
    });
  }
}

/**
 * Programs that stay once linked, for a renderer that goes through many models, as the poster
 * fill does: without it a model's disposal frees its programs and the next model links them
 * again, 83 links in 21 posters, measured. A model's shaders are a short list of combiners, so
 * what is kept stays small.
 *
 * A held count on the program isn't enough. three names a shader's source by who is using it, so
 * when the last material goes the next one gets a new name, a new program key, and the old
 * program is never used again. A bare material of the same sources, never disposed, holds both.
 */
export function keepPrograms(renderer: WebGLRenderer, node: Object3D, camera: Camera, scene: Scene): void {
  let store = kept.get(renderer);
  if (!store) kept.set(renderer, (store = { programs: new WeakSet(), materials: [] }));
  const { programs, materials } = store;
  node.traverse((o) => {
    const mesh = o as Mesh;
    const material = mesh.material as ShaderMaterial | undefined;
    if (!mesh.isMesh || !material?.isShaderMaterial) return;
    const program = (renderer.properties.get(material) as { currentProgram?: object }).currentProgram;
    if (!program || programs.has(program)) return;
    programs.add(program);
    const keeper = new ShaderMaterial();
    keeper.copy(material);
    // Nothing draws with it: it holds no textures and no copies of them.
    keeper.uniforms = {};
    const shaped = keeper as unknown as { map?: unknown };
    shaped.map = (material as unknown as { map?: unknown }).map;
    mesh.material = keeper;
    renderer.compile(mesh, camera, scene);
    mesh.material = material;
    shaped.map = undefined;
    materials.push(keeper);
  });
}
