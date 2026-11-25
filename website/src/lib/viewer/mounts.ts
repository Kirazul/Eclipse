import "server-only";
import { packUrl, paths, type MountEntry } from "@eclipse/format";
import { PACK_BASE } from "@/lib/viewer/pack";

/** What a mount card needs: the grid never ships the whole catalogue to the browser. */
export interface MountCard {
  id: string;
  name: string;
  poster: string | null;
  flying: boolean;
  colours: number;
}

/**
 * Every baked mount family, a model and its colours. Read from the packs on the server
 * and kept a day, so visitors' pages do not each ask for half a megabyte.
 */
export async function getMounts(): Promise<MountEntry[]> {
  try {
    const res = await fetch(packUrl(PACK_BASE, paths.mounts()), { next: { revalidate: 86_400 } });
    if (!res.ok) return [];
    const list = (await res.json()) as MountEntry[];
    return list.filter((m) => m.model && m.variants.length);
  } catch {
    return [];
  }
}

export const toCard = (m: MountEntry): MountCard => ({
  id: m.id,
  name: m.name,
  poster: m.poster ? packUrl(PACK_BASE, m.poster) : null,
  flying: m.flying,
  colours: m.variants.length,
});

export async function getMount(id: string): Promise<MountEntry | null> {
  return (await getMounts()).find((m) => m.id === id) ?? null;
}
