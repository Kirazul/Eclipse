/**
 * Live 3D grid cells: one WebGL context, shared. Cells on one body share its geometry,
 * textures, programs, skeleton and pose; what differs per cell is which parts show, the
 * composite, the pieces.
 *
 * A grid is posters, and the one cell the pointer rests on comes alive: `inCell` puts the
 * canvas inside that card. It is the card's own child, its size, so the compositor scrolls
 * them as one and it cannot draw anywhere else, whatever the main thread is doing.
 *
 * Without `inCell` the canvas lies over the page and each visible cell draws into its own
 * rectangle by scissor (three.js's multiple-elements approach). Its buffer is preserved, so
 * a cell not redrawn this frame keeps its pixels: that is the rate cap, a budget of cells
 * per frame, round robin. A scrolled page outruns such a canvas by a frame or more, so this
 * is for figures on a page that holds still.
 *
 * `capture` is what bakes the posters, through this same code: same pose, same camera, same
 * materials, so the first live frame and the poster are one picture.
 */
import {
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix4,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Skeleton,
  type SkinnedMesh,
  type Texture,
  WebGLRenderTarget,
} from "three";
import { packUrl, paths, toStraightAlpha, type ItemManifest, type SetManifest, type SlotId } from "@eclipse/format";
import { CAMERA, CELLS } from "../constants";
import { FrameStatsRing } from "../logic/frameStats";
import {
  CELL_FILL,
  VIEW_ROWS,
  WHOLE_FIGURE,
  addToExtents,
  basisOfAngles,
  basisOfRows,
  cellWindow,
  creatureExtents,
  emptyExtents,
  fitExtents,
  silhouetteBounds,
  validExtents,
  weaponView,
  windowExtents,
  type Basis,
  type CellView,
  type CellWindow,
  type Extents,
} from "../logic/cellView";
import { WEAPON_SLOTS } from "../logic/slots";
import { fetchJson, isAbort } from "../net/fetchPack";
import { ModelAssets, registerManifests, type LoadEnv } from "../model/assets";
import { whiteTexture } from "../model/loaders";
import { Figure } from "../model/figure";
import { CompositeRenderer } from "../wow/composite";
import { ItemLibrary, disposeItem, planOutfit, type Piece, type ResolvedItem } from "../wow/outfit";
import { FigureEmitters } from "./emitters";
import { keepPrograms, linkInBackground, nextTask } from "./linking";
import { FX_CLOCK } from "./particlesSim";

interface SharedBody {
  figure: Figure;
  scene: Scene;
  library: ItemLibrary;
  composites: Map<string, WebGLRenderTarget>;
  base: Texture | null;
  /** Bumped per frame: the shared skeleton uploads once however many cells draw it. */
  stamp: number;
  updatedAt: number;
  matricesAt: number;
  uses: number;
  /** Its default clip, for the clock of what the clip drives. */
  action: AnimationAction | null;
  /** Wall time of what runs on global loops. */
  fxMs: number;
  /** Sampled vertices of the default look, where the file put them and at the clip's first frame. */
  rest: Float32Array;
  posed: Float32Array;
  /** The standing figure, from `posed`. */
  minY: number;
  height: number;
  /** When it last stopped being drawn: the longest idle goes first. */
  idleSince: number;
  /** What each look measured, so a poster and the live cell over it stand in one place. */
  fits: Map<string, Silhouette>;
}

/** Where a look's real pixels reach, along its view's right and up. */
interface Silhouette {
  right: [number, number];
  up: [number, number];
}

interface BodySlot {
  promise: Promise<SharedBody>;
  abort: AbortController;
  /** Cells waiting on it. When the last one leaves before it lands, the fetch stops. */
  waiting: number;
  body: SharedBody | null;
}

type CellLook = { kind: "alone"; view: CellView } | { kind: "window"; window: CellWindow };

interface Cell {
  el: HTMLElement;
  opts: CellOptions;
  camera: PerspectiveCamera;
  body: SharedBody | null;
  visibleGeosets: ReadonlySet<number> | null;
  composite: Texture | null;
  wornTextures: ReadonlyMap<number, Texture>;
  pieces: readonly Piece[];
  /** How it looks at what it holds. Null until prepared. */
  look: CellLook | null;
  /** What it fetches on its own account. */
  abort: AbortController;
  /** The body it asked for, until it lands. */
  slot: BodySlot | null;
  /** What it wears, for whoever trims a cache. */
  wanted: string[];
  compositeKey: string;
  /** Particles and ribbons of what it holds. Only `effects` asks for them. */
  emitters: FigureEmitters[];
  warmed: boolean;
  drawn: boolean;
  /** The item has nothing to show on this body: a poster of it would be a bare figure. */
  nothing: boolean;
  /** Its look's measured silhouette, when the look frames by one. */
  fit: Silhouette | null;
  onScreen: boolean;
  ready: boolean;
  needsDraw: boolean;
  width: number;
  height: number;
  rect: DOMRect | null;
  clip: HTMLElement[];
  removed: boolean;
}

export interface CellOptions {
  bodyId?: string;
  itemId?: string;
  setId?: string;
  /** A set's pieces, when a caller has them and no set manifest is published yet. */
  pieces?: Partial<Record<SlotId, string>>;
  /** Particles and ribbons run here too: for the one live cell over a poster. */
  effects?: boolean;
  /** The canvas stands inside `el`, which must be positioned: for the one live cell over a poster. */
  inCell?: boolean;
  /** The first frame this cell drew, in the frame it draws: the poster over it can go now. */
  onDrawn?: () => void;
  /** It will not draw: whatever stands in for it stays. */
  onFailed?: (err: unknown) => void;
}

export interface Capture {
  width: number;
  height: number;
  /** RGBA, premultiplied as the canvas holds it, top row first. */
  pixels: Uint8Array;
  /** An item with nothing to show on this body. */
  nothing: boolean;
}

const UNIT_KEYS = ["uT0", "uT1", "uT2"] as const;
/** How long an effect runs before its first frame, so a flame is already burning. */
const WARM_SECONDS = 2;
const WARM_STEP = 1 / 15;
/** Enough of a model's vertices to know its silhouette, cheaply on the frame it goes live. */
const SILHOUETTE_SAMPLES = 6000;
/** A silhouette is measured this wide: a pixel is under 1% of a cell, well inside its margin. */
const MEASURE_WIDTH = 160;
/** How far past the first guess a measure looks, and how often it steps back further. */
const MEASURE_ROOM = 1.6;
const MEASURE_TRIES = 3;
const FITS_KEPT = 48;
/** The shape every look is measured on: retail's card. Only its reach is kept, so a set's card can share it. */
const CARD_ASPECT = 100 / 132;
const _size = new Vector2();
const _v = new Vector3();

export class FigureCells {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  private readonly env: LoadEnv;
  private readonly composer: CompositeRenderer;
  private readonly cells = new Set<Cell>();
  private readonly bodies = new Map<string, BodySlot>();
  private readonly observer: IntersectionObserver;
  private raf = 0;
  private lastFrame = 0;
  private cursor = 0;
  private budget: number = CELLS.startBudget;
  private scrollX = -1;
  private scrollY = -1;
  private stamp = 0;
  private drawnLast = 0;
  /** Milliseconds of the cell pass, in the same ring the main stage reports. */
  readonly passStats = new FrameStatsRing();
  readonly intervalStats = new FrameStatsRing();
  private readonly passSamples: number[] = [];
  private readonly resizeListener = () => this.fitCanvas();
  /** Off-screen frames of a poster: what they draw never touches the canvas over the page. */
  private readonly targets = new Map<string, WebGLRenderTarget>();
  /** Where the canvas is: lying over the page, inside this one card, or neither. */
  private over = false;
  private host: Cell | null = null;
  /** What asks the GPU for an answer goes one at a time, each after the last has finished. */
  private turn: Promise<unknown> = Promise.resolve();
  /** The page says when to leave the GPU and the main thread alone: a scroll, say. */
  hold: () => boolean = () => false;

  constructor(base: string) {
    const canvas = document.createElement("canvas");
    canvas.dataset.eclipseCells = "";
    // Out of the page until a cell shows: drawing a poster never puts a layer over the grid.
    canvas.style.display = "none";
    canvas.style.pointerEvents = "none";
    document.body.appendChild(canvas);
    this.canvas = canvas;

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.toneMapping = NoToneMapping;
    // A render target always outputs linear, and a program is keyed on that: with the canvas the
    // same, a poster and the live cell run one program. These shaders convert nothing either way.
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(1, 1, false);
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    this.renderer = renderer;
    this.env = { base, renderer, anisotropy: () => 4, priority: "low" };
    this.composer = new CompositeRenderer(renderer);

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const cell = this.cellOf(entry.target);
        if (!cell) continue;
        cell.onScreen = entry.isIntersecting;
        cell.needsDraw = cell.onScreen;
      }
      this.ensureLoop();
    });
    window.addEventListener("resize", this.resizeListener);
  }

  private cellOf(el: Element): Cell | undefined {
    for (const c of this.cells) if (c.el === el) return c;
    return undefined;
  }

  private fitCanvas(): void {
    if (!this.over) return;
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const size = this.renderer.getSize(_size);
    if (size.x !== w || size.y !== h) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.setSize(w, h);
      // The buffer is new and empty: everything visible draws this frame.
      for (const c of this.cells) c.needsDraw = c.onScreen;
    }
  }

  /** The canvas over the page, for cells drawn by scissor. */
  private lieOverPage(): void {
    if (this.over) return;
    if (this.host) this.stepOut();
    this.over = true;
    Object.assign(this.canvas.style, { display: "block", position: "absolute", top: "0", left: "0", zIndex: "5", willChange: "transform", transform: "none" });
    this.scrollX = this.scrollY = -1;
    this.fitCanvas();
  }

  /**
   * The canvas inside its card, at the card's size in device pixels. The buffer is only
   * touched when that size changes; the browser's zoom counts, as it changes the pixels too.
   */
  private standIn(cell: Cell, rect: DOMRect): void {
    const canvas = this.canvas;
    if (this.host !== cell) {
      this.host = cell;
      cell.el.appendChild(canvas);
      Object.assign(canvas.style, { display: "block", position: "absolute", top: "0", left: "0", width: "100%", height: "100%", zIndex: "1", willChange: "auto", transform: "none" });
    }
    const k = Math.min(window.devicePixelRatio, 2);
    const w = Math.max(1, Math.round(rect.width * k));
    const h = Math.max(1, Math.round(rect.height * k));
    const r = this.renderer;
    if (canvas.width !== w || canvas.height !== h) r.setDrawingBufferSize(w, h, 1);
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
  }

  /** Back out of the page, empty: the next card's first frame is the first thing it shows. */
  private stepOut(): void {
    const r = this.renderer;
    r.setScissor(0, 0, this.canvas.width, this.canvas.height);
    r.clear(true, true, false);
    this.host = null;
    this.canvas.style.display = "none";
    document.body.appendChild(this.canvas);
  }

  add(el: HTMLElement, opts: CellOptions): () => void {
    const cell = this.makeCell(el, opts);
    this.cells.add(cell);
    if (!opts.inCell) this.lieOverPage();
    this.observer.observe(el);
    void this.prepareCell(cell).catch((err) => {
      if (isAbort(err) || cell.removed) return;
      console.warn("[eclipse] figure cell failed:", err);
      opts.onFailed?.(err);
    });
    return () => this.remove(cell);
  }

  private makeCell(el: HTMLElement, opts: CellOptions): Cell {
    return {
      el,
      opts,
      camera: new PerspectiveCamera(CAMERA.fov, 1, 0.1, 100),
      body: null,
      visibleGeosets: null,
      composite: null,
      wornTextures: new Map(),
      pieces: [],
      look: null,
      abort: new AbortController(),
      slot: null,
      wanted: [],
      compositeKey: "",
      emitters: [],
      warmed: false,
      drawn: false,
      nothing: false,
      fit: null,
      onScreen: false,
      ready: false,
      needsDraw: false,
      width: 0,
      height: 0,
      rect: null,
      clip: opts.inCell ? [] : clippingAncestors(el),
      removed: false,
    };
  }

  private remove(cell: Cell): void {
    if (cell.removed) return;
    cell.removed = true;
    this.cells.delete(cell);
    this.observer.unobserve(cell.el);
    if (this.host === cell) this.stepOut();
    else if (this.over) this.clearCell(cell);
    this.leave(cell);
    // No figure left to show: nothing lies over the page.
    if (this.over && ![...this.cells].some((c) => c.el.isConnected)) {
      this.over = false;
      this.canvas.style.display = "none";
    }
  }

  /** The cell's claim on what it asked for ends. */
  private leave(cell: Cell): void {
    cell.abort.abort();
    // Still on its way and nobody else wants it: the line is free again.
    const slot = cell.slot;
    if (slot) {
      cell.slot = null;
      if (--slot.waiting === 0 && !slot.body) {
        slot.abort.abort();
        for (const [id, s] of this.bodies) if (s === slot) this.bodies.delete(id);
      }
    }
    const body = cell.body;
    if (body) {
      for (const e of cell.emitters) e.root.visible = false;
      if (--body.uses === 0) body.idleSince = performance.now();
      this.trimAfter(body);
    }
  }

  /** What hovering a thousand things leaves behind is bounded: items, composites, whole bodies. */
  private trimAfter(body: SharedBody): void {
    const inUse = new Set<string>();
    const composites = new Set<string>();
    for (const c of this.cells) {
      if (c.body !== body) continue;
      for (const id of c.wanted) inUse.add(id);
      if (c.compositeKey) composites.add(c.compositeKey);
    }
    body.library.cancelUnwanted(inUse);
    void body.library.trim(inUse, disposeItem);
    for (const [key, target] of body.composites) {
      if (body.composites.size <= CELLS.keepComposites) break;
      if (composites.has(key)) continue;
      target.dispose();
      body.composites.delete(key);
    }
    const idle = [...this.bodies].filter(([, s]) => s.body && s.body.uses === 0 && s.waiting === 0);
    idle.sort((a, b) => a[1].body!.idleSince - b[1].body!.idleSince);
    for (const [id, s] of idle.slice(0, Math.max(0, idle.length - CELLS.keepBodies))) {
      this.bodies.delete(id);
      disposeBody(s.body!);
    }
  }

  private bodyFor(id: string): BodySlot {
    let slot = this.bodies.get(id);
    if (!slot) {
      const abort = new AbortController();
      const made: BodySlot = { promise: this.loadBody(id, abort.signal), abort, waiting: 0, body: null };
      slot = made;
      this.bodies.set(id, made);
      made.promise.then(
        (b) => {
          made.body = b;
        },
        () => {
          if (this.bodies.get(id) === made) this.bodies.delete(id);
        },
      );
    }
    return slot;
  }

  private async loadBody(id: string, signal: AbortSignal): Promise<SharedBody> {
    if (!id) throw new Error("a figure cell needs a bodyId, or a weapon item");
    const assets = await ModelAssets.load(id, this.env, { signal });
    const figure = new Figure(assets);
    const scene = new Scene();
    scene.matrixWorldAutoUpdate = false;
    scene.add(figure.root);

    const shared: SharedBody = {
      figure,
      scene,
      library: new ItemLibrary(this.env, figure, CELLS.keepItems),
      composites: new Map(),
      base: null,
      stamp: 0,
      updatedAt: -1,
      matricesAt: -1,
      uses: 0,
      action: null,
      fxMs: 0,
      rest: new Float32Array(0),
      posed: new Float32Array(0),
      minY: 0,
      height: 0,
      idleSince: 0,
      fits: new Map(),
    };

    const c = assets.manifest.composite;
    if (c) {
      const w = Math.max(1, c.width >> (CELLS.compositeDivisor - 1));
      const h = Math.max(1, c.height >> (CELLS.compositeDivisor - 1));
      const k = w / c.width;
      const layers = assets.layers.flatMap(({ layer, texture }) =>
        texture && layer.targetType === 1 ? [{ rect: scaled(layer.rect, k), blend: layer.blend, texture }] : [],
      );
      if (assets.manifest.boneSet) figure.setBoneSet(assets.manifest.boneSet);
      figure.baseComposite = this.composer.render(w, h, layers, 2);
      shared.base = figure.baseComposite.texture;
      figure.setComposite(shared.base);
    }

    const clipId = assets.defaultClip;
    const clip = clipId ? assets.clips.cached(clipId) : undefined;
    if (clip) {
      shared.action = figure.mixer.clipAction(clip).play();
      figure.mixer.update(0);
    }
    figure.poseNow();
    sampleFigure(shared);
    gateSkeleton(figure.skeleton, shared);

    for (const t of figure.allTextures()) this.renderer.initTexture(t);
    await this.compile(figure.root, new PerspectiveCamera(), scene);
    return shared;
  }

  private async prepareCell(cell: Cell): Promise<void> {
    const { itemId, setId, pieces } = cell.opts;
    const worn = new Map<SlotId, string>();
    const bodyId = cell.opts.bodyId;
    let alone: { manifest: string; attachment: number; slot: SlotId } | null = null;
    let focusSlot: SlotId | null = null;
    const signal = cell.abort.signal;

    if (pieces) {
      for (const [slot, id] of Object.entries(pieces)) if (id) worn.set(slot as SlotId, id);
    } else if (setId) {
      const set = await fetchJson<SetManifest>(packUrl(this.env.base, paths.set(setId)), { signal });
      for (const [slot, id] of Object.entries(set.pieces)) worn.set(slot as SlotId, id);
    } else if (itemId) {
      const item = await fetchJson<ItemManifest>(packUrl(this.env.base, paths.item(itemId)), { signal });
      registerManifests(item.models);
      focusSlot = item.slot;
      const first = item.attached?.[0];
      if (WEAPON_SLOTS.includes(item.slot) && first) {
        // A weapon stands alone in its cell.
        alone = { manifest: first.manifest, attachment: first.attachment, slot: item.slot };
      } else {
        worn.set(item.slot, itemId);
      }
    }
    if (cell.removed) return;

    const slot = this.bodyFor(alone?.manifest ?? bodyId ?? "");
    slot.waiting++;
    cell.slot = slot;
    const body = await slot.promise;
    if (cell.removed) {
      this.trimAfter(body);
      return;
    }
    slot.waiting--;
    cell.slot = null;
    // The first cell back on a body starts it again: what it shows now is the poster's frame.
    if (body.uses === 0 && body.action) {
      body.action.time = 0;
      body.figure.mixer.update(0);
      body.figure.poseNow();
      body.fxMs = 0;
    }
    body.uses++;
    cell.body = body;
    cell.wanted = [...worn.values()];

    const resolved = new Map<SlotId, ResolvedItem>();
    await Promise.all(
      [...worn].map(async ([slot, id]) => {
        resolved.set(slot, await body.library.resolve(id));
      }),
    );
    if (cell.removed) return;

    const plan = planOutfit(body.figure, resolved);
    cell.nothing = worn.size > 0 && plan.pieces.length === 0 && !plan.compositeKey && plan.wornTextures.size === 0;
    for (const part of body.figure.parts) {
      if (plan.visible.has(part.extras.geoset)) for (const w of part.waiting) body.figure.assets.requestTexture(w.tex);
    }
    for (const piece of plan.pieces) {
      if (piece.node.parent !== piece.parent) {
        piece.node.visible = false;
        piece.parent?.add(piece.node);
        body.scene.updateMatrixWorld(true);
        for (const t of piece.figure.allTextures()) this.renderer.initTexture(t);
        await this.compile(piece.node, cell.camera, body.scene);
      }
    }
    if (cell.removed) return;
    cell.pieces = plan.pieces;
    cell.visibleGeosets = plan.visible;
    cell.composite = this.compositeFor(body, plan);
    cell.compositeKey = plan.compositeKey;
    cell.wornTextures = plan.wornTextures;
    for (const t of plan.wornTextures.values()) this.renderer.initTexture(t);

    const manifest = body.figure.assets.manifest;
    if (alone) {
      const b = manifest.bounds;
      cell.look = { kind: "alone", view: weaponView(alone.slot, alone.attachment, [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]) };
    } else if (manifest.kind === "mount") {
      cell.look = { kind: "alone", view: "creature" };
    } else {
      cell.look = { kind: "window", window: cellWindow(focusSlot, body.figure.id.endsWith("-female")) };
    }
    if (cell.opts.effects) await this.prepareEffects(cell, plan.pieces);
    if (cell.removed) return;
    await this.measureLook(cell);
    if (cell.removed) return;
    cell.ready = true;
    cell.needsDraw = cell.onScreen;
    this.ensureLoop();
  }

  private async compile(node: Parameters<WebGLRenderer["compileAsync"]>[0], camera: PerspectiveCamera, scene: Scene): Promise<void> {
    await linkInBackground(
      this.renderer,
      () => this.renderer.compileAsync(node, camera, scene),
      (work) => this.inTurn(work),
    );
    keepPrograms(this.renderer, node, camera, scene);
  }

  /**
   * A synchronous answer from the GPU process waits behind everything already sent to it, so
   * a read that comes after another poster's draw stops the page for that whole draw: 200 ms,
   * measured. In turns there is nothing ahead of it. A turn waits for the page to have a
   * moment, and gives way to whatever input and frames are waiting first.
   */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = this.turn.then(async () => {
      await nextTask();
      while (this.hold()) await new Promise((r) => setTimeout(r, 40));
      return work();
    });
    this.turn = run.catch(() => undefined);
    return run;
  }

  /**
   * Where the look's real pixels reach. Vertices can't say: a flame is a quad mostly
   * transparent, a wing is blended, a tail hangs on a bone the sampled pose leaves out. So it
   * draws once, small and unseen, at the frame a poster shows, and reads what came out.
   * Effects stay out: they run on their own dice, and a poster and its live cell have to
   * get the same answer.
   */
  private async measureLook(cell: Cell): Promise<void> {
    const body = cell.body;
    const look = cell.look;
    if (!body || !look) return;
    // A slot's window crops the figure on purpose: that is what it is looking at.
    if (look.kind === "window" && look.window !== WHOLE_FIGURE) return;
    const key = `${look.kind === "alone" ? look.view : "whole"}|${cell.wanted.join()}`;
    let fit = body.fits.get(key);
    if (!fit) {
      await waitForTextures([body.figure, ...cell.pieces.map((p) => p.figure)], cell.visibleGeosets);
      if (cell.removed) return;
      const seen = await this.measureSilhouette(cell, body);
      if (cell.removed || !seen) return;
      if (body.fits.size >= FITS_KEPT) body.fits.clear();
      body.fits.set(key, seen);
      fit = seen;
    }
    cell.fit = fit;
  }

  private async measureSilhouette(cell: Cell, body: SharedBody): Promise<Silhouette | null> {
    const look = cell.look!;
    const basis = look.kind === "alone" ? basisOfRows(VIEW_ROWS[look.view]) : basisOfAngles(look.window.azimuth);
    const aspect = CARD_ASPECT;
    const e = look.kind === "alone" ? creatureExtents(body.rest, body.posed, basis) : windowExtents(look.window, body.minY, body.height, bandMiddle(body, basis, look.window), aspect, basis);
    if (!validExtents(e)) return null;
    const w = MEASURE_WIDTH;
    const h = Math.round(w / aspect);
    const target = this.measureTarget(w, h);
    const camera = new PerspectiveCamera(CAMERA.fov, aspect, 0.1, 100);
    const pixels = new Uint8Array(w * h * 4);
    const b = body.figure.assets.manifest.bounds;
    const reach = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) + Math.max(e[3] - e[0], e[4] - e[1], e[5] - e[2]);
    let centre: [number, number] = [(e[0] + e[3]) / 2, (e[1] + e[4]) / 2];
    let half = Math.max((e[4] - e[1]) / 2, (e[3] - e[0]) / 2 / aspect);
    let room = MEASURE_ROOM;
    _axisX.set(...basis.right);
    _axisY.set(...basis.up);
    _axisZ.set(...basis.back);
    camera.quaternion.setFromRotationMatrix(_m.makeBasis(_axisX, _axisY, _axisZ));
    for (let tries = 0; tries < MEASURE_TRIES; tries++) {
      // Far enough for everything to be in front of it, and what it sees at that distance.
      const tan = Math.tan((CAMERA.fov * Math.PI) / 360);
      const distance = (half * room) / tan + reach;
      const halfH = tan * distance;
      const halfW = halfH * aspect;
      camera.position
        .copy(_axisX)
        .multiplyScalar(centre[0])
        .addScaledVector(_axisY, centre[1])
        .addScaledVector(_axisZ, (e[2] + e[5]) / 2 + distance);
      camera.near = Math.max(0.05, distance - reach * 2);
      camera.far = distance + reach * 2;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      await this.inTurn(async () => {
        if (cell.removed) return;
        this.atFirstFrame(body, () => {
          const r = this.renderer;
          r.setRenderTarget(target);
          r.clear(true, true, false);
          this.drawContents(cell, body, camera, false);
          r.setRenderTarget(null);
        });
        await this.readBack(target, w, h, pixels);
      });
      if (cell.removed) return null;
      // Bottom row first, as the buffer holds it, and `up` runs the same way.
      const box = silhouetteBounds(pixels, w, h);
      if (!box) return null;
      const seen: Silhouette = {
        right: [centre[0] + (box.x0 / w - 0.5) * 2 * halfW, centre[0] + ((box.x1 + 1) / w - 0.5) * 2 * halfW],
        up: [centre[1] + (box.y0 / h - 0.5) * 2 * halfH, centre[1] + ((box.y1 + 1) / h - 0.5) * 2 * halfH],
      };
      // It touches the edge of what it looked at: there is more past it, so it looks again.
      const more = box.x0 === 0 || box.y0 === 0 || box.x1 === w - 1 || box.y1 === h - 1;
      if (!more || tries === MEASURE_TRIES - 1) return seen;
      centre = [(seen.right[0] + seen.right[1]) / 2, (seen.up[0] + seen.up[1]) / 2];
      half = Math.max((seen.up[1] - seen.up[0]) / 2, (seen.right[1] - seen.right[0]) / 2 / aspect);
      room *= 2;
    }
    return null;
  }

  private measureTarget(w: number, h: number): WebGLRenderTarget {
    const key = `measure ${w}x${h}`;
    let target = this.targets.get(key);
    if (!target) {
      target = new WebGLRenderTarget(w, h, { depthBuffer: true });
      this.targets.set(key, target);
    }
    return target;
  }

  /** Runs `draw` with the body at its clip's first frame, whatever a live cell on it is showing. */
  private atFirstFrame(body: SharedBody, draw: () => void): void {
    const resume = body.action?.time ?? 0;
    if (body.action) body.action.time = 0;
    body.figure.mixer.update(0);
    body.stamp = ++this.stamp;
    body.figure.poseNow();
    body.scene.updateMatrixWorld(true);
    draw();
    if (body.action) body.action.time = resume;
  }

  /** A figure's emitters, off stage with their programs linked, hidden until this cell draws. */
  private async prepareEffects(cell: Cell, pieces: readonly Piece[]): Promise<void> {
    const body = cell.body!;
    for (const figure of [body.figure, ...pieces.map((p) => p.figure)]) {
      if (!figure.emitters) {
        const made = FigureEmitters.create(figure);
        if (!made) continue;
        figure.emitters = made;
        made.ownClock = figure !== body.figure;
        body.scene.add(made.root);
        for (const list of [figure.assets.fx?.particles, figure.assets.fx?.ribbons] as ({ tex: number[] }[] | undefined)[]) {
          for (const e of list ?? []) for (const t of e.tex) figure.assets.requestTexture(t);
        }
        for (const t of made.textures()) this.renderer.initTexture(t);
        body.scene.updateMatrixWorld(true);
        await this.compile(made.root, cell.camera, body.scene);
        made.root.visible = false;
        if (cell.removed) return;
      }
      cell.emitters.push(figure.emitters);
    }
  }

  private compositeFor(body: SharedBody, plan: ReturnType<typeof planOutfit>): Texture | null {
    if (!plan.compositeKey) return body.base;
    let target = body.composites.get(plan.compositeKey);
    if (target) {
      // Most recently used goes last.
      body.composites.delete(plan.compositeKey);
      body.composites.set(plan.compositeKey, target);
    } else {
      const c = body.figure.assets.manifest.composite!;
      const w = Math.max(1, c.width >> (CELLS.compositeDivisor - 1));
      const h = Math.max(1, c.height >> (CELLS.compositeDivisor - 1));
      const k = w / c.width;
      target = this.composer.render(
        w,
        h,
        plan.layers.map((l) => ({ ...l, rect: scaled(l.rect, k) })),
        2,
      );
      target.texture.minFilter = LinearFilter;
      body.composites.set(plan.compositeKey, target);
    }
    return target.texture;
  }

  // --- The frame ----------------------------------------------------------

  private ensureLoop(): void {
    if (this.raf) return;
    let any = false;
    for (const c of this.cells) if (c.onScreen && c.ready) any = true;
    if (!any) return;
    this.lastFrame = 0;
    this.intervalStats.gap();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (): void => {
    this.raf = 0;
    const started = performance.now();
    const dt = this.lastFrame > 0 ? (started - this.lastFrame) / 1000 : 0;
    this.lastFrame = started;
    this.stamp++;

    const shown: Cell[] = [];
    for (const c of this.cells) if (c.onScreen && c.ready) shown.push(c);
    if (shown.length === 0) {
      // The last of them scrolled away: what it drew doesn't stay on the page behind it.
      if (this.over) {
        this.renderer.setScissor(0, 0, this.renderer.getSize(_size).x, _size.y);
        this.renderer.clear(true, true, false);
      }
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
    this.intervalStats.sample(started);

    // One cell that asked to stand in its card, with nothing lying over the page.
    const lone = shown.length === 1 && shown[0]!.opts.inCell && !this.over ? shown[0]! : null;

    // The canvas rides with the page: native scrolling keeps old pixels on their
    // cells between frames, and here it comes back to the viewport with fresh ones.
    let moved = false;
    if (!lone) {
      this.lieOverPage();
      const sx = window.scrollX;
      const sy = window.scrollY;
      moved = sx !== this.scrollX || sy !== this.scrollY;
      if (moved) {
        this.scrollX = sx;
        this.scrollY = sy;
        this.canvas.style.transform = `translate(${sx}px, ${sy}px)`;
      }
      this.fitCanvas();
    }

    // One pose per body and per piece, per frame.
    for (const c of shown) {
      const body = c.body!;
      if (body.updatedAt !== this.stamp) {
        body.updatedAt = this.stamp;
        body.stamp = this.stamp;
        body.figure.mixer.update(dt);
        body.fxMs += dt * 1000;
        if (body.figure.fx.animated) body.figure.fx.update(clipMsOf(body), body.fxMs);
      }
      for (const piece of c.pieces) {
        if (piece.figure.poseStamp !== this.stamp) {
          piece.figure.poseStamp = this.stamp;
          piece.figure.mixer.update(dt);
          if (piece.figure.fx.animated) piece.figure.fx.update(clipMsOf(body), body.fxMs);
        }
      }
    }
    for (const c of shown) {
      const body = c.body!;
      if (body.matricesAt !== this.stamp) {
        body.matricesAt = this.stamp;
        body.scene.updateMatrixWorld(true);
      }
    }

    for (const c of shown) {
      const rect = c.el.getBoundingClientRect();
      // A scroller inside the page moved it: what it left behind has to go.
      if (c.rect && (rect.left !== c.rect.left || rect.top !== c.rect.top)) moved = true;
      c.rect = rect;
      if (rect.width !== c.width || rect.height !== c.height) {
        c.width = rect.width;
        c.height = rect.height;
        frameCell(c, rect.width, rect.height);
        moved = true;
      }
      if (c.emitters.length) {
        if (!c.warmed) warmEffects(c);
        else runEffects(c, dt);
      }
    }
    if (moved && !lone) {
      this.renderer.setScissor(0, 0, this.renderer.getSize(_size).x, _size.y);
      this.renderer.clear(true, true, false);
    }

    let drawn = 0;
    if (lone) {
      this.standIn(lone, lone.rect!);
      this.renderer.clear(true, true, false);
      this.drawContents(lone, lone.body!);
      lone.needsDraw = false;
      drawn = 1;
      if (!lone.drawn) {
        lone.drawn = true;
        lone.opts.onDrawn?.();
      }
    } else if (moved || shown.length <= CELLS.everyFrameUpTo) {
      for (const c of shown) {
        this.drawCell(c, c.rect!);
        drawn++;
      }
    } else {
      for (const c of shown) {
        if (c.needsDraw) {
          this.drawCell(c, c.rect!);
          drawn++;
        }
      }
      for (let i = 0; i < shown.length && drawn < this.budget; i++) {
        this.cursor = (this.cursor + 1) % shown.length;
        const c = shown[this.cursor]!;
        this.drawCell(c, c.rect!);
        drawn++;
      }
    }
    this.drawnLast = drawn;

    const ms = performance.now() - started;
    this.passSamples.push(ms);
    if (this.passSamples.length > 3600) this.passSamples.shift();
    if (!moved) {
      if (ms > CELLS.frameMs) this.budget = Math.max(CELLS.minBudget, this.budget - 1);
      else if (ms < CELLS.frameMs / 2) this.budget = Math.min(CELLS.maxBudget, this.budget + 1);
    }
  };

  private drawCell(cell: Cell, rect: DOMRect): void {
    const r = this.renderer;
    const body = cell.body!;
    const h = r.getSize(_size).y;
    const x = rect.left;
    const y = h - rect.bottom;
    const clipped = clipRect(rect, cell.clip, h);
    cell.needsDraw = false;
    if (!clipped) return;

    r.setViewport(x, y, rect.width, rect.height);
    r.setScissor(clipped.x, clipped.y, clipped.w, clipped.h);
    r.clear(true, true, false);
    this.drawContents(cell, body);
    if (!cell.drawn) {
      cell.drawn = true;
      cell.opts.onDrawn?.();
    }
  }

  private drawContents(cell: Cell, body: SharedBody, camera: PerspectiveCamera = cell.camera, effects = true): void {
    const figure = body.figure;
    for (const part of figure.parts) {
      let painted = true;
      for (const w of part.worn) {
        const texture = cell.wornTextures.get(w.type) ?? figure.lookTexture(w.type);
        part.material.uniforms[UNIT_KEYS[w.unit]!].value = texture ?? whiteTexture();
        // A slot nothing paints isn't drawn: on the stage too (Figure.blank).
        if (!texture) painted = false;
      }
      part.mesh.visible = painted && part.ready && (cell.visibleGeosets?.has(part.extras.geoset) ?? part.shown);
      if (part.usesComposite.length) {
        part.usesComposite.forEach((used, i) => {
          if (used) part.material.uniforms[UNIT_KEYS[i]!].value = cell.composite;
        });
      }
    }
    for (const piece of cell.pieces) piece.node.visible = true;
    if (effects) for (const e of cell.emitters) e.root.visible = true;
    this.renderer.render(body.scene, camera);
    for (const piece of cell.pieces) piece.node.visible = false;
    for (const e of cell.emitters) e.root.visible = false;
  }

  /** On screen or not: it may have scrolled away with its last frame still on the canvas. */
  private clearCell(cell: Cell): void {
    const h = this.renderer.getSize(_size).y;
    // Where it last drew and where it stands now: a scroller may have moved it since.
    for (const rect of cell.rect ? [cell.rect, cell.el.getBoundingClientRect()] : [cell.el.getBoundingClientRect()]) {
      this.renderer.setScissor(Math.floor(rect.left) - 1, Math.floor(h - rect.bottom) - 1, Math.ceil(rect.width) + 2, Math.ceil(rect.height) + 2);
      this.renderer.clear(true, true, false);
    }
  }

  // --- A poster -----------------------------------------------------------

  /**
   * One frame of a cell, read back: what the baker makes a poster of. Rendered at
   * `supersample` times the size, for the baker to bring down, into a frame of its own, so
   * a page can do this under a live canvas. Its effects run first, so a flame is already
   * burning, and everything the look needs is in before it draws.
   */
  async capture(opts: CellOptions, width: number, height: number, supersample = 2): Promise<Capture> {
    const cell = this.makeCell(document.createElement("div"), { ...opts, effects: opts.effects ?? true });
    // One of the cells, never on screen: what it is fetching counts as wanted by whoever trims.
    this.cells.add(cell);
    try {
      await this.prepareCell(cell);
      const body = cell.body;
      if (!body || cell.removed) throw new DOMException("gone", "AbortError");
      await waitForTextures([body.figure, ...cell.pieces.map((p) => p.figure)], cell.visibleGeosets);
      const w = width * supersample;
      const h = height * supersample;
      const r = this.renderer;
      const target = this.targetOf(w, h);
      const raw = new Uint8Array(w * h * 4);
      await this.inTurn(async () => {
        // The first frame of the clip, whatever a live cell on this body is showing now.
        this.atFirstFrame(body, () => {
          cell.width = width;
          cell.height = height;
          frameCell(cell, width, height);
          if (cell.emitters.length) warmEffects(cell);
          r.setRenderTarget(target);
          r.clear(true, true, false);
          this.drawContents(cell, body);
          r.setRenderTarget(null);
        });
        // The GPU finishes in its own time and the page goes on: a sync read here stops it for 65 ms.
        await this.readBack(target, w, h, raw);
      });
      const pixels = new Uint8Array(raw.length);
      for (let y = 0; y < h; y++) pixels.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      return { width: w, height: h, pixels, nothing: cell.nothing };
    } finally {
      cell.removed = true;
      this.cells.delete(cell);
      this.leave(cell);
    }
  }

  /** three leaves its pack buffer bound while it waits, and any other read in that time would fail. */
  private readBack(target: WebGLRenderTarget, w: number, h: number, into: Uint8Array): Promise<unknown> {
    const done = this.renderer.readRenderTargetPixelsAsync(target, 0, 0, w, h, into);
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return done;
  }

  private targetOf(w: number, h: number): WebGLRenderTarget {
    const key = `${w}x${h}`;
    let target = this.targets.get(key);
    if (!target) {
      target = new WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true });
      this.targets.set(key, target);
    }
    return target;
  }

  /** The same picture as a baked poster, for a card the bake hasn't reached. */
  async posterUrl(opts: CellOptions, width: number, height: number): Promise<string | null> {
    const cap = await this.capture(opts, width, height, 2);
    if (cap.nothing) return null;
    return URL.createObjectURL(await this.encode(cap));
  }

  private encoder: Worker | null = null;
  private encoding = new Map<number, { resolve(b: Blob): void; reject(e: unknown): void }>();
  private encodeId = 0;

  /** On a worker of its own. Where there is none to be had, here: the picture matters more. */
  private async encode(cap: Capture): Promise<Blob> {
    try {
      this.encoder ??= this.startEncoder();
      const id = ++this.encodeId;
      const done = new Promise<Blob>((resolve, reject) => this.encoding.set(id, { resolve, reject }));
      this.encoder.postMessage({ id, pixels: cap.pixels, width: cap.width, height: cap.height }, [cap.pixels.buffer]);
      return await done;
    } catch (err) {
      if (cap.pixels.byteLength === 0) throw err;
      const { rgba } = toStraightAlpha(cap.pixels, cap.width, cap.height);
      const canvas = new OffscreenCanvas(cap.width, cap.height);
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), cap.width, cap.height), 0, 0);
      return canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
    }
  }

  private startEncoder(): Worker {
    const worker = new Worker(new URL("./posterEncode.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const job = this.encoding.get(e.data.id);
      this.encoding.delete(e.data.id);
      if (e.data.blob) job?.resolve(e.data.blob);
      else job?.reject(new Error(e.data.error ?? "no poster"));
    };
    worker.onerror = (e) => {
      for (const job of this.encoding.values()) job.reject(new Error(e.message));
      this.encoding.clear();
    };
    return worker;
  }

  // --- Numbers ------------------------------------------------------------

  numbers(): {
    cells: number;
    visible: number;
    drawnLastFrame: number;
    budget: number;
    passP50Ms: number;
    passP99Ms: number;
    geometries: number;
    textures: number;
    programs: number;
    bodies: number;
    cellFps: number;
    looping: boolean;
  } {
    const sorted = [...this.passSamples].sort((a, b) => a - b);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
    let visible = 0;
    for (const c of this.cells) if (c.onScreen && c.ready) visible++;
    const info = this.renderer.info;
    const interval = this.intervalStats.read();
    return {
      cells: this.cells.size,
      visible,
      drawnLastFrame: this.drawnLast,
      budget: this.budget,
      passP50Ms: at(50),
      passP99Ms: at(99),
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      bodies: this.bodies.size,
      cellFps: interval?.fps ?? 0,
      looping: this.raf !== 0,
    };
  }

  resetNumbers(): void {
    this.passSamples.length = 0;
    this.intervalStats.reset();
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("resize", this.resizeListener);
    this.observer.disconnect();
    this.cells.clear();
    for (const slot of this.bodies.values()) {
      slot.abort.abort();
      void slot.promise.then(disposeBody, () => undefined);
    }
    this.bodies.clear();
    for (const t of this.targets.values()) t.dispose();
    this.targets.clear();
    this.encoder?.terminate();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

function disposeBody(b: SharedBody): void {
  b.library.disposeAll();
  for (const rt of b.composites.values()) rt.dispose();
  b.composites.clear();
  b.figure.dispose();
}

function scaled(rect: { x: number; y: number; w: number; h: number }, k: number) {
  return { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k };
}

function clipMsOf(b: SharedBody): number {
  return (b.action?.time ?? 0) * 1000;
}

/**
 * The default look's silhouette, measured once at the clip's first frame. Hidden geosets
 * hang on bones nothing animates and are not part of it; a manifest's bounds are, and
 * they hold the bind pose's arms besides, so they frame the wrong thing.
 */
function sampleFigure(b: SharedBody): void {
  // A glow is not the model's shape: a storm orb far above a gryphon would shrink the gryphon.
  const shown = b.figure.parts.filter((p) => p.shown);
  const solid = shown.filter((p) => !p.material.state.blended);
  const parts = solid.length ? solid : shown;
  // A model's parts share one vertex buffer: only what a part's own triangles use is that part.
  const countOf = (p: (typeof parts)[number]) => p.mesh.geometry.index?.count ?? p.mesh.geometry.getAttribute("position")?.count ?? 0;
  let total = 0;
  for (const p of parts) total += countOf(p);
  const stride = Math.max(1, Math.ceil(total / SILHOUETTE_SAMPLES));
  const rest: number[] = [];
  const posed: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of parts) {
    const mesh = p.mesh as SkinnedMesh;
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;
    const index = mesh.geometry.index;
    const count = countOf(p);
    for (let k = 0; k < count; k += stride) {
      const i = index ? index.getX(k) : k;
      _v.fromBufferAttribute(position as never, i).applyMatrix4(mesh.matrixWorld);
      rest.push(_v.x, _v.y, _v.z);
      mesh.getVertexPosition(i, _v).applyMatrix4(mesh.matrixWorld);
      posed.push(_v.x, _v.y, _v.z);
      if (_v.y < lo) lo = _v.y;
      if (_v.y > hi) hi = _v.y;
    }
  }
  b.rest = Float32Array.from(rest);
  b.posed = Float32Array.from(posed);
  b.minY = Number.isFinite(lo) ? lo : 0;
  b.height = Number.isFinite(lo) ? hi - lo : 0;
}

/** Everything the frame needs is on the GPU: a poster never shows a part still on its way. */
async function waitForTextures(figures: readonly Figure[], visible: ReadonlySet<number> | null, timeoutMs = 20_000): Promise<void> {
  const until = performance.now() + timeoutMs;
  for (;;) {
    let pending = false;
    for (const f of figures) {
      for (const part of f.parts) {
        const shows = f === figures[0] ? (visible?.has(part.extras.geoset) ?? part.shown) : part.shown;
        if (shows && part.waiting.length) pending = true;
      }
      if (f.emitters && !effectTexturesIn(f)) pending = true;
    }
    if (!pending || performance.now() > until) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** A flame with no texture yet would simply not be in the picture. */
function effectTexturesIn(f: Figure): boolean {
  const { fx, manifest, textures } = f.assets;
  const emitters = [...(fx?.particles ?? []), ...(fx?.ribbons ?? [])] as { tex: number[] }[];
  return emitters.every((e) => e.tex.every((t) => !manifest.textures[t]?.key || textures[t]));
}

function setEffectClock(body: SharedBody, dt: number): void {
  FX_CLOCK[0] = clipMsOf(body);
  FX_CLOCK[1] = body.fxMs;
  FX_CLOCK[2] = dt;
}

function runEffects(cell: Cell, dt: number): void {
  setEffectClock(cell.body!, dt);
  for (const e of cell.emitters) e.update(cell.camera);
}

/** A few big steps with the figure at its first frame: the same picture as the poster, burning. */
function warmEffects(cell: Cell): void {
  cell.warmed = true;
  const body = cell.body!;
  const steps = Math.round(WARM_SECONDS / WARM_STEP);
  setEffectClock(body, WARM_STEP);
  for (let i = 0; i < steps; i++) {
    FX_CLOCK[1] = body.fxMs + i * WARM_STEP * 1000;
    for (const e of cell.emitters) e.update(cell.camera);
  }
}

/** The skeleton uploads its bone texture once per frame, not once per cell. */
function gateSkeleton(skeleton: Skeleton | null, body: SharedBody): void {
  if (!skeleton) return;
  const update = skeleton.update.bind(skeleton);
  let last = -1;
  skeleton.update = () => {
    if (body.stamp === last) return;
    last = body.stamp;
    update();
  };
}

const _m = new Matrix4();
const _axisX = new Vector3();
const _axisY = new Vector3();
const _axisZ = new Vector3();

function frameCell(cell: Cell, width: number, height: number): void {
  const body = cell.body;
  const look = cell.look;
  if (!body || !look || height <= 0 || body.height <= 0) return;
  const camera = cell.camera;
  camera.aspect = width / height;
  let basis: Basis;
  let extents: Extents;
  let fill = 1;
  const fit = cell.fit;
  if (look.kind === "alone") {
    basis = basisOfRows(VIEW_ROWS[look.view]);
    extents = creatureExtents(body.rest, body.posed, basis);
    fill = CELL_FILL;
    if (fit) extents = [fit.right[0], fit.up[0], extents[2], fit.right[1], fit.up[1], extents[5]];
  } else {
    basis = basisOfAngles(look.window.azimuth);
    extents = windowExtents(look.window, body.minY, body.height, bandMiddle(body, basis, look.window), camera.aspect, basis);
    // A whole figure keeps the size every figure has, unless something it wears reaches past it.
    if (fit) {
      const inset = ((extents[3] - extents[0]) * (1 - CELL_FILL)) / 2;
      const inside = fit.right[0] >= extents[0] + inset && fit.right[1] <= extents[3] - inset && fit.up[0] >= extents[1] && fit.up[1] <= extents[4];
      if (!inside) {
        extents = [fit.right[0], fit.up[0], extents[2], fit.right[1], fit.up[1], extents[5]];
        fill = CELL_FILL;
      }
    }
  }
  if (!validExtents(extents)) return;
  const at = fitExtents(extents, basis, camera.aspect, CAMERA.fov, fill);
  const reach = Math.max(extents[3] - extents[0], extents[4] - extents[1], extents[5] - extents[2]);
  // The view is set outright, not aimed: a pose's rows are a rotation already.
  _axisX.set(...basis.right);
  _axisY.set(...basis.up);
  _axisZ.set(...basis.back);
  _m.makeBasis(_axisX, _axisY, _axisZ);
  camera.quaternion.setFromRotationMatrix(_m);
  camera.position.set(...at.position);
  camera.near = Math.max(0.05, at.distance - reach * 2);
  camera.far = at.distance + reach * 3;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** The middle of what stands in a window's band, across the view: a head, not a T-pose's arms. */
function bandMiddle(body: SharedBody, basis: Basis, w: CellWindow): number {
  const cy = body.minY + body.height * w.centre;
  const half = (body.height * w.height) / 2;
  const e = emptyExtents();
  const p = body.posed;
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i + 1]!;
    if (y >= cy - half && y <= cy + half) addToExtents(e, basis, p[i]!, y, p[i + 2]!);
  }
  return validExtents(e) ? (e[0] + e[3]) / 2 : 0;
}

/** Scroll containers a cell can be clipped by. */
function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") out.push(p);
  }
  return out;
}

function clipRect(rect: DOMRect, clip: readonly HTMLElement[], canvasH: number): { x: number; y: number; w: number; h: number } | null {
  let left = Math.max(rect.left, 0);
  let top = Math.max(rect.top, 0);
  let right = Math.min(rect.right, window.innerWidth);
  let bottom = Math.min(rect.bottom, canvasH);
  for (const el of clip) {
    const r = el.getBoundingClientRect();
    left = Math.max(left, r.left);
    top = Math.max(top, r.top);
    right = Math.min(right, r.right);
    bottom = Math.min(bottom, r.bottom);
  }
  if (right <= left || bottom <= top) return null;
  return { x: left, y: canvasH - bottom, w: right - left, h: bottom - top };
}
