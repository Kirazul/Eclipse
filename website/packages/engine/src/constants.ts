/**
 * Every number the viewer's feel depends on, in one place. Values come from the
 * reverse-engineering record (docs/re/khada-re.md); the `BEAT` notes mark where
 * this engine measures better on purpose.
 */
export const TPOSE = "T-Pose";

export const CAMERA = { fov: 10, aspect: 1, near: 0.1, far: 100, position: [0, 3, 6] as const };
/** The model's root sits here: the camera target stays at the origin's height. */
export const MODEL_OFFSET = [0, 0, -1] as const;
export const CONTROLS = { minDistance: 0.8, maxDistance: 80 };
/** A body's camera: level, as retail's customization screen. Radians from straight up. */
export const BODY_POLAR = Math.PI / 2;

export const CROSSFADE_S = 0.3;
export const TIME_SCALES = [0.1, 0.5, 1, 2] as const;
export const SCRUB_STEP_S = 0.02;

export const FRAME_STATS_SAMPLES = 3600;
export const FRAME_GAP_MS = 1000;

export const RESIZE_DEBOUNCE_MS = 3;
export const RESIZE_MIN_PX = 100;

export const FADE_IN_CSS = "opacity 300ms cubic-bezier(.4,0,.2,1)";

export const IQR_FACTOR = 50;
export const MOTION_SAMPLES = 24;

/** The light exists only to throw the ground shadow; it adds almost no colour. */
export const SHADOW_LIGHT = { color: 0xdddddd, intensity: 0.01, position: [8, 18, 4] as const, mapSize: 4096 };
export const GROUND = { size: 50, opacity: 0.15 };

export const OUTLINE = {
  edge: 0xffd700,
  hidden: 0xdaa520,
  strength: 4,
  glow: 1,
  thickness: 3,
  pulse: 2,
  dimOthers: 0.4,
  hiddenOpacity: 0.05,
};

/**
 * WoW-style lighting, chosen here (Khada is unlit). The figure is lit from the
 * viewer's side so orbiting never leaves it dark: a bright, slightly cool ambient
 * plus one warm directional fixed in view space, clamped like the client's own
 * `saturate(l)`. All colour work is in gamma space, as retail's M2 path is.
 */
export const LIGHTING = {
  ambient: [0.62, 0.62, 0.66] as const,
  sun: [0.62, 0.6, 0.56] as const,
  /** View space, pointing at the light. */
  sunDir: [-0.38, 0.52, 0.76] as const,
};

/** Retail's alpha test: values below this are discarded on an alpha-key batch. */
export const ALPHA_KEY = 128 / 255;

export const MP4 = {
  offline: { codec: "avc", bitrate: 12_000_000, mode: "constant", keyFrameInterval: 1, fastStart: "in-memory" },
  live: { codec: "avc", bitrate: 8_000_000, mode: "variable" },
} as const;

export const STL_SCALE = 50;

/** Budget for the figure cell pass, so the main stage keeps its 60 fps. */
export const CELLS = {
  /** At or below this many visible cells, every cell updates every frame. */
  everyFrameUpTo: 4,
  startBudget: 8,
  minBudget: 2,
  maxBudget: 24,
  /** Milliseconds of main-thread time the cell pass may use per frame. */
  frameMs: 4,
  /** Composite resolution divisor. One: a slot's cell looks at the figure as closely as the stage does. */
  compositeDivisor: 1,
  /** Items, composites and idle bodies kept for an instant re-hover: a thousand hovers stay bounded. */
  keepItems: 8,
  keepComposites: 4,
  keepBodies: 2,
};

/**
 * Retail's edge fade, as its vertex programs read the model's EDGF curve (max, min, power):
 * pow(saturate((|n.v| - min) / (max - min)), power). Every model Eclipse measured carries
 * this one entry (mount_convert.py EDGF_DEFAULT, 64 of 64).
 */
export const EDGE_FADE = [0.72, 0.385, 1.22] as const;
