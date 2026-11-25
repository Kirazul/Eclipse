"""Bake the Eclipse catalogues into what the website reads.

    python tools/export_catalog.py --eclipse <path-to-eclipse-dev>
    python tools/export_catalog.py --eclipse ... --icons   # also write public/icons/

Reads, never writes, the Eclipse tree:
    Eclipse/data/wardrobe/names.edb        item id -> English name
    Eclipse/data/wardrobe/items.edb        item id -> slot, class, subclass
    Eclipse/data/appearances/catalogue.ecap  item icons and set names
    Eclipse/data/appearances/set_pieces.edb  which items make each set
    Eclipse/data/wardrobe/icons.pak        64x64 BC2 icon atlas
    Eclipse/data/mounts/mounts.edb         mount display -> name
    build/tests/world-preview/places.tsv   every place (tools/tests/world_preview)
    work/<line>/plan.json                  retail item quality (ItemSparse)
    new files/realm/spellitemenchantment.dbc  enchant id -> name
    work/<line>/build/                     each retail line the overlay ships as a pack
                                           (War Within, Midnight): its items, names,
                                           icons and sets, keyed (line byte << 24) | the
                                           retail display id, as the overlay keys them
    work/<line>/inventory.json             retail item quality for a line's displays
    re/out/hearth/listfile.csv             an icon's FileDataID -> its game name

Writes:
    src/data/catalog/items.json   [id, name, invType, armor, icon]
    src/data/catalog/sets.json    named sets, resolved to wardrobe slots
    src/data/catalog/mounts.json  [display, name, icon]
    src/data/catalog/places.json  [tag, name, parent index, group]
    src/data/catalog/quality.json  item id -> quality, only where a plan names it
    src/data/catalog/enchants.json enchant id -> name, the ones with a weapon glow
    public/icons/<name>.webp      only with --icons

Nothing is rebuilt when its output is newer than every source. --force overrides.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "catalog"
ICONS = ROOT / "public" / "icons"

# INVTYPE_* -> the wardrobe's slot index (MorphOffsets.h). A robe is a chest and
# a two-hander a main hand; those are the same slot in the client.
SLOT_OF_INVTYPE = {
    1: 0, 3: 2, 4: 3, 5: 4, 20: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, 16: 14,
    13: 15, 17: 15, 21: 15, 14: 16, 22: 16, 23: 16, 15: 17, 25: 17, 26: 17, 19: 18,
}
ARMOR_NAME = {1: "cloth", 2: "leather", 3: "mail", 4: "plate"}
# items.edb writes subclass 1 on realm and retail rows whatever the piece is:
# 9,522 "cloth" rows held plate sets with inv_plate_* icons. Subclasses 2-4 are
# real. For 1 the icon says what the art is, then the name; neither, and the
# armour is unknown (0) rather than guessed.
ARMOR_ICON = [(4, re.compile(r"(^|_)plate(_|$)")), (3, re.compile(r"(^|_)(mail|chain)(_|$)")),
              (2, re.compile(r"(^|_)leather(_|$)")), (1, re.compile(r"(^|_)(cloth|robe)(_|$)"))]
ARMOR_WORD = [(4, re.compile(r"plate|warhelm|greathelm|sabatons", re.I)),
              (3, re.compile(r"chain|\bmail\b|scale", re.I)),
              (2, re.compile(r"leather|hide|\bferal", re.I)),
              (1, re.compile(r"\b(cloth|silk|robe|cowl|raiment|vestments|satin)\b", re.I))]
GROUPS = ["Classic", "Burning Crusade", "Wrath", "Capitals", "Instances", "Other"]
# The overlay's retail packs (RetailLines.h): folder, and the byte every id it brings
# carries in its top eight bits, so none can mean a realm item or another line's.
LINES = [("warwithin", 4), ("midnight", 3)]
LINE_ICON = re.compile(r"eclipse[a-z]+_(\d+)$")
CLEAN_ICON = re.compile(r"[a-z0-9_\-]+")


def cstr(blob: bytes, off: int) -> str:
    end = blob.index(b"\0", off)
    return blob[off:end].decode("utf-8", "replace")


def repair_name(text: str) -> str:
    """Some set names are stored double-encoded: UTF-8 bytes read as Latin-1, so an
    apostrophe arrives as three characters. A sound name fails this round trip and
    comes back untouched. Apostrophes end up straight, as in every item name."""
    try:
        text = text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return text.replace("’", "'")


def read_names(path: Path) -> dict[int, str]:
    d = path.read_bytes()
    magic, ver, rows, stride, _ = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"ENDB" and ver == 1 and stride == 8, (magic, ver, stride)
    base = 20 + rows * stride
    out = {}
    for i in range(rows):
        item, off = struct.unpack_from("<II", d, 20 + i * 8)
        out[item] = cstr(d, base + off)
    return out


def armor_of(cls: int, sub: int, icon: str, name: str) -> int:
    if cls != 4 or sub == 0 or sub > 4:
        return 0
    if sub != 1:
        return sub
    for kind, pattern in ARMOR_ICON:
        if pattern.search(icon):
            return kind
    for kind, pattern in ARMOR_WORD:
        if pattern.search(name):
            return kind
    return 0


def read_items(path: Path) -> dict[int, tuple[int, int, int]]:
    d = path.read_bytes()
    magic, _, rows, stride, _ = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"EIDB" and stride == 76, (magic, stride)
    out = {}
    for i in range(rows):
        o = 20 + i * stride
        item = struct.unpack_from("<I", d, o)[0]
        # EdbRow: 14 dwords, flags, 5 uint16, then invType ... itemClass, itemSub.
        inv = d[o + 14 * 4 + 4 + 10]
        cls, sub = d[o + 74], d[o + 75]
        if item not in out:
            out[item] = (inv, cls, sub)
    return out


def read_ecap(path: Path):
    d = path.read_bytes()
    magic, _, ncat, napp, nset, nlink, nblob = struct.unpack_from("<4sIIIIII", d, 0)
    assert magic == b"ECAP", magic
    o_app = 28 + ncat * 24
    o_set = o_app + napp * 40
    o_link = o_set + nset * 16
    o_blob = o_link + nlink * 4
    blob = d[o_blob:o_blob + nblob]
    icon_of_item: dict[int, str] = {}
    for i in range(napp):
        v = struct.unpack_from("<IIIIIIIHHHBBBBH", d, o_app + i * 40)
        entry, display, icon_off, kind = v[1], v[2], v[4], v[10]
        if kind != 0:
            continue
        item = entry or display
        icon = cstr(blob, icon_off) if icon_off < len(blob) else ""
        if item and icon:
            icon_of_item.setdefault(item, icon)
    set_names = {}
    for i in range(nset):
        sid, name_off, _first, _count = struct.unpack_from("<IIII", d, o_set + i * 16)
        set_names[sid] = cstr(blob, name_off)
    return icon_of_item, set_names


def read_icon_names(path: Path) -> dict[int, str]:
    """Icon FileDataID -> the game's name for it (inv_sword_04), from the listfile."""
    out = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            fdid, _, name = line.rstrip("\n").partition(";")
            name = name.lower()
            if fdid.isdigit() and name.startswith("interface/icons/") and name.endswith(".blp"):
                out[int(fdid)] = name[len("interface/icons/"):-4]
    return out


def read_line(base: Path, folder: str, key_byte: int, icon_names: dict[int, str]):
    """One retail line's catalogue, as the overlay's wardrobe reads it (Appearances.cpp):
    <line>.ecap holds each appearance's key and icon, <line>_names.bin its name.

    Icons arrive renamed eclipse<line>_<FileDataID>; each goes back to its game name,
    so an icon the realm also uses is one file. Returns names, slots, icons, the BLP
    behind each icon, set names and pieces, and quality."""
    data = base / "work" / folder / "build" / "data"
    d = (data / f"{folder}.ecap").read_bytes()
    magic, _, ncat, napp, nset, nlink, nblob = struct.unpack_from("<4sIIIIII", d, 0)
    assert magic == b"ECAP", magic
    o_app = 28 + ncat * 24
    blob_at = o_app + napp * 40 + nset * 16 + nlink * 4
    blob = d[blob_at:blob_at + nblob]
    nm = (data / f"{folder}_names.bin").read_bytes()
    assert struct.unpack_from("<I", nm, 0)[0] == napp and len(nm) == 4 + napp * 4, folder
    name_at = struct.unpack_from(f"<{napp}I", nm, 4)

    names: dict[int, str] = {}
    icons: dict[int, str] = {}
    blps: dict[str, Path] = {}
    for i in range(napp):
        v = struct.unpack_from("<IIIIIIIHHHBBBBH", d, o_app + i * 40)
        entry, display, icon_off, kind = v[1], v[2], v[4], v[10]
        key = entry or display
        if kind != 0 or key >> 24 != key_byte:
            continue
        if 0 < name_at[i] < len(blob):
            names.setdefault(key, cstr(blob, name_at[i]).strip())
        raw = cstr(blob, icon_off).lower() if icon_off < len(blob) else ""
        hit = LINE_ICON.fullmatch(raw)
        if hit:
            # A few listfile names carry a space, which is no name for a file a URL serves.
            icon = icon_names.get(int(hit[1]), raw)
            if not CLEAN_ICON.fullmatch(icon):
                icon = raw
            icons.setdefault(key, icon)
            blps.setdefault(icon, base / "work" / folder / "build" / "Interface" / "Icons" / f"{raw}.blp")
    names = {k: n for k, n in names.items() if n}

    items = read_items(data / f"{folder}_items.edb")
    set_names = {sid: name for sid, name in read_ecap(data / f"{folder}.ecap")[1].items()}
    set_pieces = read_set_pieces(data / f"{folder}_setpieces.edb")

    displays = json.loads((base / "work" / folder / "inventory.json").read_text(encoding="utf-8"))["displays"]
    # The quality of the item the name is, else of every item on the display when they
    # agree; one look can be a green and an epic, and then it has no single answer.
    quality = {}
    for key, name in names.items():
        worn = displays.get(str(key & 0xFFFFFF), {}).get("items") or ()
        named = {int(it.get("quality") or 0) for it in worn if it.get("name", "").strip().lower() == name.lower()}
        seen = (named or {int(it.get("quality") or 0) for it in worn}) & set(range(8))
        if len(seen) == 1:
            quality[key] = next(iter(seen))
    return names, items, icons, blps, set_names, set_pieces, quality


def read_set_pieces(path: Path) -> dict[int, list[int]]:
    """set id -> item ids. The catalogue's own link table is sparse; this is the
    one the wardrobe's Sets page reads (Appearances.cpp, SetPieceRec)."""
    d = path.read_bytes()
    magic, _, nset, npiece = struct.unpack_from("<4sIII", d, 0)
    assert magic == b"SPCE", magic
    base = 16 + nset * 12
    out = {}
    for i in range(nset):
        sid, first, count = struct.unpack_from("<III", d, 16 + i * 12)
        assert first + count <= npiece, (sid, first, count)
        out[sid] = [x for x in struct.unpack_from("<%dI" % count, d, base + first * 4) if x]
    return out


def read_mounts(path: Path) -> list[list]:
    d = path.read_bytes()
    magic, ver, count, str_bytes, _ = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"EMDB" and ver == 2, (magic, ver)
    base = 20 + count * 32
    rows = []
    for i in range(count):
        display, _src, _spell, name, icon, *_ = struct.unpack_from("<8I", d, 20 + i * 32)
        rows.append([display, cstr(d, base + name), cstr(d, base + icon)])
    return rows


def read_enchants(path: Path) -> dict[int, str]:
    """The enchants a loadout can name: SpellItemEnchantment rows with an
    ItemVisual, since a glow with no visual draws nothing on the weapon."""
    d = path.read_bytes()
    magic, rows, fields, stride, _ = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"WDBC" and fields == 38 and stride == 152, (magic, fields, stride)
    base = 20 + rows * stride
    out = {}
    for i in range(rows):
        row = struct.unpack_from("<38I", d, 20 + i * stride)
        # The realm's rows carry the client's colour escapes: |cff0066ffName|r.
        name = re.sub(r"\|c[0-9a-fA-F]{8}|\|r", "", cstr(d, base + row[14])).strip()
        if name and row[31]:
            out[row[0]] = name
    return out


def read_qualities(plans: list[Path], names: dict[int, str]) -> dict[int, int]:
    """Quality for the catalogue items a retail plan also names (0 poor .. 7 heirloom).

    Plans speak retail ids and the catalogue does not, so one number can be two
    different items: they meet on the name, and a name the plans disagree on has
    no answer. Everything else stays unknown rather than guessed.
    """
    seen: dict[str, set[int]] = collections.defaultdict(set)
    for plan in plans:
        for row in json.loads(plan.read_text(encoding="utf-8")).values():
            for it in row.get("items") or ():
                quality = int(it.get("quality") or 0)
                if 0 <= quality <= 7:
                    seen[it.get("name", "").strip().lower()].add(quality)
    out = {}
    for item, name in names.items():
        qualities = seen.get(name.strip().lower(), ())
        if len(qualities) == 1:
            out[item] = next(iter(qualities))
    return out


def read_places(path: Path) -> list[list]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        key, group, _section, _depth, parent, _icon, _letter, name = line.split("\t")
        k = int(key, 16)
        tag = ("m" if k >> 24 == 1 else "a") + str(k & 0xFFFFFF)
        rows.append([tag, name, int(parent), int(group)])
    return rows


def resolve_sets(set_names, set_pieces, names, items, icon_of_item) -> list[dict]:
    """The sets a person could wear: named, one clear armour type, enough pieces."""
    out = []
    for sid, name in set_names.items():
        pieces: dict[int, int] = {}
        votes: collections.Counter[int] = collections.Counter()
        for item in set_pieces.get(sid, ()):
            inv, cls, sub = items.get(item, (0, 0, 0))
            slot = SLOT_OF_INVTYPE.get(inv)
            if slot is None or item not in names:
                continue
            pieces.setdefault(slot, item)
            kind = armor_of(cls, sub, icon_of_item.get(item, "").lower(), names[item])
            if kind:
                votes[kind] += 1
        if len(pieces) < 5 or not name.strip() or not votes:
            continue
        kind, count = votes.most_common(1)[0]
        if count * 2 > sum(votes.values()):
            out.append({"id": sid, "name": repair_name(name.strip()), "armor": ARMOR_NAME[kind],
                        "pieces": {str(s): pieces[s] for s in sorted(pieces)}})
    return out


# --- icons --------------------------------------------------------------------
def bc2_rgba(block_bytes):
    """(n, 16) BC2 blocks -> (n, 4, 4, 4) RGBA."""
    import numpy as np
    b = block_bytes
    n = len(b)
    alpha = np.frombuffer(b[:, :8].tobytes(), "<u2").reshape(n, 4)
    a = np.stack([(alpha >> (4 * i)) & 15 for i in range(4)], -1).reshape(n, 4, 4) * 17
    c = np.frombuffer(b[:, 8:12].tobytes(), "<u2").reshape(n, 2).astype(np.int32)
    idx = np.frombuffer(b[:, 12:16].tobytes(), "<u4")

    def rgb(v):
        return np.stack([((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63,
                         (v & 31) * 255 // 31], -1)

    c0, c1 = rgb(c[:, 0]), rgb(c[:, 1])
    pal = np.stack([c0, c1, (2 * c0 + c1) // 3, (c0 + 2 * c1) // 3], 1)
    sel = np.stack([(idx >> (2 * i)) & 3 for i in range(16)], -1).astype(np.int64)
    px = pal[np.arange(n)[:, None], sel].reshape(n, 4, 4, 3)
    return np.concatenate([px, a[..., None]], -1).astype(np.uint8)


def export_icons(pak: Path, want: set[str]) -> int:
    """Only the icons the site names, one file each, from pages of 4 MB."""
    import numpy as np
    from PIL import Image
    d = pak.read_bytes()
    magic, _, cell, page, entries, pages, name_bytes = struct.unpack_from("<4sIIIIII", d, 0)
    assert magic == b"EICO", magic
    names_at = 28 + entries * 8
    pages_at = names_at + name_bytes
    per_row = page // cell
    page_bytes = (page // 4) ** 2 * 16
    blocks = cell // 4
    ICONS.mkdir(parents=True, exist_ok=True)
    wanted = {w.lower() for w in want if w}
    done = 0
    for i in range(entries):
        off, pg, c = struct.unpack_from("<IHH", d, 28 + i * 8)
        name = cstr(d, names_at + off).lower()
        if name not in wanted:
            continue
        target = ICONS / (name + ".webp")
        if target.exists():
            done += 1
            continue
        row, col = c // per_row, c % per_row
        base = pages_at + pg * page_bytes
        tiles = np.zeros((cell, cell, 4), np.uint8)
        for y in range(blocks):
            at = base + ((row * blocks + y) * (page // 4) + col * blocks) * 16
            raw = np.frombuffer(d, np.uint8, blocks * 16, at).reshape(blocks, 16)
            px = bc2_rgba(raw)
            for x in range(blocks):
                tiles[y * 4:y * 4 + 4, x * 4:x * 4 + 4] = px[x]
        Image.fromarray(tiles, "RGBA").save(target, "WEBP", quality=88, method=6)
        done += 1
    return done


def export_line_icons(blps: dict[str, Path]) -> int:
    """A line's icons, from the BLPs its pack ships. One the realm's atlas already
    wrote is kept: the same name is the same game icon."""
    from PIL import Image
    ICONS.mkdir(parents=True, exist_ok=True)
    done = 0
    for name, blp in blps.items():
        target = ICONS / (name + ".webp")
        if not target.exists():
            if not blp.exists():
                continue
            with Image.open(blp) as im:
                im.convert("RGBA").save(target, "WEBP", quality=88, method=6)
        done += 1
    return done


def write(name: str, data) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                            encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--eclipse", default=os.environ.get("ECLIPSE_DEV"), required=False)
    ap.add_argument("--icons", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if not a.eclipse:
        raise SystemExit("pass --eclipse <Eclipse source folder> or set ECLIPSE_DEV")
    base = Path(a.eclipse)
    data = base / "Eclipse" / "data"
    sources = [data / "wardrobe" / "names.edb", data / "wardrobe" / "items.edb",
               data / "appearances" / "catalogue.ecap", data / "mounts" / "mounts.edb",
               base / "build" / "tests" / "world-preview" / "places.tsv",
               data / "appearances" / "set_pieces.edb",
               base / "work" / "warwithin" / "plan.json", base / "work" / "midnight" / "plan.json",
               base / "new files" / "realm" / "spellitemenchantment.dbc",
               base / "re" / "out" / "hearth" / "listfile.csv"]
    for folder, _ in LINES:
        built = base / "work" / folder / "build" / "data"
        sources += [built / f"{folder}.ecap", built / f"{folder}_names.bin", built / f"{folder}_items.edb",
                    built / f"{folder}_setpieces.edb", base / "work" / folder / "inventory.json"]
    missing = [str(s) for s in sources if not s.exists()]
    if missing:
        raise SystemExit("missing: " + ", ".join(missing))

    outputs = [OUT / n for n in ("items.json", "sets.json", "mounts.json", "places.json",
                                 "quality.json", "enchants.json")]
    newest = max(s.stat().st_mtime for s in sources + [Path(__file__)])
    fresh = all(o.exists() and o.stat().st_mtime > newest for o in outputs)
    if fresh and not a.force and not a.icons:
        print("catalogue is up to date")
        return 0

    names = read_names(sources[0])
    items = read_items(sources[1])
    icon_of_item, set_names = read_ecap(sources[2])
    set_pieces = read_set_pieces(sources[5])
    mounts = read_mounts(sources[3])
    places = read_places(sources[4])
    qualities = read_qualities(sources[6:8], names)
    enchants = read_enchants(sources[8])

    # The retail lines join on keys no realm id can take, so nothing is overwritten.
    icon_names = read_icon_names(sources[9])
    line_blps: dict[str, Path] = {}
    for folder, key_byte in LINES:
        l_names, l_items, l_icons, l_blps, l_set_names, l_set_pieces, l_quality = read_line(
            base, folder, key_byte, icon_names)
        for own, more in ((names, l_names), (items, l_items), (icon_of_item, l_icons), (set_names, l_set_names),
                          (set_pieces, l_set_pieces), (qualities, l_quality)):
            assert not own.keys() & more.keys(), folder
            own.update(more)
        line_blps.update(l_blps)
        print("%s: %d items, %d with icon, %d sets" % (folder, len(l_names), len(l_icons), len(l_set_names)))

    rows = []
    for item in sorted(names):
        inv, cls, sub = items.get(item, (0, 0, 0))
        icon = icon_of_item.get(item, "").lower()
        rows.append([item, names[item], inv, armor_of(cls, sub, icon, names[item]), icon])
    wearable = resolve_sets(set_names, set_pieces, names, items, icon_of_item)

    write("items.json", rows)
    write("sets.json", wearable)
    write("mounts.json", mounts)
    write("places.json", {"groups": GROUPS, "rows": places})
    write("quality.json", {str(k): qualities[k] for k in sorted(qualities)})
    write("enchants.json", {str(k): enchants[k] for k in sorted(enchants)})
    print("items %d (%d with slot, %d with icon, %d with quality)  sets %d of %d  "
          "mounts %d  places %d  enchants %d" % (
              len(rows), sum(1 for r in rows if r[2]), sum(1 for r in rows if r[4]), len(qualities),
              len(wearable), len(set_names), len(mounts), len(places), len(enchants)))

    if a.icons:
        # Every item, not only set pieces: a published code can name any of them.
        want = {r[4] for r in rows}
        want |= {m[2].removesuffix(".blp") for m in mounts}
        print("icons written or present: %d of %d" %
              (export_icons(data / "wardrobe" / "icons.pak", want), len(want)))
        print("retail line icons written or present: %d of %d" %
              (export_line_icons(line_blps), len(line_blps)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
