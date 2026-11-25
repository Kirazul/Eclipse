/** The keyboard table, as data. Left is previous and Right is next, as labelled. */
export type ShortcutAction =
  | "pause"
  | "timeScale"
  | "next"
  | "previous"
  | "stepBack"
  | "stepForward"
  | "fullscreen"
  | "png";

export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  targetTag: string;
  /** The element asked to keep the arrows for itself. */
  ignoreArrows: boolean;
}

const SKIP_TAGS = /^(?:input|textarea|select|li)$/i;

export function resolveShortcut(k: KeyInput): ShortcutAction | null {
  if (SKIP_TAGS.test(k.targetTag) || k.ctrlKey || k.metaKey) return null;
  if (k.code === "KeyP" && k.altKey) return "png";
  if (k.code === "KeyP" || k.code === "KeyK") return "pause";
  if (k.code === "KeyT") return "timeScale";
  if (!k.ignoreArrows) {
    if (k.code === "ArrowLeft") return "previous";
    if (k.code === "ArrowRight") return "next";
  }
  if (k.code === "Comma") return "stepBack";
  if (k.code === "Period") return "stepForward";
  if (k.code === "KeyF") return "fullscreen";
  return null;
}
