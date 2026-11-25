import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import { dllUrl } from "./site";

vi.mock("server-only", () => ({}));

const { default: sitemap } = await import("@/app/sitemap");

// The old GitHub Pages site is being removed, so nothing here may lean on it.
const OLD_HOST = ["kirazul", "github", "io"].join(".");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css|json)$/.test(name) && !path.includes("catalog") ? [path] : [];
  });
}

describe("the site stands alone", () => {
  it("sends dinput8.dll to the public repo's latest release instead of hosting it", () => {
    expect(dllUrl).toBe("https://github.com/Kirazul/Eclipse/releases/latest");
    expect(existsSync(join(process.cwd(), "public", "dinput8.dll"))).toBe(false);
  });

  it("has no reference to the old host anywhere in the source", () => {
    const hits = sources(join(process.cwd(), "src")).filter((f) => readFileSync(f, "utf8").includes(OLD_HOST));
    expect(hits).toEqual([]);
  });

  it("answers robots.txt and sitemap.xml from the site's own address", async () => {
    const rules = robots();
    expect(rules.sitemap).toMatch(/\/sitemap\.xml$/);
    expect(String(rules.sitemap)).not.toContain(OLD_HOST);
    const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
    expect(paths.slice(0, 7)).toEqual(["/", "/community-gallery", "/loadouts", "/dressing-room", "/mounts", "/guide", "/privacy"]);
    const looks = paths.slice(7);
    expect(looks.length).toBeGreaterThan(600);
    expect(looks.every((path) => path.startsWith("/community-gallery/"))).toBe(true);
  });
});
