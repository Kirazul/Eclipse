// Writes src/data/catalog/recipe-displays.json: catalogue item id -> a retail display that
// wears exactly the files the retired figure pipeline drew the item with.
//
//   node tools/match_old_recipes.mjs --eclipse <path-to-eclipse-dev> [--recipes <dress folder>]
//
// Before the 3D packs, each item had a recipe of game files (public/dress/items, removed
// after RECIPES_AT). --recipes reads a fresh tools/export_models.py run instead, which
// knows the realm's renamed recolours (tools/texture_aliases.json); delete its output after.
// Many items the packs do not list by id still have a retail display naming the same
// files, and the packs may already hold that display. Only exact matches are kept: a
// display that names any file the recipe lacks could be another colour.
// Reads the retail tables Eclipse-DEV keeps (re/out/races/db2-<build>); writes ids only.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RECIPES_AT = "f7322bc";
const BUILD = "12.1.0.69933";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--eclipse");
if (at < 0 || !process.argv[at + 1]) throw new Error("usage: node tools/match_old_recipes.mjs --eclipse <path-to-eclipse-dev>");
const db2 = join(process.argv[at + 1], "re", "out", "races", `db2-${BUILD}`);
const packBase = /publicBase:\s*"([^"]+)"/.exec(readFileSync(join(root, "packages", "format", "src", "config.ts"), "utf8"))[1];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
const recipes = {};
const fresh = process.argv.indexOf("--recipes");
if (fresh >= 0) {
  const dir = join(process.argv[fresh + 1], "items");
  for (const f of readdirSync(dir)) Object.assign(recipes, JSON.parse(readFileSync(join(dir, f), "utf8")));
} else {
  for (const path of git("ls-tree", "-r", "--name-only", RECIPES_AT, "public/dress/items").split("\n").filter(Boolean)) {
    Object.assign(recipes, JSON.parse(git("show", `${RECIPES_AT}:${path}`)));
  }
}

const csv = (name) => {
  const [head, ...lines] = readFileSync(join(db2, `${name}.csv`), "utf8").split(/\r?\n/).filter(Boolean);
  const cols = head.split(",");
  return lines.map((l) => {
    const v = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
};
const group = (rows, key, value) => {
  const out = new Map();
  for (const r of rows) (out.get(r[key]) ?? out.set(r[key], []).get(r[key])).push(Number(r[value]));
  return out;
};
const texByMat = group(csv("TextureFileData"), "MaterialResourcesID", "FileDataID");
const modelByRes = group(csv("ModelFileData"), "ModelResourcesID", "FileDataID");

// Every file each retail display names: body textures, models and their textures.
const files = new Map();
const add = (display, list) => {
  if (!list) return;
  const set = files.get(display) ?? files.set(display, new Set()).get(display);
  for (const f of list) set.add(f);
};
for (const r of csv("ItemDisplayInfoMaterialRes")) add(Number(r.ItemDisplayInfoID), texByMat.get(r.MaterialResourcesID));
for (const r of csv("ItemDisplayInfo")) {
  for (const k of ["ModelResourcesID_0", "ModelResourcesID_1"]) if (r[k] && r[k] !== "0") add(Number(r.ID), modelByRes.get(r[k]));
  for (const k of ["ModelMaterialResourcesID_0", "ModelMaterialResourcesID_1"]) if (r[k] && r[k] !== "0") add(Number(r.ID), texByMat.get(r[k]));
}
const byFile = new Map();
for (const [display, set] of files) for (const f of set) (byFile.get(f) ?? byFile.set(f, new Set()).get(f)).add(display);

// What the packs hold.
const catalog = await (await fetch(`${packBase}/catalog/catalog.json`)).json();
const baked = new Set();
for (const ref of catalog.itemShards ?? []) {
  for (const [display] of (await (await fetch(`${packBase}/${ref.key}`)).json()).rows) baked.add(display);
}

/**
 * A recipe as parts, each met by any one of its files: a body region names its male and
 * female texture, a model names one file per race. Geosets are numbers, not files.
 */
function parts(recipe) {
  const out = [];
  for (const [key, val] of Object.entries(recipe)) {
    if (key === "geosets" || typeof val !== "object" || !val) continue;
    if (key === "model" && !Array.isArray(val)) out.push(Object.values(val).flat());
    else if (Array.isArray(val)) out.push(val);
    else for (const v of Object.values(val)) out.push([v].flat());
  }
  return out.map((p) => p.filter(Number.isInteger)).filter((p) => p.length);
}

const out = {};
for (const [item, recipe] of Object.entries(recipes)) {
  const need = parts(recipe);
  if (!need.length) continue;
  const want = new Set(need.flat());
  const hit = [...new Set(need[0].flatMap((f) => [...(byFile.get(f) ?? [])]))].find((d) => {
    if (!baked.has(d)) return false;
    const has = files.get(d);
    // Every part is there, and nothing the recipe does not draw.
    return need.every((p) => p.some((f) => has.has(f))) && [...has].every((f) => want.has(f));
  });
  if (hit) out[item] = hit;
}
writeFileSync(join(root, "src", "data", "catalog", "recipe-displays.json"), `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} of ${Object.keys(recipes).length} old recipes match a baked retail display exactly`);
