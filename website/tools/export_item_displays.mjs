// Writes src/data/catalog/displays.json: catalogue item id -> the retail display the
// 3D packs draw it with, for every item whose display is baked.
//
//   node tools/export_item_displays.mjs
//
// The packs list one item per display, so most items that share a model with another
// are not in them by id. Two sources name the display: the pack shards' own rows, and
// Eclipse-Viewer's line data (bake/data/lines.json.gz: realm and client item -> display),
// read at the commit packages/README.md pins. Last, for items neither names, the exact
// matches of the retired pipeline's recipes (tools/match_old_recipes.mjs).
// Run it again after a sync or a new bake.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "packages", "format", "src", "config.ts"), "utf8");
const packBase = /publicBase:\s*"([^"]+)"/.exec(config)[1];
const commit = /at commit `([0-9a-f]+)`/.exec(readFileSync(join(root, "packages", "README.md"), "utf8"))[1];

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const catalog = await json(`${packBase}/catalog/catalog.json`);
const baked = new Set();
const byEntry = new Map();
for (const ref of catalog.itemShards ?? []) {
  const shard = await json(`${packBase}/${ref.key}`);
  for (const [display, , , , entry] of shard.rows) {
    baked.add(display);
    if (entry && !byEntry.has(entry)) byEntry.set(entry, display);
  }
}

const res = await fetch(`https://raw.githubusercontent.com/Kirazul/Eclipse-Viewer/${commit}/bake/data/lines.json.gz`);
if (!res.ok) throw new Error(`lines.json.gz: ${res.status}`);
const lines = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
for (const line of ["eclipse", "client"]) {
  for (const [entry, display] of lines[line].rows) {
    if (baked.has(display) && !byEntry.has(entry)) byEntry.set(entry, display);
  }
}

const recipes = JSON.parse(readFileSync(join(root, "src", "data", "catalog", "recipe-displays.json"), "utf8"));
for (const [entry, display] of Object.entries(recipes)) {
  if (baked.has(display) && !byEntry.has(Number(entry))) byEntry.set(Number(entry), display);
}

const items = JSON.parse(readFileSync(join(root, "src", "data", "catalog", "items.json"), "utf8"));
const out = {};
for (const [id] of items) if (byEntry.has(id)) out[id] = byEntry.get(id);
writeFileSync(join(root, "src", "data", "catalog", "displays.json"), `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out).length} of ${items.length} catalogue items have a baked display`);
