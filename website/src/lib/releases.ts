import "server-only";
import { VERSION_TEXT, isNewerBuild } from "@/lib/game-sync/wire";
import { GITHUB_URL } from "@/lib/site";

// The overlay's newest public release, from Kirazul/Eclipse on GitHub: what the game's
// version check compares itself with, and whether the Download panel can offer the DLL
// on its own. GitHub is asked at most once an hour; drafts and pre-releases never count,
// since its latest-release answer leaves them out.

const LATEST = "https://api.github.com/repos/Kirazul/Eclipse/releases/latest";
const ALL = "https://api.github.com/repos/Kirazul/Eclipse/releases?per_page=30";
const ASK = {
  headers: { Accept: "application/vnd.github+json", "User-Agent": "eclipse-web" },
  next: { revalidate: 3600 },
};

/** "v1.1.0" becomes "1.1.0"; anything that is not a version becomes null. */
function versionOf(tag: unknown): string | null {
  const version = typeof tag === "string" ? tag.replace(/^v/i, "") : "";
  return VERSION_TEXT.test(version) ? version : null;
}

export interface Release {
  /** The tag without its leading v: "1.1.0". */
  version: string;
}

/** Null while there is no release, or when GitHub cannot be read. */
export async function latestRelease(): Promise<Release | null> {
  try {
    const res = await fetch(LATEST, ASK);
    if (!res.ok) return null;
    const { tag_name: tag } = (await res.json()) as { tag_name?: unknown };
    const version = versionOf(tag);
    return version ? { version } : null;
  } catch {
    return null;
  }
}

export interface DllRelease {
  /** "1.1.0" */
  version: string;
  /** That release's own dinput8.dll on GitHub. */
  url: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown }[];
}

/**
 * Every published release that carries dinput8.dll, newest version first, for the
 * Download panel. Each tag is the DLL's own version, so players can pick an earlier
 * one. Empty when GitHub cannot be read.
 */
export async function dllReleases(): Promise<DllRelease[]> {
  try {
    const res = await fetch(ALL, ASK);
    if (!res.ok) return [];
    const list = (await res.json()) as GitHubRelease[];
    if (!Array.isArray(list)) return [];
    const found: DllRelease[] = [];
    for (const release of list) {
      if (release.draft || release.prerelease) continue;
      const version = versionOf(release.tag_name);
      const asset = release.assets?.find((a) => a.name === "dinput8.dll");
      const url = asset?.browser_download_url;
      if (!version || typeof url !== "string" || !url.startsWith(`${GITHUB_URL}/releases/download/`)) continue;
      found.push({ version, url });
    }
    return found.sort((a, b) => (isNewerBuild(a.version, b.version) ? -1 : isNewerBuild(b.version, a.version) ? 1 : 0));
  } catch {
    return [];
  }
}
