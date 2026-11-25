/**
 * What the site may call. The shape follows Khada's window API (docs/re/khada-re.md)
 * so the panels and shortcuts map one to one; loadModel takes a model id, and
 * clips are streamed, so playing one is async.
 */
export interface EngineOptions {
  /** Pack base URL, no trailing slash. */
  packBase: string;
  /** True on the viewer page: full controls, shortcuts. False for a hero preview. */
  interactable?: boolean;
  /** Preview: default clip only, nothing else fetched. */
  lite?: boolean;
  animated?: boolean;
  cameraStyle?: "default" | "mobile";
  shadow?: boolean;
  shortcuts?: boolean;
  lockCamera?: boolean;
}

export interface ViewerEngine {
  /** Creates the renderer and starts nothing until a model loads. */
  mount(canvas: HTMLCanvasElement): Promise<void>;
  /** Newest call wins: an in-flight load is aborted, the old model stays on screen until the new one is ready. */
  loadModel(modelId: string, lookText?: string): Promise<void>;
  dispose(): void;

  // Animation
  playNextAnimation(): Promise<void>;
  playPreviousAnimation(): Promise<void>;
  playAnimationByName(clipIdOrTPose: string): Promise<void>;
  playPlaylist(clipIds: string[]): Promise<void>;
  updatePlaylist(clipIds: string[]): void;
  stopPlaylistChain(): void;
  jumpChainTo(oneBasedIndex: number): void;
  togglePauseAnimation(): void;
  pauseAnimation(): void;
  playAnimation(): void;
  isAnimationPaused(): boolean;
  goToNextTimeScale(): void;
  setAnimationTime(seconds: number): void;
  setAnimationTimePercent(percent: number): void;
  getAnimationDuration(): number;
  getCurrentAnimationTime(): number;

  // View
  fullscreen(): void;
  toggleWatermark(): void;
  mirrorModel(): void;
  setBackgroundColor(css: string | null): void;
  centerModel(transition?: boolean): void;
  toggleShadows(): void;
  /** Particles and ribbons on or off. */
  setEffects(on: boolean): void;
  /** `.phys` simulation on or off. */
  setPhysics(on: boolean): void;
  toggleSkeleton(): void;
  toggleAllWireframes(): void;
  setAutoRotationSpeed(radiansPerSecond: number): void;
  showAllParts(): void;
  hideAllParts(): void;

  // Parts
  toggleMaterialByHash(hash: number): void;
  toggleWireframeByHash(hash: number): void;
  toggleTransparencyByHash(hash: number): void;
  toggleDepthWriteByHash(hash: number): void;
  setOpacityByHash(hash: number, opacity: number): void;
  setTextureByHash(hash: number, dataUrl: string): Promise<void>;
  setAutomaticMaterialVisibility(on: boolean): void;

  // Customization (bodies). Only real choices can be worn: a look is option id -> choice
  // id. Its textures are ready before the swap, and geosets, composite, bone set and
  // skinned parts change inside one frame. The tree is fetched on first ask.
  loadCustomization(): Promise<import("@eclipse/format").CustomizationData | null>;
  setLook(look: import("@eclipse/format").Look): Promise<void>;
  /** Fetches what a look needs without showing it: a hovered choice's click is then instant. */
  prefetchLook(look: import("@eclipse/format").Look): void;
  /** Not for the UI: a test's hook into the geoset rules. */
  setGeoset(group: number, value: number): void;

  // Dressing room (Eclipse's wardrobe). Hover tries on, click wears, ring releases.
  /** Commit a slot. null releases it. */
  equip(slot: import("@eclipse/format").SlotId, itemId: string | null): Promise<void>;
  /** Show an item on the figure without committing. null ends the preview. */
  previewEquip(slot: import("@eclipse/format").SlotId, itemId: string | null): Promise<void>;
  /** The pointer has reached these: fetch and prepare them, show nothing. A click then swaps at once. Empty stops asking. */
  prefetchEquip(pieces: readonly (readonly [import("@eclipse/format").SlotId, string])[]): void;
  /**
   * What the pointer may reach next, into the browser's cache and nothing further, low in the
   * queue. `whole` false fetches only the manifests: the first round trip of a later hover.
   */
  warmItems(pieces: readonly (readonly [import("@eclipse/format").SlotId, string])[], whole: boolean): void;
  /** Links every program the item catalogue uses, on idle, so a new item never waits for one. Once; a fixed set. */
  warmPrograms(): void;
  /** Weapons in hand, or on their sheath points. */
  setSheathed(sheathed: boolean): void;
  /**
   * A body on a mount's seat (attachment 0), scaled and posed as retail does. null gets off.
   * Only a mount's stage has a seat.
   */
  setRider(bodyId: string | null): Promise<void>;
  /** Eases the camera to a slot's body region, or to the whole figure when null. */
  focusSlot(slot: import("@eclipse/format").SlotId | null): void;
  /**
   * Live 3D grid cells: one shared WebGL context, so a page of figures costs no extra
   * contexts. Returns a remove function. A grid asks for one at a time, over a poster, with
   * `inCell`: the canvas stands inside the card. `onDrawn` says the poster can go.
   */
  addFigureCell(el: HTMLElement, opts: { bodyId?: string; itemId?: string; setId?: string; effects?: boolean; inCell?: boolean; onDrawn?: () => void; onFailed?: (err: unknown) => void }): () => void;
  /**
   * What the poster baker would draw for this cell, as an image URL, for an entry the bake
   * hasn't reached. No pixel of it touches the screen until the page shows it. Null: nothing to show.
   */
  figurePoster(opts: { bodyId?: string; itemId?: string; setId?: string; pieces?: Partial<Record<import("@eclipse/format").SlotId, string>> }, width: number, height: number): Promise<string | null>;
  /** While this says so, the cells ask nothing of the GPU: the page is scrolling, and it comes first. */
  holdCells(hold: () => boolean): void;

  // Export
  exportPNG(scale: number, trim: boolean): Promise<void>;
  exportSTL(): Promise<void>;
  exportGLB(minimal: boolean, removeHidden: boolean): Promise<void>;
  recordLive(onTick: (seconds: number) => void): { stop(): Promise<void> };
  exportMP4(opts: {
    fps: number;
    signal: AbortSignal;
    onProgress: (fraction: number, phase: "capture" | "encode") => void;
  }): Promise<void>;

  // XR
  isXRAvailable(): boolean;
  startXR(): Promise<void>;

  // Numbers
  getFrameStats(): import("./stores").FrameStats | null;
  resetFrameStats(): void;
}

/**
 * Attached to `window` as `eclipse` so tests read the same numbers Khada's
 * `getFrameStats` gives, plus what the proofs need.
 */
export interface EngineDebug {
  /** renderer.info: geometries, textures, programs, calls, triangles. */
  gpu(): { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  /** Frames rendered since load. */
  frames(): number;
  /** ms from loadModel call to first drawn frame of the last load. */
  lastLoadMs(): number;
  /** Bytes fetched for the last load. */
  lastLoadBytes(): number;
}
