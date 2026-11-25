import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// zod is about 97 KB gzipped, and a browser needs none of it: the server validates. The
// limits the forms show live in limits.ts so that no page ships the schemas for a number.
const SRC = join(process.cwd(), "src");
const ZOD = /^import\s+(?!type\b)[^;]*from\s+"zod"/m;

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });

const exists = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The files a module pulls in at run time: type-only imports vanish in the build. */
function imports(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const found = [...text.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;"']*?from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
  return found.flatMap((name) => {
    const base = name.startsWith("@/") ? join(SRC, name.slice(2)) : name.startsWith(".") ? join(dirname(path), name) : null;
    if (!base) return [];
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].filter(exists);
  });
}

/** Everything a client component brings to the browser. Server actions stay on the server. */
function reaches(path: string, seen = new Set<string>()): Set<string> {
  if (seen.has(path)) return seen;
  seen.add(path);
  if (/^["']use server["']/m.test(readFileSync(path, "utf8"))) return seen;
  for (const next of imports(path)) reaches(next, seen);
  return seen;
}

const clients = sources(SRC).filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));

describe("what the browser downloads", () => {
  it.each(clients.map((f) => f.slice(SRC.length + 1)))("%s brings no zod", (name) => {
    const heavy = [...reaches(join(SRC, name))].filter((f) => {
      const text = readFileSync(f, "utf8");
      return ZOD.test(text) && !/^["']use server["']/m.test(text);
    });
    expect(heavy.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
