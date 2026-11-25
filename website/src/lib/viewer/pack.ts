import { R2, packUrl } from "@eclipse/format";

/**
 * The baked 3D packs: models, items, mounts and their art, built by the Eclipse-Viewer
 * bake and served from its storage. Nothing here is hosted by this site, so drawing a
 * figure costs this site no bandwidth.
 */
export const PACK_BASE: string = (process.env.NEXT_PUBLIC_PACK_BASE || R2.publicBase).replace(/\/$/, "");

/** A pack's image; an empty key means it is not baked. */
export function art(key: string | undefined): string | null {
  return key ? packUrl(PACK_BASE, key) : null;
}
