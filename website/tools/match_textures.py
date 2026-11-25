"""Find the retail file behind each texture the realm renamed, by its pixels.

    python tools/match_textures.py --eclipse <path-to-eclipse-dev> --client <3.3.5a client> --cache <folder>

The realm ships many retail recolours under older names (cape_..._purple.blp is retail's
cape_..._shadow.blp), which today's listfile does not know, so the bake found nothing to
draw for those items. This reads each such texture from the client's Eclipse packs,
downloads the retail textures in the same folder that share its set name, and keeps the
one whose 32x32 thumbnail is the same picture. Only names and FileDataIDs are written,
to tools/texture_aliases.json, which export_models.py reads; no game file is kept.

Downloads about 1.3 GB from the CDN once. Thumbnails are cached in --cache/thumbs, so a
second run only compares.
"""
from __future__ import annotations

import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import pickle
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import export_models as m

BUILD = "12.1.5.70448"
THUMB = (32, 32)
# Mean channel difference, 0-255. A true match scores near 0 (DXT re-encoding only); the
# nearest other recolour of the same set scores well above 10.
ACCEPT, MARGIN = 3.0, 2.0
# Retail candidates per realm name, most shared name tokens first.
CAP = 120
BATCH = 500


def thumb(data: bytes):
    image = Image.open(io.BytesIO(data))
    return image.size, np.asarray(image.convert("RGB").resize(THUMB, Image.BILINEAR), dtype=np.float32)


def tokens(base: str) -> list[str]:
    return base[:-4].split("_")


def unresolved(by_path: dict, eclipse: Path) -> set[str]:
    """Texture names the catalog's undrawn items use that the listfile lacks, and the
    gendered siblings export_models.Files.gendered may also ask for."""
    rows = m.read_items_edb(eclipse / "Eclipse" / "data" / "wardrobe" / "items.edb")
    names = set()
    for item, *_ in json.loads(m.ITEMS.read_text(encoding="utf8")):
        row = rows.get(item)
        if item >> 24 or not row:
            continue
        for path in [row["tex_l"], row["tex_r"], *row["body"]]:
            if path and path not in by_path and not m.EMBEDDED_ID.search(path):
                stem = path[:-6] if path[-6:-5] == "_" else path[:-4]
                names.update([path, *(f"{stem}_{sex}.blp" for sex in "umf")])
    return {name for name in names if name not in by_path}


def candidates(names, by_path: dict, root: dict) -> dict[str, list[int]]:
    """Retail textures in the same folder that carry the name's rarest set token."""
    index = collections.defaultdict(lambda: collections.defaultdict(set))
    for path, fdid in by_path.items():
        if path.endswith(".blp") and fdid in root:
            folder, _, base = path.rpartition("/")
            for token in set(tokens(base)):
                index[folder][token].add(base)
    out = {}
    for name in names:
        folder, _, base = name.rpartition("/")
        near = index.get(folder, {})
        present = [t for t in tokens(base) if len(t) >= 4 and not t.isdigit() and near.get(t)]
        if not present:
            continue
        mine = set(tokens(base))
        pool = near[min(present, key=lambda t: len(near[t]))]
        ranked = sorted(pool, key=lambda other: -len(mine & set(tokens(other))))[:CAP]
        out[name] = sorted({by_path[f"{folder}/{other}"] for other in ranked})
    return out


def download(tact_cdn, root: dict, fdids: list[int], cache: Path) -> dict:
    """FileDataID -> (size, thumbnail), each file read once by its archive range."""
    folder = cache / "thumbs"
    folder.mkdir(parents=True, exist_ok=True)
    T = tact_cdn.T
    placed = m.place_build(tact_cdn, BUILD, {f: root[f] for f in fdids})

    def one(fdid: int):
        place = placed.get(fdid)
        try:
            if len(place) == 3:
                raw = T.cdn(tact_cdn.PATH, "data", place[0], rng=(place[1], place[1] + place[2] - 1))
            else:
                key = place[0]
                raw = T.get(f"{T.HOST}/{tact_cdn.PATH}/data/{key[:2]}/{key[2:4]}/{key}")
            data = tact_cdn._blte(raw, {}) if raw else None
            if not data or hashlib.md5(data).hexdigest() != root[fdid]:
                return fdid, None
            return fdid, thumb(data)
        except Exception:  # noqa: BLE001 - an unreadable candidate is simply not a match
            return fdid, None

    todo = [f for f in fdids if placed.get(f)]
    out = {}
    with ThreadPoolExecutor(24) as pool:
        for start in range(0, len(todo), BATCH):
            batch = todo[start:start + BATCH]
            # Named by its contents, so a different candidate list never reuses it.
            name = hashlib.md5(json.dumps(batch).encode()).hexdigest()[:16]
            path = folder / f"{name}.pkl"
            if path.exists():
                got = pickle.loads(path.read_bytes())
            else:
                got = dict(pool.map(one, batch))
                path.write_bytes(pickle.dumps(got))
            out.update({k: v for k, v in got.items() if v})
            print(f"  {min(start + BATCH, len(todo))}/{len(todo)} candidates", flush=True)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--eclipse", type=Path, required=True)
    parser.add_argument("--client", type=Path, required=True, help="the 3.3.5a client holding Eclipse/packs")
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()

    sys.path.insert(0, str(args.eclipse / "tools" / "lib"))
    from mpq_read import MpqReader  # noqa: PLC0415

    tact_cdn = m.open_cdn(args.eclipse, args.cache)
    root = tact_cdn.root_map(BUILD)
    by_path, _, _ = m.read_listfile(args.eclipse / "re" / "out" / "hearth" / "listfile.csv")

    packs = args.client / "Eclipse" / "packs"
    readers = [MpqReader(str(p)) for p in [packs / "eclipse.mpq", *sorted(packs.rglob("*.mpq"))]]
    realm = {}
    for name in sorted(unresolved(by_path, args.eclipse)):
        for reader in readers:
            try:
                data = reader.read(name.replace("/", "\\"))
            except Exception:  # noqa: BLE001 - not in this pack
                data = None
            if data:
                try:
                    realm[name] = thumb(data)
                except Exception:  # noqa: BLE001 - undecodable, so unmatchable
                    pass
                break
    jobs = candidates(realm, by_path, root)
    print(f"{len(realm)} realm textures; {len(jobs)} with candidates", flush=True)
    thumbs = download(tact_cdn, root, sorted({f for c in jobs.values() for f in c}), args.cache)

    aliases, state = {}, collections.Counter()
    for name, fdids in jobs.items():
        (w, h), mine = realm[name]
        # The same picture keeps its shape, whatever its resolution.
        scored = sorted(
            (float(np.abs(mine - thumbs[f][1]).mean()), f)
            for f in fdids if f in thumbs and thumbs[f][0][0] * h == thumbs[f][0][1] * w
        )
        if not scored:
            state["nothing comparable"] += 1
            continue
        best, fdid = scored[0]
        # Retail sometimes ships one picture under two ids; either is the right file.
        others = [d for d, f in scored[1:] if float(np.abs(thumbs[f][1] - thumbs[fdid][1]).mean()) > ACCEPT]
        runner_up = others[0] if others else float("inf")
        if best <= ACCEPT and runner_up - best >= MARGIN:
            aliases[name] = fdid
            state["matched"] += 1
        else:
            state["no match"] += 1
    m.ALIASES.write_text(json.dumps(dict(sorted(aliases.items())), indent=0) + "\n", encoding="utf8")
    print(f"{dict(state)}; wrote {len(aliases)} aliases to {m.ALIASES.name}")


if __name__ == "__main__":
    main()
