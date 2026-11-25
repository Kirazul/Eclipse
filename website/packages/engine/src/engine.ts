/**
 * The viewer. Rendering rules that everything else bends around:
 *
 * - Nothing joins the scene until its geometry, textures and programs can all draw.
 *   A swap is a list of operations applied at the top of one tick, so a frame shows
 *   either the old picture or the new one, never a mix.
 * - The tick compares and returns when nothing moved: a still model costs no draws.
 * - The tick allocates nothing while a model plays.
 */
import {
  AnimationMixer,
  BackSide,
  Bone,
  Box3,
  Group,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  NoColorSpace,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RGBADepthPacking,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShadowMaterial,
  Skeleton,
  SkeletonHelper,
  SkinnedMesh,
  Sphere,
  Spherical,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import CameraControls from "camera-controls";
import { decodeLook, packUrl, type CustomizationData, type Look, type SlotId, type Vec3 } from "@eclipse/format";
import type { EngineDebug, EngineOptions, ViewerEngine } from "./api";
import { BODY_POLAR, CAMERA, CONTROLS, FADE_IN_CSS, GROUND, MODEL_OFFSET, MOTION_SAMPLES, RESIZE_DEBOUNCE_MS, RESIZE_MIN_PX, SCRUB_STEP_S, SHADOW_LIGHT, TIME_SCALES, TPOSE } from "./constants";
import { FrameStatsRing } from "./logic/frameStats";
import { boundarySize, depthRange, filterOutlierBoxes, fitShadow, frameStyle, type BoxLike, type ShadowFit } from "./logic/framing";
import { anisotropyFor, effectiveTier, isSoftwareRenderer, pixelRatioFor } from "./logic/gpuTier";
import { resolveShortcut } from "./logic/keyboard";
import { ByteProgress } from "./logic/progress";
import { slotView } from "./logic/slots";
import { fetchBytes, isAbort, yieldToMain, queueState } from "./net/fetchPack";
import { ModelAssets, type LoadEnv } from "./model/assets";
import { ClipDirector } from "./model/director";
import { Figure, type Part } from "./model/figure";
import { boneIndices, ktx2Loader, whiteTexture } from "./model/loaders";
import { CompositeRenderer } from "./wow/composite";
import { BatchMaterial } from "./wow/material";
import { CATALOGUE_PROGRAMS } from "./wow/programs";
import { Wardrobe, type OutfitChange, type WardrobeHost } from "./wow/wardrobe";
import { Customizer, type LookHost } from "./wow/customize";
import type { OutlineRig } from "./render/outline";
import type { FigureCells } from "./render/cells";
import { linkInBackground } from "./render/linking";
import { FigureEmitters } from "./render/emitters";
import { FX_CLOCK } from "./render/particlesSim";
import {
  $autoRotationSpeed,
  $autoVisibility,
  $backgroundColor,
  $clips,
  $currentClip,
  $effects,
  $error,
  $focusedSlot,
  $hoveredPart,
  $loading,
  $manifest,
  $parts,
  $paused,
  $physics,
  $progress,
  $shadows,
  $skeleton,
  $timeScale,
  $watermark,
  $wireframe,
  type FrameStats,
  type PartRow,
  $customization,
  $look,
} from "./stores";

CameraControls.install({ THREE: { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } });

/** Beyond the public options: Khada's framing switches, off by default as his are. */
export interface EngineExtras {
  frameMotion?: boolean;
  framePadding?: number;
}

const TIER_CACHE_KEY = "eclipse-gpu-tier";

const _v = new Vector3();

/** AnimationData: Mount, the seat every rider takes unless its mount says otherwise. */
const RIDER_CLIP = 91;

export class EclipseEngine implements ViewerEngine, EngineDebug {
  readonly opts: Required<Omit<EngineOptions, "packBase">> & { packBase: string } & Required<EngineExtras>;
  canvas: HTMLCanvasElement | null = null;
  renderer!: WebGLRenderer;
  camera!: PerspectiveCamera;
  scene!: Scene;
  controls!: CameraControls;
  figure: Figure | null = null;
  director: ClipDirector | null = null;
  wardrobe: Wardrobe | null = null;
  customizer: Customizer | null = null;
  composer!: CompositeRenderer;

  private light!: DirectionalLight;
  private ground!: Mesh;
  private env!: LoadEnv;
  private tier: number | null = null;

  // Load state
  private loadAbort: AbortController | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadingId: string | null = null;
  private loadSeq = 0;
  private loadMs = 0;
  private loadBytes = 0;
  private readonly earlyOutfit = new Map<SlotId, string>();
  private releaseWarmUp: (() => void) | null = null;

  // Frame state
  private running = false;
  private frameCount = 0;
  private lastTick = 0;
  private dirty = false;
  private forcedContinuous = 0;
  private readonly stats = new FrameStatsRing();
  private readonly pendingOps: (() => void)[] = [];
  private readonly frameWaiters: (() => void)[] = [];
  private readonly afterDraw: (() => void)[] = [];
  private hiddenTab = false;
  private onScreen = true;
  private fxClockMs = 0;
  /** This tick already updated every world matrix: the render need not do it again. */
  private worldFresh = false;
  private physicsOn = $physics.get();
  /** The scene's shared physics world, once anything uses it. */
  private physScene: import("./physics/index").PhysScene | null = null;
  /** The clip time a paused figure last posed its physics for. */
  private posedAt = -1;
  private fadedIn = false;
  /** Test hook, called after each draw; a compare when unset. */
  onFrame: (() => void) | null = null;

  // View
  private autoRotation = false;
  private skeletonHelper: SkeletonHelper | null = null;
  private readonly modelCenter = new Vector3();
  private modelRadius = 1;
  private depthDistance = 0;
  private shadowFit: ShadowFit | null = null;
  private outline: OutlineRig | null = null;
  private outlineLoading = false;
  /** The figure the outline's programs are linked for. */
  private outlineFor: Figure | null = null;
  private cells: FigureCells | null = null;
  private cellsLoading: Promise<FigureCells> | null = null;
  private cellsHold: () => boolean = () => false;
  private xrSupported = false;
  private xrSession: XRSession | null = null;
  private xrGrab: { active: Object3D | null; offset: Vector3; ready: boolean } = { active: null, offset: new Vector3(), ready: false };

  // Listeners to remove
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private intersection: IntersectionObserver | null = null;
  private readonly unlisten: (() => void)[] = [];

  constructor(options: EngineOptions & EngineExtras) {
    this.opts = {
      packBase: options.packBase.replace(/\/$/, ""),
      interactable: options.interactable ?? false,
      lite: options.lite ?? false,
      animated: options.animated ?? true,
      cameraStyle: options.cameraStyle ?? "default",
      shadow: options.shadow ?? true,
      shortcuts: options.shortcuts ?? true,
      lockCamera: options.lockCamera ?? false,
      frameMotion: options.frameMotion ?? false,
      framePadding: options.framePadding ?? 0,
    };
  }

  // --- Setup --------------------------------------------------------------

  async mount(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    // Hidden with no transition yet: with one, the canvas would fade out first.
    canvas.style.opacity = "0";

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: this.opts.cameraStyle !== "mobile",
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer = renderer;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    // Asking for the info log blocks until a program links, which on ANGLE is the
    // biggest single stall of a load. Tests turn the check back on and fail on errors.
    renderer.debug.checkShaderErrors = (globalThis as { __ECLIPSE_SHADER_CHECK__?: boolean }).__ECLIPSE_SHADER_CHECK__ === true;

    this.applyKnownTier();
    const box = this.sizeElement().getBoundingClientRect();
    renderer.setSize(box.width, box.height);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(CAMERA.fov, CAMERA.aspect, CAMERA.near, CAMERA.far);
    this.camera.position.set(CAMERA.position[0], CAMERA.position[1], CAMERA.position[2]);
    if (box.height > 0) this.camera.aspect = box.width / box.height;
    this.camera.updateProjectionMatrix();
    this.scene.add(this.camera);

    this.composer = new CompositeRenderer(renderer);
    this.env = {
      base: this.opts.packBase,
      renderer,
      anisotropy: () => this.anisotropy(),
    };
    // The transcoder starts with everything else, not when the first texture lands.
    ktx2Loader(renderer);

    this.controls = new CameraControls(this.camera, renderer.domElement);
    this.controls.minDistance = CONTROLS.minDistance;
    this.controls.maxDistance = CONTROLS.maxDistance;
    if (!this.opts.interactable || this.opts.lockCamera) this.controls.enabled = false;

    this.setUpShadows();

    this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.listen(window, "resize", () => this.scheduleResize());
    this.listen(document, "visibilitychange", () => this.onVisibility());
    this.intersection = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      this.onScreen = last.isIntersecting;
      this.updateLoop();
    });
    this.intersection.observe(canvas);
    this.hiddenTab = document.visibilityState === "hidden";

    if (this.opts.interactable && !this.opts.lite && this.opts.shortcuts) {
      this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent));
    }
    this.unlisten.push($hoveredPart.listen((hash) => this.onHover(hash)));

    if (this.opts.interactable) void this.probeXR();
    this.exposeWindowApi();
    setTimeout(() => this.warmUp(), 0);
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.unlisten.push(() => target.removeEventListener(type, fn));
  }

  private sizeElement(): HTMLElement {
    return (this.opts.interactable ? this.canvas!.parentElement : this.canvas) ?? this.canvas!;
  }

  private setUpShadows(): void {
    const light = new DirectionalLight(SHADOW_LIGHT.color, SHADOW_LIGHT.intensity);
    light.position.set(...SHADOW_LIGHT.position);
    light.castShadow = this.opts.shadow;
    light.shadow.mapSize.set(SHADOW_LIGHT.mapSize, SHADOW_LIGHT.mapSize);
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = this.opts.shadow;
    this.scene.add(light);
    this.scene.add(light.target);
    this.light = light;

    const material = new ShadowMaterial();
    material.opacity = GROUND.opacity;
    material.depthWrite = false;
    const ground = new Mesh(new PlaneGeometry(GROUND.size, GROUND.size), material);
    ground.rotateX(-Math.PI / 2);
    ground.receiveShadow = true;
    ground.renderOrder = -1;
    ground.visible = this.opts.shadow;
    this.scene.add(ground);
    this.ground = ground;
    $shadows.set(this.opts.shadow);
  }

  // --- GPU tier -----------------------------------------------------------

  private applyKnownTier(): void {
    const name = this.rendererName();
    if (isSoftwareRenderer(name)) {
      this.setTier(0);
      return;
    }
    try {
      const cached = localStorage.getItem(`${TIER_CACHE_KEY}:${name}`);
      if (cached !== null) {
        this.setTier(Number(cached));
        return;
      }
    } catch {
      // Storage may be blocked: the benchmark table answers instead.
    }
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  rendererName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }

  private setTier(tier: number, failed = false): void {
    this.tier = tier;
    const ratio = pixelRatioFor(tier, window.devicePixelRatio, { mobile: this.opts.cameraStyle === "mobile", failed });
    if (this.renderer.getPixelRatio() !== ratio) {
      this.renderer.setPixelRatio(ratio);
      // Setting the ratio clears the canvas: draw again in this same task.
      this.redrawNow();
    }
    const aniso = this.anisotropy();
    for (const t of this.figure?.allTextures() ?? []) {
      if (t.anisotropy !== aniso && t !== whiteTexture()) {
        t.anisotropy = aniso;
        t.needsUpdate = true;
        this.invalidate();
      }
    }
  }

  private async detectTier(): Promise<void> {
    if (this.tier !== null) return;
    const name = this.rendererName();
    try {
      const { getGPUTier } = await import("detect-gpu");
      const glContext = this.renderer.getContext();
      let result;
      try {
        result = await getGPUTier({ glContext, benchmarksURL: "/gpu" });
      } catch {
        result = await getGPUTier({ glContext });
      }
      const tier = effectiveTier(result, name);
      this.setTier(tier);
      try {
        localStorage.setItem(`${TIER_CACHE_KEY}:${name}`, String(tier));
      } catch {
        // Fine: it is measured again next visit.
      }
    } catch (err) {
      console.warn("[eclipse] GPU tier unknown:", err);
      this.setTier(1, true);
    }
  }

  anisotropy(): number {
    return anisotropyFor(this.tier ?? 3, this.renderer.capabilities.getMaxAnisotropy());
  }

  // --- Loading ------------------------------------------------------------

  loadModel(modelId: string, lookText?: string): Promise<void> {
    if (this.loadingId === modelId && this.loadPromise) return this.loadPromise;
    if (!this.loadingId && this.figure?.id === modelId) return Promise.resolve();
    this.loadAbort?.abort();
    const abort = new AbortController();
    const seq = ++this.loadSeq;
    this.loadAbort = abort;
    this.loadingId = modelId;
    const promise = this.runLoad(modelId, abort, seq, lookText).finally(() => {
      if (seq === this.loadSeq) {
        this.loadAbort = null;
        this.loadPromise = null;
        this.loadingId = null;
      }
    });
    this.loadPromise = promise;
    return promise;
  }

  private async runLoad(id: string, abort: AbortController, seq: number, lookText?: string): Promise<void> {
    const started = performance.now();
    const stale = () => seq !== this.loadSeq;
    $loading.set(true);
    $progress.set(0);
    $error.set(null);
    const progress = new ByteProgress((f) => $progress.set(f));
    let figure: Figure | null = null;
    let wardrobe: Wardrobe | null = null;
    let director: ClipDirector | null = null;
    let customizerForLoad: Customizer | null = null;
    try {
      const assets = await ModelAssets.load(id, this.env, {
        signal: abort.signal,
        onBytes: (n) => progress.add(n),
        onExpect: (n) => progress.expect(n),
        lite: this.opts.lite,
      });
      if (stale()) {
        assets.dispose();
        return;
      }
      await yieldToMain();
      figure = new Figure(assets);
      figure.root.position.set(MODEL_OFFSET[0], MODEL_OFFSET[1], MODEL_OFFSET[2]);
      figure.onChange = () => this.invalidate();
      this.drawBaseComposite(figure);

      // The default clip's pose is on before anything can see the figure.
      // A shared link's look, or skinned parts the first look wears: it joins already dressed.
      const customizer = new Customizer(figure, this.env, this.lookHost(figure));
      customizerForLoad = customizer;
      if (lookText !== undefined || assets.manifest.lookHasParts) {
        const data = await customizer.load();
        if (stale()) throw new DOMException("superseded", "AbortError");
        if (data) await customizer.apply(decodeLook(lookText, data.options, assets.manifest.look ?? {}), false);
        if (stale()) throw new DOMException("superseded", "AbortError");
      }

      director = new ClipDirector(figure, this.opts.lite, () => this.invalidate());
      director.startDefault(this.opts.animated ? assets.defaultClip : null, $timeScale.get());
      figure.poseNow();

      wardrobe = new Wardrobe(figure, this.env, this.composer, this.wardrobeHost(figure));
      await wardrobe.restore(this.wardrobe?.committedEntries() ?? [...this.earlyOutfit]);
      if (stale()) throw new DOMException("superseded", "AbortError");

      await this.prepare(figure.root, figure.allTextures());
      if (stale()) throw new DOMException("superseded", "AbortError");
      await this.prepareEffects(figure, false);
      if (stale()) throw new DOMException("superseded", "AbortError");
      this.rehearse([figure.root]);

      const adopted = figure;
      const adoptedDirector = director;
      const adoptedWardrobe = wardrobe;
      const adoptedCustomizer = customizer;
      this.pendingOps.push(() => {
        this.adopt(adopted, adoptedDirector, adoptedWardrobe);
        const old = this.customizer;
        this.customizer = adoptedCustomizer;
        $customization.set(adoptedCustomizer.data);
        $look.set(adoptedCustomizer.look);
        this.afterDraw.push(() => old?.dispose());
      });
      await this.nextDrawnFrame();

      this.loadMs = performance.now() - started;
      this.loadBytes = progress.bytes;
      progress.finish();
      $loading.set(false);
      if (!this.fadedIn) {
        this.fadedIn = true;
        // One frame after the first centred frame, and never again.
        requestAnimationFrame(() => {
          const canvas = this.canvas;
          if (canvas) {
            canvas.style.transition = FADE_IN_CSS;
            canvas.classList.remove("opacity-0");
            canvas.style.opacity = "1";
          }
          this.scheduleTierDetection();
        });
      }
    } catch (err) {
      director?.dispose();
      wardrobe?.dispose();
      customizerForLoad?.dispose();
      if (figure) figure.dispose();
      if (isAbort(err) || stale()) return;
      // The model on screen stays. The UI shows the store's message and a retry.
      $loading.set(false);
      $error.set((err as Error).message ?? String(err));
      throw err;
    }
  }

  private scheduleTierDetection(): void {
    if (this.tier !== null) return;
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(() => void this.detectTier(), { timeout: 3000 });
    else setTimeout(() => void this.detectTier(), 1000);
  }

  private drawBaseComposite(figure: Figure): void {
    const c = figure.assets.manifest.composite;
    if (!c) return;
    const layers = figure.assets.layers.flatMap(({ layer, texture }) =>
      texture && layer.targetType === 1 ? [{ rect: layer.rect, blend: layer.blend, texture }] : [],
    );
    figure.baseComposite = this.composer.render(c.width, c.height, layers, this.anisotropy());
    figure.setComposite(figure.baseComposite.texture);
    // A model texture painted by several layers at once: eyes under an eyesight overlay.
    for (const type of new Set(figure.assets.layers.map((l) => l.layer.targetType))) {
      if (type === 1) continue;
      const of = figure.assets.layers.filter((l) => l.layer.targetType === type && l.texture);
      const entry = figure.assets.manifest.textures.find((t) => t.type === type);
      if (!of.length || !entry?.width) continue;
      const rt = this.composer.render(
        entry.width,
        entry.height,
        of.map((l) => ({ rect: { x: 0, y: 0, w: entry.width, h: entry.height }, blend: l.layer.blend, texture: l.texture! })),
        this.anisotropy(),
        true,
      );
      figure.ownTarget(rt);
      figure.setModelTexture(type, rt.texture);
    }
    if (figure.assets.manifest.boneSet) figure.setBoneSet(figure.assets.manifest.boneSet);
  }

  /** Programs compiled without blocking, textures uploaded: a subtree ready to draw. */
  private async prepare(root: Object3D, textures: readonly Texture[]): Promise<void> {
    for (const t of textures) this.renderer.initTexture(t);
    await yieldToMain();
    await linkInBackground(this.renderer, () => this.renderer.compileAsync(root, this.camera, this.scene));
  }

  /**
   * A figure's particles and ribbons, built off stage with their programs linked, so
   * they cost the first frame nothing. Lite previews have none, and a model with no
   * emitters stops at the first compare.
   */
  private async prepareEffects(figure: Figure, ownClip: boolean): Promise<void> {
    if (this.opts.lite || figure.emitters) return;
    const emitters = FigureEmitters.create(figure);
    if (!emitters) return;
    figure.emitters = emitters;
    emitters.ownClock = ownClip;
    emitters.setEnabled($effects.get());
    for (const t of emitters.textures()) this.renderer.initTexture(t);
    await linkInBackground(this.renderer, () => this.renderer.compileAsync(emitters.root, this.camera, this.scene));
  }

  /**
   * A figure's `.phys`, fetched and started after it is on stage: the module and the
   * file come later than the first frame, and until they land the clip plays as it is.
   * A model with no physics stops at the first compare.
   */
  private async startPhysics(figure: Figure, attached: boolean, node: Object3D): Promise<void> {
    const entry = figure.assets.manifest.phys;
    if (!entry || this.opts.lite || figure.rig) return;
    try {
      const [{ parsePhys, PhysScene }, { PhysicsRig }, buffer] = await Promise.all([
        import("./physics/index"),
        import("./physics/rig"),
        fetchBytes(packUrl(this.opts.packBase, entry.key), { priority: "low", expected: entry.bytes }),
      ]);
      const model = parsePhys(new Uint8Array(buffer));
      // Worn and taken off again while it was on the wire: nothing to start.
      if (!model || figure.rig || figure.assets.disposedNow || !node.parent) return;
      this.physScene ??= new PhysScene();
      figure.rig = new PhysicsRig(figure, model, this.physScene, attached);
    } catch (err) {
      if (!isAbort(err)) console.warn(`[eclipse] physics of ${figure.id} stays off:`, err);
    }
  }

  /**
   * A draw of the new subtree with a zero-size scissor: no pixel changes, but the
   * buffers upload, the bone texture exists and the shadow programs link, now, while
   * the old picture is still up. The real first frame then has nothing left to do.
   */
  private rehearse(roots: readonly Object3D[]): void {
    const { renderer, scene, camera } = this;
    const hidden: Object3D[] = [];
    for (const child of scene.children) {
      if (child !== this.light && child !== this.light.target && child !== camera && child !== this.ground && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    const parents = roots.map((r) => r.parent);
    for (const r of roots) scene.add(r);
    const size = renderer.getSize(_size2);
    const x = size.x;
    const y = size.y;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 0, 0);
    // Twice: three keys a shadow program by the light count it saw last frame, so
    // the second real frame would otherwise link another one.
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    renderer.setScissor(0, 0, x, y);
    renderer.setScissorTest(false);
    roots.forEach((r, i) => {
      const parent = parents[i];
      if (parent) parent.add(r);
      else r.removeFromParent();
    });
    for (const child of hidden) child.visible = true;
  }

  /**
   * While the first pack is on the wire, the programs every figure needs link: the
   * skinned shadow program, the ground, the common batch. Nothing is on screen yet, and
   * the first frame then does not wait for them.
   */
  private warmUp(): void {
    if (this.figure || this.frameCount > 0 || !this.renderer) return;
    const { renderer, camera, scene } = this;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
    geometry.setAttribute("uv1", new BufferAttribute(new Float32Array(6), 2));
    geometry.setAttribute("skinIndex", boneIndices(new Uint16Array(12)));
    geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(12), 4));
    const skinned = (material: Material) => {
      const mesh = new SkinnedMesh(geometry, material);
      const bone = new Bone();
      mesh.add(bone);
      mesh.bind(new Skeleton([bone]));
      return mesh;
    };
    const batch = new BatchMaterial({ hash: 0, geoset: 0, units: [], shader: 0, blend: 0, flags: 0, priority: 0, color: -1, opacity: -1 }, true);
    const depth = [BackSide, DoubleSide].map((side) => new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side }));
    const held: Material[] = [batch, ...depth];
    // Links in parallel: nothing here waits. The materials hold the programs alive
    // until the first figure has taken them over.
    void renderer.compileAsync(skinned(batch), camera, scene);
    void renderer.compileAsync(this.ground, camera, scene);
    const target = new WebGLRenderTarget(1, 1);
    renderer.setRenderTarget(target);
    for (const m of depth) void renderer.compileAsync(skinned(m), camera, scene);
    renderer.setRenderTarget(null);
    this.releaseWarmUp = () => {
      for (const m of held) m.dispose();
      geometry.dispose();
      target.dispose();
    };
  }

  /** Runs inside a tick, before the frame is drawn: one step from the old model to the new. */
  private adopt(figure: Figure, director: ClipDirector, wardrobe: Wardrobe): void {
    this.riderSeq++;
    this.dropRider();
    const oldFigure = this.figure;
    const oldDirector = this.director;
    const oldWardrobe = this.wardrobe;
    if (oldFigure) {
      oldFigure.root.removeFromParent();
      oldFigure.emitters?.root.removeFromParent();
    }
    if (oldWardrobe) for (const piece of oldWardrobe.pieces) piece.figure.emitters?.root.removeFromParent();
    this.scene.add(figure.root);
    if (figure.emitters) this.scene.add(figure.emitters.root);
    for (const piece of wardrobe.pieces) {
      if (piece.figure.emitters) this.scene.add(piece.figure.emitters.root);
      void this.startPhysics(piece.figure, true, piece.node);
    }
    void this.startPhysics(figure, false, figure.root);
    this.figure = figure;
    this.director = director;
    this.wardrobe = wardrobe;
    this.fxClockMs = 0;
    // Worn or taken off while the new body was loading: the old wardrobe heard it, the new one must too.
    if (oldWardrobe) wardrobe.adoptCommitted(oldWardrobe.committedEntries());

    this.applyViewState(figure);
    this.centerModel(false);
    this.controls.update(0);
    this.fitToBounds();

    $manifest.set(figure.assets.manifest);
    $clips.set(figure.assets.clips.entries);
    $currentClip.set(director.currentId);
    $paused.set(director.current === null);
    this.publishParts();

    // The old one goes once the new frame is drawn.
    this.afterDraw.push(() => {
      oldDirector?.dispose();
      oldWardrobe?.dispose();
      oldFigure?.dispose();
      this.releaseWarmUp?.();
      this.releaseWarmUp = null;
    });
    this.skeletonHelper?.removeFromParent();
    this.skeletonHelper?.dispose();
    this.skeletonHelper = null;
    if ($skeleton.get()) this.showSkeleton(true);
    // A hovered part of the old model is gone.
    this.outline?.select([]);
  }

  private applyViewState(figure: Figure): void {
    const shadows = $shadows.get();
    for (const part of figure.parts) {
      if (!shadows) part.mesh.castShadow = false;
      if ($wireframe.get()) {
        part.material.wireframe = true;
        part.wireframe = true;
      }
    }
  }

  private wardrobeHost(figure: Figure): WardrobeHost {
    return {
      prepare: (root, textures) => this.prepare(root, textures),
      prepareTexture: async (t) => this.renderer.initTexture(t),
      prepareEffects: (f, ownClip) => this.prepareEffects(f, ownClip),
      anisotropy: () => this.anisotropy(),
      // A figure not yet on stage has nothing to rehearse beside: it is rehearsed whole, dressed.
      rehearse: (node) => {
        if (this.figure === figure) this.rehearse([node]);
      },
      applyAtomically: (change) => {
        // A figure not yet on stage just takes it: it joins the scene already dressed.
        if (this.figure !== figure) {
          this.applyOutfit(figure, change, false);
          return Promise.resolve();
        }
        this.pendingOps.push(() => this.applyOutfit(figure, change, true));
        return this.nextDrawnFrame();
      },
    };
  }

  private applyOutfit(figure: Figure, change: OutfitChange, live: boolean): void {
    for (const piece of change.detach) {
      piece.node.removeFromParent();
      piece.figure.emitters?.root.removeFromParent();
      // A cached piece must not keep colliding in the shared world from off stage.
      piece.figure.rig?.dispose();
      piece.figure.rig = null;
    }
    for (const piece of change.attach) {
      piece.parent?.add(piece.node);
      if (live && piece.figure.emitters) this.scene.add(piece.figure.emitters.root);
      if (live) void this.startPhysics(piece.figure, true, piece.node);
    }
    figure.applyGeosets(change.visible);
    figure.setComposite(change.composite);
    figure.setWornTextures(change.wornTextures);
    if (live) {
      this.fitToBounds();
      this.publishParts();
      this.invalidate();
    }
  }

  /** Resolves when a frame holding every queued operation has been drawn. */
  private nextDrawnFrame(): Promise<void> {
    return new Promise((resolve) => {
      this.frameWaiters.push(resolve);
      this.dirty = true;
      this.updateLoop();
      if (!this.running) {
        // Tab hidden or canvas off screen: apply now, there is no frame to wait for.
        this.flushOps();
        this.flushAfterDraw();
        this.resolveWaiters();
      }
    });
  }

  private flushOps(): void {
    if (this.pendingOps.length === 0) return;
    const ops = this.pendingOps.splice(0, this.pendingOps.length);
    for (const op of ops) op();
    this.dirty = true;
  }

  private flushAfterDraw(): void {
    if (this.afterDraw.length === 0) return;
    const ops = this.afterDraw.splice(0, this.afterDraw.length);
    for (const op of ops) op();
  }

  private resolveWaiters(): void {
    if (this.frameWaiters.length === 0) return;
    const waiters = this.frameWaiters.splice(0, this.frameWaiters.length);
    for (const w of waiters) w();
  }

  // --- The loop -----------------------------------------------------------

  private readonly tick = (): void => {
    const now = performance.now();
    this.flushOps();
    const dt = this.lastTick > 0 ? (now - this.lastTick) / 1000 : 0;
    this.lastTick = now;

    this.worldFresh = false;
    const moved = this.advance(dt);
    const presenting = this.renderer.xr.isPresenting;
    const hovering = this.outline?.active === true;
    if (!moved && !this.dirty && !presenting && !hovering && this.forcedContinuous === 0) {
      this.stats.gap();
      return;
    }
    this.stats.sample(now);
    this.dirty = false;
    this.draw(dt);
    this.flushAfterDraw();
    this.resolveWaiters();
  };

  /** Advances everything by dt. True when the picture changed. Allocates nothing. */
  private advance(dt: number): boolean {
    const director = this.director;
    const figure = this.figure;
    let changed = false;
    const paused = director === null || director.current === null || director.current.paused;
    if (director) {
      if (director.isPlaying) changed = true;
      director.update(dt);
    }
    if (this.controls.update(dt)) {
      changed = true;
      if (!this.renderer.xr.isPresenting) this.updateDepthRange();
    }
    if (this.autoRotation) {
      void this.controls.rotate($autoRotationSpeed.get() * dt, 0, false);
      changed = true;
    }
    this.updateXRGrab();

    const pieces = this.wardrobe?.pieces;
    if (pieces) {
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]!;
        piece.figure.mixer.update(paused ? 0 : dt * (figure?.mixer.timeScale ?? 1));
      }
    }
    this.rider?.figure.mixer.update(paused ? 0 : dt * (figure?.mixer.timeScale ?? 1));

    if (figure) {
      const fxRuns = !paused || director?.currentId === TPOSE;
      if (fxRuns) {
        const scaled = dt * figure.mixer.timeScale;
        this.fxClockMs += scaled * 1000;
        const clipMs = director ? director.time() * 1000 : 0;
        if (figure.fx.animated) {
          figure.fx.update(clipMs, this.fxClockMs);
          changed = true;
        }
        if (pieces) {
          for (let i = 0; i < pieces.length; i++) {
            const f = pieces[i]!.figure;
            if (f.fx.animated) {
              f.fx.update(clipMs, this.fxClockMs);
              changed = true;
            }
          }
        }
        if (this.updateEffects(figure, scaled, clipMs)) changed = true;
        this.posedAt = -1;
      } else if (director && figure.rig && director.time() !== this.posedAt) {
        // Paused and scrubbed: the body moved, so what hangs off it follows at once.
        this.posedAt = director.time();
        this.updateEffects(figure, 1 / 60, this.posedAt * 1000);
      }
    }
    return changed;
  }

  /**
   * Particles and ribbons, which read this frame's bones. Figures with neither stop at
   * a compare. Those with some need the world matrices now, not at the render, so this
   * updates them once and the render skips its own pass.
   */
  private updateEffects(figure: Figure, dt: number, clipMs: number): boolean {
    const pieces = this.wardrobe?.pieces;
    let any = figure.emitters !== null || figure.rig !== null;
    if (pieces && !any) {
      for (let i = 0; i < pieces.length; i++) {
        const f = pieces[i]!.figure;
        if (f.emitters !== null || f.rig !== null) {
          any = true;
          break;
        }
      }
    }
    if (!any) return false;
    this.scene.updateMatrixWorld();
    this.worldFresh = true;
    FX_CLOCK[0] = clipMs;
    FX_CLOCK[1] = this.fxClockMs;
    FX_CLOCK[2] = dt;
    const clip = this.director?.currentId ?? null;
    let changed = false;

    // Physics first: particles on a bone it moves read the moved bone.
    if (this.physicsOn) {
      let rigs = 0;
      if (figure.rig) {
        figure.rig.drive(dt);
        rigs++;
      }
      if (pieces) {
        for (let i = 0; i < pieces.length; i++) {
          const rig = pieces[i]!.figure.rig;
          if (rig) {
            rig.drive(dt);
            rigs++;
          }
        }
      }
      if (rigs > 0) {
        this.physScene?.step(dt);
        figure.rig?.write();
        if (pieces) for (let i = 0; i < pieces.length; i++) pieces[i]!.figure.rig?.write();
        changed = true;
      }
    }
    if (figure.emitters) {
      figure.emitters.setClip(clip);
      if (figure.emitters.update(this.camera)) changed = true;
    }
    if (pieces) {
      for (let i = 0; i < pieces.length; i++) {
        const e = pieces[i]!.figure.emitters;
        if (!e) continue;
        if (!e.ownClock) e.setClip(clip);
        if (e.update(this.camera)) changed = true;
      }
    }
    return changed;
  }

  private draw(dt: number): void {
    const rig = this.outline;
    if (this.worldFresh) this.scene.matrixWorldAutoUpdate = false;
    if (rig?.active && this.figure) rig.render(this.figure.parts, dt);
    else this.renderer.render(this.scene, this.camera);
    this.scene.matrixWorldAutoUpdate = true;
    this.worldFresh = false;
    this.frameCount++;
    this.onFrame?.();
  }

  /** Draw in this very task: for changes that clear the canvas. */
  private redrawNow(): void {
    if (!this.figure || !this.camera) return;
    this.draw(0);
  }

  invalidate(): void {
    this.dirty = true;
  }

  private updateLoop(): void {
    if (!this.renderer) return;
    const hasWork = this.figure !== null || this.pendingOps.length > 0;
    const xr = this.renderer.xr.isPresenting;
    const run = hasWork && (xr || (!this.hiddenTab && this.onScreen));
    if (run === this.running) return;
    this.running = run;
    if (run) {
      this.lastTick = 0;
      this.stats.gap();
      this.dirty = true;
      this.renderer.setAnimationLoop(this.tick);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  private onVisibility(): void {
    this.hiddenTab = document.visibilityState === "hidden";
    this.updateLoop();
  }

  // --- Resize -------------------------------------------------------------

  private scheduleResize(): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.resize(), RESIZE_DEBOUNCE_MS);
  }

  private resize(): void {
    if (!this.canvas || this.capturing) return;
    const parent = this.canvas.parentElement ?? this.canvas;
    const { width, height } = parent.getBoundingClientRect();
    const w = Math.max(RESIZE_MIN_PX, width);
    const h = Math.max(RESIZE_MIN_PX, height);
    const size = this.renderer.getSize(_size2);
    if (size.x === w && size.y === h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.outline?.resize(w, h);
    if (!this.opts.interactable) this.centerModel(false);
    // Resizing clears the canvas: the new frame must be there before it is shown.
    this.controls.update(0);
    this.redrawNow();
  }

  // --- Framing ------------------------------------------------------------

  /**
   * Each visible part's box, by skinning its vertices on the CPU: 15 to 25 ms on a body, and it
   * runs every time the camera steps back. It is kept until what shows or what plays changes.
   */
  private partBoxes(figure: Figure): Box3[] {
    let key = this.director?.currentId ?? "";
    for (const part of figure.parts) key += part.mesh.visible ? "1" : "0";
    const kept = this.boxesKept;
    if (kept && kept.figure === figure && kept.key === key) return kept.boxes;
    figure.poseNow();
    const boxes: Box3[] = [];
    for (const part of figure.parts) {
      if (!part.mesh.visible) continue;
      const box = meshBox(part.mesh as SkinnedMesh);
      if (!box.isEmpty()) boxes.push(box);
    }
    this.boxesKept = { figure, key, boxes };
    return boxes;
  }

  private boxesKept: { figure: Figure; key: string; boxes: Box3[] } | null = null;

  centerModel(transition = false): void {
    const figure = this.figure;
    if (!figure) return;
    $focusedSlot.set(null);
    const box = new Box3();
    const boxes = this.partBoxes(figure);
    if (boxes.length > 0) {
      const hasGround = figure.assets.manifest.groundBone !== undefined;
      const kept = hasGround ? boxes : filterOutlierBoxes(boxes.map(asBoxLike)).map((b) => b.source);
      for (const b of kept) box.union(b);
    } else {
      const { min, max } = figure.assets.manifest.bounds;
      box.min.set(...offset(min));
      box.max.set(...offset(max));
    }
    if (this.opts.frameMotion) this.expandByClipMotion(figure, box);
    const groundBone = figure.assets.manifest.groundBone;
    if (groundBone !== undefined && this.director?.current) {
      const node = figure.bones.get(`b${groundBone}`);
      if (node) {
        const groundY = node.getWorldPosition(_v).y;
        if (!box.isEmpty() && box.max.y > groundY) box.min.y = Math.max(box.min.y, groundY);
      }
    }
    if (this.opts.framePadding > 0 && !box.isEmpty()) {
      const s = box.getSize(new Vector3());
      box.expandByScalar((Math.max(s.x, s.y, s.z) * this.opts.framePadding) / 100);
    }

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const boundary = boundarySize([size.x, size.y, size.z]);
    this.controls.setBoundary(new Box3().setFromCenterAndSize(center, new Vector3(...boundary)));

    const style = frameStyle(this.opts.cameraStyle, this.opts.interactable, size.z);
    void this.controls.fitToBox(box, transition, style.padding);
    // A body stands as on retail's customization screen, whose camera has pitch 0
    // (sub_101D21390 in 12.1.0.69933). Seen from above, as a League champion is, a broad
    // man's head sinks between his shoulders and he reads as hunched.
    const polar = figure.assets.manifest.look ? BODY_POLAR : style.polar;
    void this.controls.rotateTo(style.azimuth, polar, transition);
  }

  /** Temp mixers over the clips about to play, bone positions only. */
  private expandByClipMotion(figure: Figure, box: Box3): void {
    const skeleton = figure.skeleton;
    const clip = this.director?.current?.getClip();
    if (!skeleton || !clip || clip.duration <= 0 || box.isEmpty()) return;
    const boneBox = () => {
      figure.root.updateMatrixWorld(true);
      const out = new Box3();
      for (const bone of skeleton.bones) {
        // The joint itself: a bone's origin here is model space, not the joint.
        const p = bone.userData.pivot as [number, number, number] | undefined;
        if (p) out.expandByPoint(_v.set(p[0], p[1], p[2]).applyMatrix4(bone.matrixWorld));
        else out.expandByPoint(bone.getWorldPosition(_v));
      }
      return out;
    };
    const rest = boneBox();
    const growth = new Box3(new Vector3(), new Vector3());
    const clips = this.director?.chain
      ? this.director.chain.clips.flatMap((id) => {
          const c = figure.assets.clips.cached(id);
          return c ? [c] : [];
        })
      : [clip];
    for (const c of clips) {
      const temp = new AnimationMixer(figure.root);
      temp.clipAction(c).play();
      for (let i = 0; i < MOTION_SAMPLES; i++) {
        temp.setTime((c.duration * i) / MOTION_SAMPLES);
        const now = boneBox();
        growth.min.min(now.min.sub(rest.min));
        growth.max.max(now.max.sub(rest.max));
      }
      temp.stopAllAction();
      temp.uncacheRoot(figure.root);
    }
    // The temp mixer put the bones back at rest: the real one lays its pose on again.
    figure.mixer.update(0);
    figure.root.updateMatrixWorld(true);
    box.min.add(growth.min);
    box.max.add(growth.max);
  }

  /** Shadow frustum and depth range follow the figure, only when its bounds change. */
  private fitToBounds(): void {
    const figure = this.figure;
    if (!figure) return;
    const { min, max } = figure.assets.manifest.bounds;
    const box: BoxLike = this.worldBounds(min, max);
    this.modelCenter.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
    this.modelRadius = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2;
    this.depthDistance = 0;
    this.updateDepthRange();

    if (!this.opts.shadow) return;
    const fit = fitShadow(box, SHADOW_LIGHT.position, SHADOW_LIGHT.mapSize);
    this.shadowFit = fit;
    const light = this.light;
    const reach = fit.far / 2;
    const dir = _v.set(...SHADOW_LIGHT.position).normalize();
    light.target.position.set(fit.center[0], fit.center[1], fit.center[2]);
    light.position.set(fit.center[0], fit.center[1], fit.center[2]).addScaledVector(dir, reach);
    const cam = light.shadow.camera;
    cam.left = -fit.half;
    cam.right = fit.half;
    cam.top = fit.half;
    cam.bottom = -fit.half;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  }

  private worldBounds(min: Vec3, max: Vec3): BoxLike {
    const lo = offset(min);
    const hi = offset(max);
    // Attached models reach past the body's own bounds.
    let grow = 0;
    for (const piece of this.wardrobe?.pieces ?? []) {
      if (piece.kind === "attached") grow = Math.max(grow, piece.figure.sizeHint());
    }
    return {
      min: [lo[0] - grow, Math.min(lo[1], 0), lo[2] - grow],
      max: [hi[0] + grow, hi[1] + grow, hi[2] + grow],
    };
  }

  private updateDepthRange(): void {
    const d = this.camera.position.distanceTo(this.modelCenter);
    if (this.depthDistance > 0 && Math.abs(d - this.depthDistance) < this.depthDistance * 0.03) return;
    this.depthDistance = d;
    const range = depthRange(d, this.modelRadius);
    if (range.near !== this.camera.near || range.far !== this.camera.far) {
      this.camera.near = range.near;
      this.camera.far = range.far;
      this.camera.updateProjectionMatrix();
    }
  }

  focusSlot(slot: SlotId | null): void {
    const figure = this.figure;
    if (!figure) return;
    if (!slot) {
      this.centerModel(true);
      return;
    }
    $focusedSlot.set(slot);
    const { min, max } = figure.assets.manifest.bounds;
    const lo = offset(min);
    const hi = offset(max);
    const view = slotView(slot, { min: lo, max: hi });
    const box = new Box3(new Vector3(...view.min), new Vector3(...view.max));
    const padding = { paddingTop: 0.05, paddingBottom: 0.05, paddingLeft: 0.05, paddingRight: 0.05 };
    void this.controls.fitToBox(box, true, padding);
    void this.controls.rotateTo(view.azimuth, figure.assets.manifest.look ? BODY_POLAR : frameStyle(this.opts.cameraStyle, true, 0).polar, true);
    this.invalidate();
  }

  // --- Animation ----------------------------------------------------------

  async playNextAnimation(): Promise<void> {
    await this.director?.next();
  }
  async playPreviousAnimation(): Promise<void> {
    await this.director?.previous();
  }
  async playAnimationByName(id: string): Promise<void> {
    await this.director?.play(id);
  }
  async playPlaylist(ids: string[]): Promise<void> {
    await this.director?.playChain(ids, true, "playlist");
  }
  updatePlaylist(ids: string[]): void {
    this.director?.updatePlaylist(ids);
  }
  stopPlaylistChain(): void {
    this.director?.stopChain();
  }
  jumpChainTo(oneBased: number): void {
    void this.director?.jump(oneBased);
  }
  togglePauseAnimation(): void {
    this.director?.togglePause();
  }
  pauseAnimation(): void {
    this.director?.setPaused(true);
  }
  playAnimation(): void {
    this.director?.setPaused(false);
  }
  isAnimationPaused(): boolean {
    const a = this.director?.current;
    return a ? a.paused : true;
  }
  goToNextTimeScale(): void {
    this.director?.nextTimeScale(TIME_SCALES);
  }
  setAnimationTime(seconds: number): void {
    this.director?.setTime(seconds);
  }
  setAnimationTimePercent(percent: number): void {
    this.director?.setTime(this.getAnimationDuration() * Math.max(0, Math.min(1, percent)));
  }
  getAnimationDuration(): number {
    return this.director?.duration() ?? 0;
  }
  getCurrentAnimationTime(): number {
    return this.director?.time() ?? 0;
  }

  // --- View ---------------------------------------------------------------

  fullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const canvas = this.canvas;
    const target = canvas?.closest("[data-panel-group]") ?? canvas?.parentElement?.parentElement ?? canvas;
    void target?.requestFullscreen();
  }

  toggleWatermark(): void {
    const root = document.documentElement;
    const off = getComputedStyle(root).getPropertyValue("--model-background-image").trim() === "none";
    root.style.setProperty("--model-background-image", off ? "url(/model-background.svg)" : "none");
    $watermark.set(off);
  }

  mirrorModel(): void {
    if (!this.figure) return;
    this.figure.root.scale.x *= -1;
    this.invalidate();
  }

  setBackgroundColor(css: string | null): void {
    const root = document.documentElement;
    if (css === null) root.style.removeProperty("--temporary-model-background-color");
    else root.style.setProperty("--temporary-model-background-color", css);
    $backgroundColor.set(css);
  }

  toggleShadows(): void {
    const on = !$shadows.get();
    $shadows.set(on);
    for (const part of this.figure?.parts ?? []) part.mesh.castShadow = on && !part.material.state.blended;
    for (const piece of this.wardrobe?.pieces ?? []) {
      for (const part of piece.figure.parts) part.mesh.castShadow = on && !part.material.state.blended;
    }
    this.invalidate();
  }

  setEffects(on: boolean): void {
    $effects.set(on);
    this.figure?.emitters?.setEnabled(on);
    for (const piece of this.wardrobe?.pieces ?? []) piece.figure.emitters?.setEnabled(on);
    this.invalidate();
  }

  setPhysics(on: boolean): void {
    $physics.set(on);
    this.physicsOn = on;
    const apply = (rig: Figure["rig"]) => {
      if (!rig) return;
      if (on) rig.restart();
      else rig.release();
    };
    apply(this.figure?.rig ?? null);
    for (const piece of this.wardrobe?.pieces ?? []) apply(piece.figure.rig);
    this.invalidate();
  }

  toggleSkeleton(): void {
    this.showSkeleton(!$skeleton.get());
  }

  private showSkeleton(on: boolean): void {
    $skeleton.set(on);
    if (this.skeletonHelper) {
      this.skeletonHelper.removeFromParent();
      this.skeletonHelper.dispose();
      this.skeletonHelper = null;
    }
    if (on && this.figure) {
      this.skeletonHelper = new SkeletonHelper(this.figure.root);
      this.scene.add(this.skeletonHelper);
    }
    this.invalidate();
  }

  toggleAllWireframes(): void {
    const on = !$wireframe.get();
    $wireframe.set(on);
    for (const part of this.figure?.parts ?? []) {
      part.material.wireframe = on;
      part.wireframe = on;
    }
    this.publishParts();
    this.invalidate();
  }

  setAutoRotationSpeed(radiansPerSecond: number): void {
    $autoRotationSpeed.set(radiansPerSecond);
    this.autoRotation = radiansPerSecond !== 0;
    this.invalidate();
  }

  showAllParts(): void {
    this.setAllParts(true);
  }
  hideAllParts(): void {
    this.setAllParts(false);
  }

  /** "All" means everything this look wears: a part of no look can't be switched on. */
  private setAllParts(visible: boolean): void {
    for (const part of this.figure?.parts ?? []) part.userVisible = visible ? null : false;
    this.figure?.refreshVisibility();
    this.publishParts();
    this.invalidate();
  }

  // --- Parts --------------------------------------------------------------

  private partsOf(hash: number): readonly Part[] {
    return this.figure?.byHash.get(hash) ?? [];
  }

  toggleMaterialByHash(hash: number): void {
    for (const part of this.partsOf(hash)) {
      if (part.shown) part.userVisible = !part.mesh.visible;
    }
    this.figure?.refreshVisibility();
    this.publishParts();
    this.invalidate();
  }

  toggleWireframeByHash(hash: number): void {
    for (const part of this.partsOf(hash)) {
      part.wireframe = !part.wireframe;
      part.material.wireframe = part.wireframe;
    }
    this.publishParts();
    this.invalidate();
  }

  toggleTransparencyByHash(hash: number): void {
    for (const part of this.partsOf(hash)) part.material.setUserTransparent(!part.material.userTransparent);
    this.publishParts();
    this.invalidate();
  }

  toggleDepthWriteByHash(hash: number): void {
    for (const part of this.partsOf(hash)) part.material.depthWrite = !part.material.depthWrite;
    this.publishParts();
    this.invalidate();
  }

  setOpacityByHash(hash: number, opacity: number): void {
    for (const part of this.partsOf(hash)) {
      if (!part.material.userTransparent) part.material.setUserTransparent(true);
      part.material.uniforms.uUserOpacity.value = opacity;
    }
    this.publishParts();
    this.invalidate();
  }

  /** The old texture stays until the new one is uploaded: no flash. */
  async setTextureByHash(hash: number, dataUrl: string): Promise<void> {
    const parts = this.partsOf(hash);
    if (parts.length === 0 || !this.figure) return;
    const figure = this.figure;
    const texture = await new TextureLoader().loadAsync(dataUrl);
    texture.flipY = false;
    texture.colorSpace = NoColorSpace;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = this.anisotropy();
    this.renderer.initTexture(texture);
    if (figure !== this.figure) {
      texture.dispose();
      return;
    }
    figure.assets.own(texture);
    this.pendingOps.push(() => {
      for (const part of parts) part.material.uniforms.uT0.value = texture;
    });
    await this.nextDrawnFrame();
  }

  setAutomaticMaterialVisibility(on: boolean): void {
    $autoVisibility.set(on);
    if (on && this.figure) {
      for (const part of this.figure.parts) part.userVisible = null;
      this.figure.refreshVisibility();
      this.publishParts();
      this.invalidate();
    }
  }

  private publishParts(): void {
    const figure = this.figure;
    if (!figure) {
      $parts.set([]);
      return;
    }
    const rows: PartRow[] = [];
    for (const [hash, parts] of figure.byHash) {
      // Only what this look wears is listed. Stacking every hair and face at once is
      // not something the game can assemble.
      if (!parts.some((p) => p.shown)) continue;
      const first = parts[0]!;
      rows.push({
        hash,
        name: `Submesh ${hash}`,
        geoset: first.extras.geoset,
        visible: parts.some((p) => p.mesh.visible),
        wireframe: first.wireframe,
        transparent: first.material.transparent,
        depthWrite: first.material.depthWrite,
        opacity: first.material.uniforms.uUserOpacity.value,
      });
    }
    $parts.set(rows);
  }

  private onHover(hash: number | null): void {
    if (hash !== null && !this.outlineLoading && this.renderer && this.figure && this.outlineFor !== this.figure) {
      // Its passes draw this figure into a frame of their own, which is another set of programs:
      // they link before the hover shows, or the first one stops the page for 790 ms, measured.
      this.outlineLoading = true;
      const figure = this.figure;
      void import("./render/outline")
        .then(async ({ OutlineRig }) => {
          const size = this.renderer.getSize(_size2);
          const rig = this.outline ?? new OutlineRig(this.renderer, this.scene, this.camera, size.x, size.y);
          await rig.prepare(figure.root);
          this.outline = rig;
          this.outlineFor = figure;
          this.outlineLoading = false;
          this.onHover($hoveredPart.get());
        })
        .catch((e) => {
          // No outline is a smaller thing than a broken hover: the row still works.
          this.outlineLoading = false;
          console.warn("[eclipse] no outline:", e);
        });
      return;
    }
    if (hash !== null && this.outlineFor !== this.figure) return;
    this.outline?.select(hash === null ? [] : this.partsOf(hash));
    this.invalidate();
  }

  // --- Customization ------------------------------------------------------

  /** Not for the UI, which can only wear choices: a test's hook into the geoset rules. */
  setGeoset(group: number, value: number): void {
    const figure = this.figure;
    if (!figure) return;
    figure.look.set(group, value);
    figure.applyGeosets(this.wardrobe ? this.wardrobe.currentGeosets() : figure.look.visible);
    this.publishParts();
    this.invalidate();
  }

  private lookHost(figure: Figure): LookHost {
    return {
      composer: this.composer,
      anisotropy: () => this.anisotropy(),
      prepare: async (part) => {
        await this.prepare(part.root, part.allTextures());
      },
      applyAtomically: (op) => {
        this.pendingOps.push(() => {
          op();
          this.publishParts();
          this.invalidate();
        });
        return this.nextDrawnFrame();
      },
      overOutfit: () => (this.figure === figure ? this.wardrobe?.relook() ?? null : null),
      changed: (look) => {
        if (this.figure === figure) $look.set(look);
      },
    };
  }

  async loadCustomization(): Promise<CustomizationData | null> {
    const c = this.customizer;
    if (!c) return null;
    const [data] = await Promise.all([c.load(), this.figure?.assets.allTextures()]);
    if (this.customizer === c) $customization.set(data);
    return data;
  }

  async setLook(look: Look): Promise<void> {
    const c = this.customizer;
    if (!c) return;
    try {
      await c.apply(look);
    } catch (err) {
      if (!isAbort(err)) $error.set(`Could not change the look: ${(err as Error).message}`);
    }
  }

  prefetchLook(look: Look): void {
    void this.customizer?.prefetch(look);
  }

  // --- Dressing room ------------------------------------------------------

  async equip(slot: SlotId, itemId: string | null): Promise<void> {
    if (this.wardrobe) await this.wardrobe.equip(slot, itemId);
    // Nothing on stage yet: the first body takes it when it joins.
    else if (itemId) this.earlyOutfit.set(slot, itemId);
    else this.earlyOutfit.delete(slot);
  }

  async previewEquip(slot: SlotId, itemId: string | null): Promise<void> {
    await this.wardrobe?.preview(slot, itemId);
  }

  prefetchEquip(pieces: readonly (readonly [SlotId, string])[]): void {
    this.wardrobe?.prefetch(pieces);
  }

  warmItems(pieces: readonly (readonly [SlotId, string])[], whole: boolean): void {
    this.wardrobe?.warm(pieces, whole);
  }

  /**
   * Every program the catalogue's items use, linked when the page is idle, so a new item
   * finds them ready: measured, a program it had to wait for cost it 80 to 120 ms. They stay
   * for the life of the page, a fixed set.
   */
  warmPrograms(): void {
    if (this.programsWarmed || this.opts.lite || !this.opts.interactable) return;
    this.programsWarmed = true;
    const { renderer, camera, scene } = this;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
    geometry.setAttribute("uv1", new BufferAttribute(new Float32Array(6), 2));
    geometry.setAttribute("skinIndex", boneIndices(new Uint16Array(12)));
    geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(12), 4));
    const queue = [...CATALOGUE_PROGRAMS];
    const held: Material[] = (this.warmedPrograms = []);
    const next = () => {
      if (this.opts.lite || !this.renderer) return;
      const row = queue.shift();
      if (!row) return;
      const material = new BatchMaterial({ hash: 0, geoset: 0, units: Array.from({ length: row.units }, () => ({ tex: 0, uvSet: 0, wrapS: true, wrapT: true, uvAnim: -1 })), shader: row.shader, blend: row.blend, flags: row.flags, priority: 0, color: -1, opacity: -1 }, true);
      if (row.blend === 1) material.setShadowCut(whiteTexture());
      held.push(material);
      const mesh = new SkinnedMesh(geometry, material);
      const bone = new Bone();
      mesh.add(bone);
      mesh.bind(new Skeleton([bone]));
      void renderer.compileAsync(mesh, camera, scene).then(idle);
    };
    const idle = () => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(next, { timeout: 400 });
      else setTimeout(next, 30);
    };
    idle();
  }

  private programsWarmed = false;
  private warmedPrograms: Material[] = [];

  setSheathed(sheathed: boolean): void {
    this.wardrobe?.setStowed(sheathed);
    this.invalidate();
  }

  // --- The rider ------------------------------------------------------------

  private rider: { figure: Figure; node: Group } | null = null;
  private riderSeq = 0;

  private dropRider(): void {
    const r = this.rider;
    if (!r) return;
    this.rider = null;
    r.node.removeFromParent();
    this.afterDraw.push(() => r.figure.dispose());
  }

  /**
   * Retail seats a rider on the mount's attachment 0 (CreateUnitMount 0x0073D5D0), scaled by
   * 1 / the display's scale, playing Mount. It joins when everything is ready, in one frame.
   */
  async setRider(bodyId: string | null): Promise<void> {
    const seq = ++this.riderSeq;
    const mount = this.figure;
    if (!bodyId || !mount) {
      this.dropRider();
      this.invalidate();
      return;
    }
    const seat = mount.assets.manifest.attachments.find((a) => a.id === 0);
    const bone = seat ? mount.bones.get(`b${seat.bone}`) : undefined;
    if (!seat || !bone) {
      this.dropRider();
      return;
    }
    const abort = new AbortController();
    const assets = await ModelAssets.load(bodyId, this.env, { signal: abort.signal });
    if (seq !== this.riderSeq || this.figure !== mount) {
      assets.dispose();
      return;
    }
    const figure = new Figure(assets, { layer: 2, namePrefix: `r${seq}_` });
    this.drawBaseComposite(figure);
    const entry = assets.clips.entries.find((c) => c.animId === RIDER_CLIP);
    if (entry) {
      const clip = await assets.clips.get(entry.id, "high");
      figure.mixer.clipAction(figure.adaptClip(clip)).play();
      figure.mixer.update(0);
    }
    if (seq !== this.riderSeq || this.figure !== mount) {
      figure.dispose();
      return;
    }
    const node = new Group();
    node.name = "rider";
    node.matrixAutoUpdate = false;
    const scale = 1 / (mount.assets.manifest.displayScale ?? 1);
    node.matrix.makeScale(scale, scale, scale).setPosition(seat.position[0], seat.position[1], seat.position[2]);
    node.add(figure.root);
    await this.prepare(node, figure.allTextures());
    if (seq !== this.riderSeq || this.figure !== mount) {
      figure.dispose();
      return;
    }
    this.rehearse([node]);
    this.pendingOps.push(() => {
      this.dropRider();
      bone.add(node);
      this.rider = { figure, node };
    });
    await this.nextDrawnFrame();
  }

  addFigureCell(el: HTMLElement, opts: Parameters<ViewerEngine["addFigureCell"]>[1]): () => void {
    let removed = false;
    let remove: (() => void) | null = null;
    void this.figureCells().then((cells) => {
      if (!removed) remove = cells.add(el, { ...opts, bodyId: opts.bodyId ?? this.figure?.id });
    });
    return () => {
      removed = true;
      remove?.();
    };
  }

  async figurePoster(opts: Parameters<ViewerEngine["figurePoster"]>[0], width: number, height: number): Promise<string | null> {
    return (await this.figureCells()).posterUrl(opts, width, height);
  }

  private figureCells(): Promise<FigureCells> {
    this.cellsLoading ??= import("./render/cells").then(({ FigureCells }) => {
      this.cells = new FigureCells(this.opts.packBase);
      this.cells.hold = this.cellsHold;
      return this.cells;
    });
    return this.cellsLoading;
  }

  holdCells(hold: () => boolean): void {
    this.cellsHold = hold;
    if (this.cells) this.cells.hold = hold;
  }

  // --- Export -------------------------------------------------------------

  capturing = false;

  async exportPNG(scale: number, trim: boolean): Promise<void> {
    const { captureCanvasPng } = await import("./tools/exportImage");
    const blob = await captureCanvasPng(this.renderer, scale, trim, () => this.redrawNow());
    download(blob, `${this.figure?.id ?? "model"}.png`);
  }

  async exportSTL(): Promise<void> {
    if (!this.figure) return;
    const { exportStl } = await import("./tools/exportStl");
    download(await exportStl(this.figure.root), `${this.figure.id}.stl`);
  }

  async exportGLB(minimal: boolean, removeHidden: boolean): Promise<void> {
    if (!this.figure) return;
    const { exportGlb } = await import("./tools/exportGlb");
    const blob = await exportGlb(this.figure, this.renderer, {
      base: this.opts.packBase,
      minimal,
      removeHidden,
      currentClip: this.director?.currentId ?? null,
    });
    download(blob, `${this.figure.id}.glb`);
  }

  recordLive(onTick: (seconds: number) => void): { stop(): Promise<void> } {
    const name = this.figure?.id ?? "model";
    let stopper: Promise<{ stop(): Promise<Blob | null> }> | null = null;
    this.forcedContinuous++;
    stopper = import("./tools/exportMp4").then(({ recordCanvas }) => recordCanvas(this.canvas!, onTick));
    return {
      stop: async () => {
        const recording = await stopper!;
        const blob = await recording.stop();
        this.forcedContinuous--;
        if (blob) download(blob, `${name}.mp4`);
      },
    };
  }

  async exportMP4(opts: {
    fps: number;
    signal: AbortSignal;
    onProgress: (fraction: number, phase: "capture" | "encode") => void;
  }): Promise<void> {
    const director = this.director;
    if (!director?.current || !this.figure) throw new Error("No animation is currently playing");
    const { renderClipToMp4 } = await import("./tools/exportMp4");
    const name = `${this.figure.id}.mp4`;
    this.renderer.setAnimationLoop(null);
    this.running = false;
    this.capturing = true;
    try {
      const clip = director.current;
      const keepTime = clip.time;
      const keepPaused = clip.paused;
      clip.paused = false;
      clip.time = 0;
      const seconds = clip.getClip().duration / (this.figure.mixer.timeScale || 1);
      const blob = await renderClipToMp4(this.canvas!, this.renderer, seconds, opts, (dt) => {
        this.advance(dt);
        this.draw(dt);
      });
      clip.time = keepTime;
      clip.paused = keepPaused;
      if (blob) download(blob, name);
    } finally {
      this.capturing = false;
      this.updateLoop();
      this.scheduleResize();
    }
  }

  // --- XR -----------------------------------------------------------------

  private async probeXR(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return;
    try {
      this.xrSupported = (await xr.isSessionSupported("immersive-vr")) || (await xr.isSessionSupported("immersive-ar"));
    } catch {
      this.xrSupported = false;
    }
  }

  isXRAvailable(): boolean {
    return this.xrSupported;
  }

  async startXR(): Promise<void> {
    if (this.xrSession) {
      await this.xrSession.end();
      return;
    }
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error("WebXR is not available");
    if (!this.xrGrab.ready) {
      const { enableXRControllers } = await import("./tools/xr");
      enableXRControllers(this.renderer, this.scene, this.xrGrab, () => this.figure?.root ?? null);
      this.xrGrab.ready = true;
    }
    const mode = (await xr.isSessionSupported("immersive-vr")) ? "immersive-vr" : "immersive-ar";
    const session = await xr.requestSession(mode, { optionalFeatures: ["local-floor", "bounded-floor", "layers"] });
    session.addEventListener("end", () => {
      this.xrSession = null;
      this.updateLoop();
    });
    await this.renderer.xr.setSession(session);
    this.xrSession = session;
    this.updateLoop();
  }

  private updateXRGrab(): void {
    const active = this.xrGrab.active;
    const root = this.figure?.root;
    if (active && root) {
      root.position.copy(active.position).sub(this.xrGrab.offset);
    }
  }

  // --- Numbers ------------------------------------------------------------

  getFrameStats(): FrameStats | null {
    return this.stats.read();
  }

  resetFrameStats(): void {
    this.stats.reset();
  }

  gpu(): { geometries: number; textures: number; programs: number; calls: number; triangles: number } {
    const info = this.renderer.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      calls: info.render.calls,
      triangles: info.render.triangles,
    };
  }

  frames(): number {
    return this.frameCount;
  }

  lastLoadMs(): number {
    return this.loadMs;
  }

  lastLoadBytes(): number {
    return this.loadBytes;
  }

  /** What the automated proofs read. Nothing in the site uses this. */
  readonly internals = {
    tier: () => this.tier,
    running: () => this.running,
    compositeRuns: () => this.composer.runs,
    wardrobeApplied: () => this.wardrobe?.applied ?? 0,
    packQueue: () => queueState(),
    shadow: () => this.shadowFit,
    shadowMatrix: () => [...this.light.shadow.matrix.elements],
    depth: () => ({ near: this.camera.near, far: this.camera.far }),
    camera: () => ({ fov: this.camera.fov, position: this.camera.position.toArray(), distance: this.controls.distance, azimuth: this.controls.azimuthAngle, polar: this.controls.polarAngle }),
    controls: () => ({
      minDistance: this.controls.minDistance,
      maxDistance: this.controls.maxDistance,
      smoothTime: this.controls.smoothTime,
      draggingSmoothTime: this.controls.draggingSmoothTime,
      dollySpeed: this.controls.dollySpeed,
      truckSpeed: this.controls.truckSpeed,
      restThreshold: this.controls.restThreshold,
      dollyToCursor: this.controls.dollyToCursor,
      boundaryEnclosesCamera: this.controls.boundaryEnclosesCamera,
    }),
    rendererName: () => this.rendererName(),
    pixelRatio: () => this.renderer.getPixelRatio(),
    anisotropy: () => this.anisotropy(),
    textures: () => this.figure?.allTextures().map((t) => t.anisotropy) ?? [],
    drawOnce: () => {
      this.dirty = true;
    },
    forceContinuous: (on: boolean) => {
      this.forcedContinuous = Math.max(0, this.forcedContinuous + (on ? 1 : -1));
    },
    timeScale: () => this.figure?.mixer.timeScale ?? 1,
    visibleGeosets: () => this.figure?.parts.filter((p) => p.mesh.visible).map((p) => p.extras.geoset) ?? [],
    pieces: () => this.wardrobe?.pieces.map((p) => ({
      kind: p.kind,
      id: p.figure.id,
      mirrored: p.mirrored,
      attached: p.node.parent !== null,
      parent: p.node.parent?.name,
      det: p.figure.parts[0]?.mesh.matrixWorld.determinant() ?? 0,
    })) ?? [],
    clipsFetched: () => this.figure?.assets.clips.fetched ?? 0,
    clipCached: (id: string) => !!this.figure?.assets.clips.cached(id),
    tickNoDraw: (dt: number) => this.advance(dt),
    cells: () => this.cells,
    setTier: (t: number) => this.setTier(t),
    programsInUse: () => new Set(this.figure?.parts.map((p) => p.material.combiner) ?? []).size,
    effects: () => [this.figure?.emitters?.stats(), ...(this.wardrobe?.pieces ?? []).map((p) => p.figure.emitters?.stats())].filter(Boolean),
    rigs: () => [this.figure?.rig, ...(this.wardrobe?.pieces ?? []).map((p) => p.figure.rig)].filter((r): r is NonNullable<typeof r> => !!r),
  };

  // --- Input --------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.capturing) return;
    const target = e.target as HTMLElement | null;
    const action = resolveShortcut({
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      targetTag: target?.tagName ?? "",
      ignoreArrows: target?.getAttribute?.("data-ignore-arrows-shortcuts") === "true",
    });
    switch (action) {
      case "pause":
        e.preventDefault();
        this.togglePauseAnimation();
        break;
      case "timeScale":
        e.preventDefault();
        this.goToNextTimeScale();
        break;
      case "next":
        void this.playNextAnimation();
        break;
      case "previous":
        void this.playPreviousAnimation();
        break;
      case "stepBack":
        if (this.director?.current) this.setAnimationTime(this.director.time() - SCRUB_STEP_S);
        break;
      case "stepForward":
        if (this.director?.current) this.setAnimationTime(this.director.time() + SCRUB_STEP_S);
        break;
      case "fullscreen":
        this.fullscreen();
        break;
      case "png":
        e.preventDefault();
        void this.exportPNG(2, false);
        break;
      default:
        break;
    }
  }

  private exposeWindowApi(): void {
    if (!this.opts.interactable) return;
    const names = [
      "playNextAnimation", "playPreviousAnimation", "playAnimationByName", "playPlaylist", "updatePlaylist",
      "stopPlaylistChain", "jumpChainTo", "isAnimationPaused", "togglePauseAnimation", "goToNextTimeScale",
      "setAnimationTime", "setAnimationTimePercent", "fullscreen", "toggleWatermark", "mirrorModel",
      "setBackgroundColor", "centerModel", "exportPNG", "exportSTL", "exportGLB", "getAnimationDuration",
      "toggleShadows", "setEffects", "setPhysics", "toggleMaterialByHash", "toggleWireframeByHash", "toggleTransparencyByHash",
      "toggleDepthWriteByHash", "setOpacityByHash", "setAutomaticMaterialVisibility", "loadModel", "toggleSkeleton",
      "toggleAllWireframes", "setAutoRotationSpeed", "showAllParts", "hideAllParts", "pauseAnimation", "playAnimation",
      "setTextureByHash", "getCurrentAnimationTime", "getFrameStats", "resetFrameStats", "startXR",
    ] as const;
    const w = window as unknown as Record<string, unknown>;
    for (const name of names) {
      w[name] = (this[name] as (...args: unknown[]) => unknown).bind(this);
    }
  }

  // --- Teardown -----------------------------------------------------------

  dispose(): void {
    this.rider?.figure.dispose();
    this.rider = null;
    this.loadAbort?.abort();
    this.loadSeq++;
    clearTimeout(this.resizeTimer);
    this.renderer?.setAnimationLoop(null);
    this.running = false;
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    for (const off of this.unlisten) off();
    this.unlisten.length = 0;
    this.director?.dispose();
    this.wardrobe?.dispose();
    this.figure?.dispose();
    this.figure = null;
    this.outline?.dispose();
    this.cells?.dispose();
    this.composer?.dispose();
    for (const m of this.warmedPrograms) m.dispose();
    this.warmedPrograms = [];
    this.controls?.dispose();
    this.ground?.geometry.dispose();
    (this.ground?.material as ShadowMaterial | undefined)?.dispose();
    this.light?.shadow.dispose();
    this.renderer?.dispose();
  }
}

// --- Helpers ----------------------------------------------------------------

const _size2 = new Vector2();

function offset(v: Vec3): [number, number, number] {
  return [v[0] + MODEL_OFFSET[0], v[1] + MODEL_OFFSET[1], v[2] + MODEL_OFFSET[2]];
}

/** Skinned vertices in the current pose. Large parts are sampled: this runs on the main thread. */
function meshBox(mesh: SkinnedMesh): Box3 {
  const box = new Box3();
  const position = mesh.geometry.getAttribute("position");
  if (!position) return box;
  mesh.updateWorldMatrix(true, false);
  const stride = Math.max(1, Math.floor(position.count / 4000));
  const p = new Vector3();
  for (let i = 0; i < position.count; i += stride) {
    mesh.getVertexPosition(i, p);
    p.applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(p);
  }
  return box;
}

function asBoxLike(b: Box3): BoxLike & { source: Box3 } {
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], source: b };
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
