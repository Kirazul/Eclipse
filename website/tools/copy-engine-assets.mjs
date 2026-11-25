// Copies what the 3D engine fetches at runtime into public/: the Basis transcoder
// (/basis/) and detect-gpu's benchmark tables (/gpu/), so neither comes from a
// third-party CDN. Runs before dev and build; the copies are gitignored.
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Resolved from the engine package, as the bundle resolves them; neither exports package.json.
const pkgDir = (name) => join(root, "packages", "engine", "node_modules", name);

const basisFrom = join(pkgDir("three"), "examples", "jsm", "libs", "basis");
const basisTo = join(root, "public", "basis");
mkdirSync(basisTo, { recursive: true });
for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) cpSync(join(basisFrom, f), join(basisTo, f));

const gpuFrom = join(pkgDir("detect-gpu"), "dist", "benchmarks");
const gpuTo = join(root, "public", "gpu");
mkdirSync(gpuTo, { recursive: true });
for (const f of readdirSync(gpuFrom)) if (f.endsWith(".json")) cpSync(join(gpuFrom, f), join(gpuTo, f));
