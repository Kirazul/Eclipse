/**
 * The state the UI reads. The engine writes these; the site only subscribes and
 * calls the methods in api.ts. Nothing in here renders.
 */
import { atom } from "nanostores";
import type { ClipEntry, CustomizationData, Look, ModelManifest, SlotId } from "@eclipse/format";

/** One Model Parts row. */
export interface PartRow {
  hash: number;
  name: string;
  geoset: number;
  visible: boolean;
  wireframe: boolean;
  transparent: boolean;
  depthWrite: boolean;
  opacity: number;
}

export interface FrameStats {
  renderer: "webgl" | "webgpu";
  count: number;
  meanMs: number;
  p50Ms: number;
  p90Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
  fps: number;
}

export const $loading = atom<boolean>(false);
/** 0..1 of the current model. */
export const $progress = atom<number>(0);
export const $error = atom<string | null>(null);
export const $manifest = atom<ModelManifest | null>(null);
/** The body's customization tree, once the tab or a shared look has asked for it. */
export const $customization = atom<CustomizationData | null>(null);
/** What the body on stage wears: option id -> choice id. */
export const $look = atom<Look | null>(null);

export const $clips = atom<ClipEntry[]>([]);
/** ClipEntry.id, or "T-Pose". */
export const $currentClip = atom<string | null>(null);
/** True while the current clip's pack is being fetched. */
export const $clipLoading = atom<boolean>(false);
export const $paused = atom<boolean>(false);
export const $timeScale = atom<number>(1);
export const $playlist = atom<string[]>([]);

export const $parts = atom<PartRow[]>([]);
/** Hovered part hash: drives the outline. */
export const $hoveredPart = atom<number | null>(null);
export const $autoVisibility = atom<boolean>(true);

export const $shadows = atom<boolean>(true);
/** Particles and ribbons. Off: none simulated, none drawn. */
export const $effects = atom<boolean>(true);
/** `.phys` simulation. Off: bones play their animation. */
export const $physics = atom<boolean>(true);
export const $watermark = atom<boolean>(true);
export const $skeleton = atom<boolean>(false);
export const $wireframe = atom<boolean>(false);
export const $autoRotationSpeed = atom<number>(0);
export const $backgroundColor = atom<string | null>(null);

/** What is worn: slot -> item id. Hover never writes here, only a click does. */
export const $equipped = atom<Partial<Record<SlotId, string>>>({});
/** What is being tried on: slot -> item id, shown over $equipped until it ends. */
export const $previewing = atom<Partial<Record<SlotId, string>>>({});
/** Slot the camera is looking at, null for the whole figure. */
export const $focusedSlot = atom<SlotId | null>(null);
