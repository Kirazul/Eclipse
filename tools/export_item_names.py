"""Refresh the catalogue's item names from the name table the overlay ships.

    python tools/export_item_names.py --eclipse <path-to-eclipse-dev>
    python tools/export_item_names.py --eclipse ... --check   # report, write nothing

The overlay links its item names into dinput8.dll (ItemNames.h has where they come
from: the realm's own strings, preserved by its players). They replace names.edb,
the older table export_catalog.py reads, which named fewer items and had some
wrong. This tool takes the names from that table and the slot, armour and icon of
each item from the same files export_catalog.py reads, with the same rules.

Reads, never writes, the Eclipse tree:
    src/eclipse/generated/item_names.bin   item id -> the realm's name (ItemNames.cpp)
    Eclipse/data/wardrobe/items.edb        item id -> slot, class, subclass
    Eclipse/data/appearances/catalogue.ecap  item icons
    work/<line>/plan.json                  retail item quality, met on the name

Rewrites, for realm ids only:
    src/data/catalog/items.json   [id, name, invType, armor, icon]
    src/data/catalog/quality.json item id -> quality, only where a plan names it

The retail lines' rows (an id with a line byte in its top eight bits) stay exactly
as export_catalog.py wrote them. As there, every named item gets a row, since a
published code can name any of them; one items.edb has no slot for is listed
(invType 0) but offered in no slot. An item the table has no name for keeps the
one it had.
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_catalog import (OUT, armor_of, read_ecap, read_items, read_qualities,  # noqa: E402
                            write)

REALM_IDS = 1 << 24


def lz4_block(src: bytes, size: int) -> bytes:
    """The LZ4 block format, as ItemNames.cpp's Lz4Decode reads it."""
    out = bytearray()
    ip, n = 0, len(src)
    while ip < n:
        tok = src[ip]
        ip += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                b = src[ip]
                ip += 1
                lit += b
                if b != 255:
                    break
        out += src[ip:ip + lit]
        ip += lit
        if ip >= n:
            break
        off = src[ip] | (src[ip + 1] << 8)
        ip += 2
        if not off or off > len(out):
            raise ValueError("bad LZ4 offset")
        ml = (tok & 15) + 4
        if tok & 15 == 15:
            while True:
                b = src[ip]
                ip += 1
                ml += b
                if b != 255:
                    break
        start = len(out) - off
        if off >= ml:
            out += out[start:start + ml]
        else:
            # A match may overlap the bytes it is producing.
            for k in range(ml):
                out.append(out[start + k])
    if len(out) != size:
        raise ValueError("LZ4 block unpacked to %d bytes, header says %d" % (len(out), size))
    return bytes(out)


def varint(p: bytes, at: int) -> tuple[int, int]:
    v = shift = 0
    while True:
        b = p[at]
        at += 1
        v |= (b & 0x7F) << shift
        if not b & 0x80:
            return v, at
        shift += 7


def read_name_table(path: Path) -> dict[int, str]:
    """"ENDC", version 2, rows, unpacked bytes, packed bytes; then an LZ4 block of
    varint id deltas, varint name lengths and the UTF-8 names (ItemNames.cpp)."""
    d = path.read_bytes()
    magic, ver, rows, raw, packed = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"ENDC" and ver == 2 and packed == len(d) - 20, (magic, ver, packed)
    body = lz4_block(d[20:], raw)
    at, item, ids, lengths = 0, 0, [], []
    for _ in range(rows):
        delta, at = varint(body, at)
        item += delta
        ids.append(item)
    for _ in range(rows):
        n, at = varint(body, at)
        lengths.append(n)
    assert sum(lengths) == len(body) - at, "name block size"
    out = {}
    for item, n in zip(ids, lengths):
        name = body[at:at + n].decode("utf-8").strip()
        at += n
        if name:
            out[item] = name
    assert all(a < b for a, b in zip(ids, ids[1:])), "ids out of order"
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--eclipse", default=os.environ.get("ECLIPSE_DEV"))
    ap.add_argument("--check", action="store_true", help="report the change, write nothing")
    a = ap.parse_args()
    if not a.eclipse:
        raise SystemExit("pass --eclipse <Eclipse source folder> or set ECLIPSE_DEV")
    base = Path(a.eclipse)
    data = base / "Eclipse" / "data"
    sources = [base / "src" / "eclipse" / "generated" / "item_names.bin",
               data / "wardrobe" / "items.edb", data / "appearances" / "catalogue.ecap",
               base / "work" / "warwithin" / "plan.json", base / "work" / "midnight" / "plan.json"]
    missing = [str(s) for s in sources if not s.exists()]
    if missing:
        raise SystemExit("missing: " + ", ".join(missing))

    table = read_name_table(sources[0])
    items = read_items(sources[1])
    icon_of_item, _ = read_ecap(sources[2])

    old_rows = json.loads((OUT / "items.json").read_text(encoding="utf-8"))
    old_quality = json.loads((OUT / "quality.json").read_text(encoding="utf-8"))
    old = {r[0]: r for r in old_rows}
    lines = [r for r in old_rows if r[0] >= REALM_IDS]

    def row(item: int, name: str) -> list:
        inv, cls, sub = items.get(item, (0, 0, 0))
        icon = icon_of_item.get(item, "").lower()
        return [item, name, inv, armor_of(cls, sub, icon, name), icon]

    # The derivation must give back every realm row it already wrote, bar the name,
    # or these are not the files export_catalog.py read.
    drift = [i for i, r in old.items() if i < REALM_IDS and row(i, r[1]) != r]
    if drift:
        raise SystemExit("%d realm rows no longer derive from these files, e.g. %s" % (len(drift), drift[:5]))

    realm: dict[int, list] = {}
    for item, r in old.items():
        if item < REALM_IDS:
            realm[item] = row(item, table.get(item, r[1]))
    for item, name in table.items():
        if item < REALM_IDS and item not in realm:
            realm[item] = row(item, name)
    rows = [realm[i] for i in sorted(realm)] + lines

    # Quality meets the retail plans on the name, so realm entries are worked out again
    # with the corrected names; the retail lines' entries stay as they were.
    names = {i: r[1] for i, r in realm.items()}
    quality = {k: v for k, v in old_quality.items() if int(k) >= REALM_IDS}
    quality.update({str(k): v for k, v in read_qualities(sources[3:5], names).items()})
    quality = {k: quality[k] for k in sorted(quality, key=int)}

    renamed = [(i, old[i][1], realm[i][1]) for i in sorted(old) if i < REALM_IDS and old[i][1] != realm[i][1]]
    added = [i for i in realm if i not in old]
    print("table names %d; realm items %d -> %d (+%d), retail line items %d; renamed %d" % (
        len(table), len(old) - len(lines), len(realm), len(added), len(lines), len(renamed)))
    print("with slot %d -> %d; with icon %d -> %d; quality %d -> %d" % (
        sum(1 for r in old_rows if r[2]), sum(1 for r in rows if r[2]),
        sum(1 for r in old_rows if r[4]), sum(1 for r in rows if r[4]), len(old_quality), len(quality)))
    for i, before, after in renamed:
        print("  %d: %s -> %s" % (i, before, after))
    if not a.check:
        write("items.json", rows)
        write("quality.json", quality)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
