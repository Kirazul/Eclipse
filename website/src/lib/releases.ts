import "server-only";
import { VERSION_TEXT } from "@/lib/game-sync/wire";

// The overlay's newest public release, from Kirazul/Eclipse on GitHub: what the game's
// version check compares itself with, and whether the Download panel can offer the DLL
// on its own. GitHub is asked at most once an hour; drafts and pre-releases never count,
// since its latest-release answer leaves them out.

const LATEST = "https://api.github.com/repos/Kirazul/Eclipse/releases/latest";

export interface Release {
  /** The tag without its leading v: "1.1.0". */
  version: string;
}

/** Null while there is no release, or when GitHub cannot be read. */
export async function latestRelease(): Promise<Release | null> {
  try {
    const res = await fetch(LATEST, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "eclipse-web" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const { tag_name: tag } = (await res.json()) as { tag_name?: unknown };
    const version = typeof tag === "string" ? tag.replace(/^v/i, "") : "";
    return VERSION_TEXT.test(version) ? { version } : null;
  } catch {
    return null;
  }
}
