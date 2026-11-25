import type { ViewerEngine } from "@eclipse/engine";
import { atom } from "nanostores";

/**
 * The engine on the page, once it has mounted. The engine's own stores (clips, the look,
 * customization) are module-wide, so a page shows one figure at a time.
 */
export const $engine = atom<ViewerEngine | null>(null);
