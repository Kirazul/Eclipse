"""Bake what the dressing room needs to draw a character from the game's public CDN.

    python tools/export_models.py --eclipse <path-to-eclipse-dev> --cache <folder>

Reads, never writes, the Eclipse tree:
    Eclipse/data/wardrobe/items.edb     item id -> model and texture names, geosets
    Eclipse/data/wardrobe/helmvis.edb   what a helm hides, by race
    re/out/hearth/listfile.csv          file name -> FileDataID
                                        (tools/texture_aliases.json adds the realm's renamed recolours)
    work/<line>/build/data/<line>_items.edb, <line>_helmvis.edb   a line's shipped keys
    work/<line>/inventory.json          a line's retail ItemDisplayInfo, file by file

--builds are tried in order. Every WoW product shares one CDN, and Mists of Pandaria
Classic holds the sharpest copies of the old art: 1024x1024 skins where live retail
still has the 512x512 originals. Retail fills in everything newer. Each build's root,
encoding table and archive indexes come through tools/lib/tact_cdn.py from the Eclipse
tree, cached in --cache (about 450 MB a build, and slow the first time).

Bodies are the HD ones, which only retail has. Their bones live in a .skel of nearly
20 MB, so the first frame of Stand is baked here and no browser downloads that file.

The overlay's retail lines (War Within, Midnight) come from retail's own tables, kept
in work/<line>/inventory.json, so each piece is the file retail draws for that race
and sex: helms, shoulders, and the "collection" models that are skinned to the body
the way a robe's skirt or a boot's cuff is. Their keys are the overlay's.

Writes public/dress/:
    bodies.json          "<race id>-<gender>" -> the files of a bare character
    poses/<key>.json     the same key -> that body's Stand pose and attachment points
    items/<n>.json       item id -> recipe, split by id % 128
    files/<n>.json       FileDataID -> [archive index, offset, size], or [encoded key] for
                         a file the CDN keeps on its own, split by id % 256
    manifest.json        the builds, and the archive names those indexes point into

No game file is written: a browser reads them from the CDN, by range, and decodes them.
"""
from __future__ import annotations

import argparse
import collections
from concurrent.futures import ThreadPoolExecutor
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "dress"
ITEMS = ROOT / "src" / "data" / "catalog" / "items.json"
# Realm texture name -> retail FileDataID, for names the listfile does not know.
ALIASES = ROOT / "tools" / "texture_aliases.json"
ITEM_SHARDS = 128
FILE_SHARDS = 256

# A .skel: its sequences, attachments and bones, with offsets from each chunk's start.
SEQUENCE_BYTES = 64
ATTACHMENT_BYTES = 40
BONE_BYTES = 88
STAND = 0
# A sequence with this flag lives in the .skel; without it, in a separate .anim file.
EMBEDDED = 0x20
PLACES = 5

# id, folder and file stem, and the two letters a head model's name carries.
RACES = [
    (1, "human", "hu"), (2, "orc", "or"), (3, "dwarf", "dw"), (4, "nightelf", "ni"), (5, "scourge", "sc"),
    (6, "tauren", "ta"), (7, "gnome", "gn"), (8, "troll", "tr"), (10, "bloodelf", "be"), (11, "draenei", "dr"),
]
SEXES = [(0, "male", "m"), (1, "female", "f")]

# ItemDisplayInfo's body textures, in row order, as character.ts names them.
REGIONS = ["armUpper", "armLower", "hand", "torsoUpper", "torsoLower", "legUpper", "legLower", "foot"]
INV_SHIELD = 14
INV_HEAD = 1
# A bow is held in the left hand; every other ranged weapon in the right.
INV_BOW = 15
# HelmetGeosetVisData's seven masks, as geoset groups (DisplayDb.cpp, the head handler).
HELM_GROUPS = [0, 1, 2, 3, 7, 16, 17]
EMBEDDED_ID = re.compile(r"_(\d{6,8})_")
BUILDS = ["5.5.4.70531", "12.1.5.70448"]
# export_catalog.py's LINES: folder, and the byte each of the line's keys carries.
LINES = {4: "warwithin", 3: "midnight"}
# ItemDisplayInfo.ModelType: 0 hangs from an attachment point, 1 is skinned to the body,
# 4 is what a cloak hangs on the back, a backpack or a quiver.
HUNG, SKINNED, ON_BACK = 0, 1, 4
# ItemDisplayInfo.Flags the geoset builder reads, as RetailGeo.h packs them.
KEEP_FOOT, CHEST_SLEEVES, GLOVE_SLEEVES = 0x100000, 0x1000000, 0x2000000
PAD_KEEP_FOOT, PAD_CHEST, PAD_GLOVE, PAD_KIND0, PAD_KIND1 = 1, 2, 4, 8, 16
INV_SHOULDER, INV_WAIST, INV_WRIST, INV_HANDS = 3, 6, 9, 10
INV_CLOAK = (16,)
WEAPONS = {13, 14, 15, 17, 21, 22, 23, 25, 26}
INDEX_READERS = 8
# An archive is 256 MB: a place past that means the index was misread.
ARCHIVE_LIMIT = 1 << 28


def read_listfile(path: Path):
    by_path: dict[str, int] = {}
    models: dict[str, str] = {}
    textures_near: dict[str, list[str]] = collections.defaultdict(list)
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            fdid, _, name = line.rstrip("\n").partition(";")
            if not fdid.isdigit():
                continue
            name = name.lower()
            by_path[name] = int(fdid)
            if name.startswith("item/objectcomponents/"):
                folder, _, base = name.rpartition("/")
                if base.endswith(".m2"):
                    models[base[:-3]] = name
                elif base.endswith(".blp"):
                    textures_near[folder].append(name)
    return by_path, models, textures_near


def read_items_edb(path: Path):
    d = path.read_bytes()
    magic, _, rows, stride, name_bytes = struct.unpack_from("<4sIIII", d, 0)
    assert magic == b"EIDB" and stride == 76, (magic, stride)
    names_at = 20 + rows * stride
    blob = d[names_at:names_at + name_bytes]

    def name(offset: int) -> str:
        if not offset:
            return ""
        return blob[offset:blob.find(b"\0", offset)].decode("latin1").lower().replace("\\", "/")

    out = {}
    for i in range(rows):
        at = 20 + i * stride
        item, display, model_l, model_r, tex_l, tex_r, *body = struct.unpack_from("<14I", d, at)
        if item in out:
            continue
        geoset = struct.unpack_from("<3H", d, at + 60)
        helm_m, helm_f = struct.unpack_from("<2H", d, at + 66)
        out[item] = {
            "model_l": name(model_l), "model_r": name(model_r), "tex_l": name(tex_l), "tex_r": name(tex_r),
            "body": [name(o) for o in body], "geoset": list(geoset), "helm": (helm_m, helm_f),
        }
    return out


def read_helmvis(path: Path) -> dict[int, tuple[int, ...]]:
    d = path.read_bytes()
    magic, _, rows, stride = struct.unpack_from("<4sIII", d, 0)
    assert magic == b"HGV1" and stride == 32, (magic, stride)
    out = {}
    for i in range(rows):
        row = struct.unpack_from("<8I", d, 16 + i * stride)
        out[row[0]] = row[1:]
    return out


class Files:
    """Name -> FileDataID, kept only when this build really holds the file."""

    def __init__(self, by_path, models, textures_near, root):
        self.by_path, self.models, self.textures_near, self.root = by_path, models, textures_near, root
        self.used: set[int] = set()
        # Files cut to fit a body, read from the build the bodies come from.
        self.fitted: set[int] = set()
        # Models the listfile names no .skin for; their own header says, once fetched.
        self.unskinned: set[int] = set()
        self._names: dict[int, str] | None = None

    def get(self, path: str) -> int | None:
        fdid = self.by_path.get(path)
        return fdid if fdid in self.root else None

    def use(self, fdid: int) -> int:
        self.used.add(fdid)
        return fdid

    def texture(self, path: str) -> int | None:
        hit = self.get(path)
        if hit is None:
            # The realm's converter writes a retail texture's FileDataID into its name.
            for found in EMBEDDED_ID.findall(path):
                if int(found) in self.root:
                    return self.use(int(found))
            return None
        return self.use(hit)

    def gendered(self, path: str) -> list[int] | None:
        """[male, female] for a body texture. A name ends in _u, _m or _f."""
        stem = path[:-6] if path[-6:-5] == "_" else path[:-4]
        pick = lambda sex: self.texture(f"{stem}_{sex}.blp")  # noqa: E731
        universal = pick("u") or self.texture(path)
        male, female = pick("m") or universal, pick("f") or universal
        if not male and not female:
            return None
        return [male or female, female or male]

    def model(self, path: str, fitted: bool = False) -> int | None:
        fdid = self.get(path)
        if fdid is None:
            return None
        self.use(fdid)
        stem = path[:-3]
        skin = self.get(f"{stem}00.skin")
        if skin is None:
            return None
        self.use(skin)
        if fitted:
            self.fitted.update((fdid, skin))
        # Most parts name their texture in the item row. Glows and trim are named in the
        # model, so anything beside it that shares its stem has to be findable too.
        folder, _, base = stem.rpartition("/")
        prefix = base.rsplit("_", 1)[0] if base[-3:-1].isalpha() and base[-4] == "_" else base
        for near in self.textures_near.get(folder, ()):
            if near.rpartition("/")[2].startswith(prefix):
                hit = self.get(near)
                if hit is not None:
                    self.use(hit)
        return fdid

    def model_id(self, fdid: int, fitted: bool) -> int | None:
        """A model retail names by FileDataID, with its .skin and the textures beside it."""
        if fdid not in self.root:
            return None
        if self._names is None:
            self._names = {v: k for k, v in self.by_path.items()}
        path = self._names.get(fdid, "")
        if path.endswith(".m2") and self.model(path, fitted) == fdid:
            return fdid
        # Unnamed, or named without a .skin beside it: its header names the skin.
        self.use(fdid)
        self.unskinned.add(fdid)
        if fitted:
            self.fitted.add(fdid)
        return fdid

    def texture_id(self, fdid: int) -> int | None:
        return self.use(fdid) if fdid in self.root else None


def strip_ext(name: str) -> str:
    return re.sub(r"\.(mdx|m2|mdl)$", "", name.rpartition("/")[2])


def recipe(row: dict, inv: int, files: Files, helmvis: dict) -> dict:
    out: dict = {}
    missing = 0
    if any(row["geoset"]):
        # Stored unsigned: 65535 is retail's -1.
        out["geosets"] = [signed16(v) for v in row["geoset"]]

    body = {}
    for region, path in zip(REGIONS, row["body"]):
        if not path:
            continue
        hit = files.gendered(path)
        if hit:
            body[region] = hit
        else:
            missing += 1
    if body:
        out["body"] = body

    for key, path in (("texture", row["tex_l"]), ("textureRight", row["tex_r"])):
        if path:
            hit = files.texture(path)
            if hit:
                out[key] = hit
            else:
                missing += 1

    if inv == INV_HEAD and row["model_l"]:
        stem = strip_ext(row["model_l"])
        heads = {}
        for _, _, code in RACES:
            for _, _, sex in SEXES:
                # Older heads end _hum; collection heads end _hu_m.
                path = files.models.get(f"{stem}_{code}{sex}") or files.models.get(f"{stem}_{code}_{sex}")
                # Mists keeps each helm cut for the old heads; retail recut the same
                # FileDataIDs for the HD heads drawn here.
                hit = files.model(path, fitted=True) if path else None
                if hit:
                    heads[f"{code}{sex}"] = hit
        if heads:
            out["model"] = heads
        else:
            missing += 1
        masks = [helmvis.get(i) for i in row["helm"]]
        if any(masks):
            out["hides"] = [
                [[group for group, mask in zip(HELM_GROUPS, row_masks) if mask & (1 << race)] for race, _, _ in RACES]
                if row_masks else [[] for _ in RACES]
                for row_masks in masks
            ]
    else:
        for key, name in (("model", row["model_l"]), ("modelRight", row["model_r"])):
            if name:
                path = files.models.get(strip_ext(name))
                hit = files.model(path) if path else None
                if hit:
                    out[key] = hit
                else:
                    missing += 1
    if inv == INV_SHIELD:
        out["shield"] = True
    if inv == INV_BOW:
        out["bow"] = True
    if missing:
        out["incomplete"] = True
    return out


def signed16(value: int) -> int:
    return value - 0x10000 if value >= 0x8000 else value


WEARERS = [(race, gender, f"{code}{sex}") for race, _, code in RACES for gender, _, sex in SEXES]


def pick(entries: list[dict], race: int, gender: int) -> int | None:
    """The file retail gives one wearer: its own race before every race (0), its own sex
    before either, and a class's variant only when there is nothing for every class."""
    def rank(e: dict):
        # Sex 0 is male and 1 female; -1, 2 and 3 are either.
        if e["race"] not in (0, race) or e["gender"] in (0, 1) and e["gender"] != gender:
            return None
        return (e.get("class", 0) != 0, e["race"] != race, e["gender"] not in (0, 1))

    ranked = sorted((r, e["fdid"]) for e in entries if (r := rank(e)) is not None)
    return ranked[0][1] if ranked else None


def per_wearer(entries: list[dict], resolve) -> tuple[int | dict | None, bool]:
    """One file for everyone, or one per wearer as "hum", "bef" and so on. Also whether
    no wearer has one, though retail names files: a wearer left out of a map is told so
    in the browser (recipe.ts), since a race's own armour fits only that race."""
    out = {}
    for race, gender, key in WEARERS:
        fdid = pick(entries, race, gender)
        hit = resolve(fdid) if fdid else None
        if hit:
            out[key] = hit
    if not out:
        return None, bool(entries)
    values = set(out.values())
    return (values.pop() if len(values) == 1 and len(out) == len(WEARERS) else out), False


def pad_bits(flags: int, model_types: list[int]) -> int:
    """RetailGeo.h's pad byte (tools/races/races_itemgeo.py pad_bits in the overlay)."""
    p = 0
    if flags & KEEP_FOOT:
        p |= PAD_KEEP_FOOT
    if flags & CHEST_SLEEVES:
        p |= PAD_CHEST
    if flags & GLOVE_SLEEVES:
        p |= PAD_GLOVE
    if model_types[0] in (0, 1) or model_types[0] >= 5:
        p |= PAD_KIND0
    if model_types[1] == 1:
        p |= PAD_KIND1
    return p


def line_recipe(key: int, display: dict, inv: int, files: Files, helmvis: dict) -> dict:
    """A retail line's piece, from the retail rows the overlay converted it from."""
    ids = display["row"]
    out: dict = {}
    missing = False
    geosets = [int(ids[f"GeosetGroup_{i}"]) for i in range(6)]
    while geosets and not geosets[-1]:
        geosets.pop()
    if geosets:
        out["geosets"] = geosets
    model_types = [int(ids["ModelType_0"]), int(ids["ModelType_1"])]
    pad = pad_bits(int(ids["Flags"]), model_types)
    if inv not in (INV_WRIST, INV_HANDS):
        # Only the wrist rule reads what kind each model is.
        pad &= ~(PAD_KIND0 | PAD_KIND1)
    if pad:
        out["pad"] = pad

    body = {}
    for section, region in enumerate(REGIONS):
        entries = [e for e in display.get("sections", ()) if e["section"] == section]
        if not entries:
            continue
        pair = [pick(entries, 0, gender) for gender in (0, 1)]
        pair = [files.texture_id(fdid) if fdid else None for fdid in pair]
        if not any(pair):
            missing = True
            continue
        body[region] = [pair[0] or pair[1], pair[1] or pair[0]]
    if body:
        out["body"] = body

    def texture_of(k: int):
        entries = [e for e in display.get("model_tex", ()) if e["k"] == k and e.get("usage", 0) == 0]
        return per_wearer(entries, files.texture_id)[0] if entries else None

    skinned = []
    for k in (0, 1):
        entries = [m for m in display.get("models", ()) if m["k"] == k]
        if not entries:
            continue
        kind = model_types[k]
        if kind == SKINNED:
            model, short = per_wearer(entries, lambda fdid: files.model_id(fdid, fitted=True))
            missing |= short
            if model:
                piece = {"model": model}
                texture = texture_of(k)
                if texture:
                    piece["texture"] = texture
                skinned.append(piece)
            continue
        if kind == ON_BACK and inv in INV_CLOAK:
            model, short = per_wearer(entries, lambda fdid: files.model_id(fdid, fitted=False))
            names = ("modelBack", "textureBack")
        elif kind != HUNG:
            missing = True
            continue
        elif inv == INV_SHOULDER:
            # Each of the two holds both shoulders: position 0 the left, 1 the right.
            side = [m for m in entries if m.get("pos", -1) in (k, -1)] or entries
            model, short = per_wearer(side, lambda fdid: files.model_id(fdid, fitted=True))
            names = ("model", "texture") if k == 0 else ("modelRight", "textureRight")
        elif k == 0 and (inv == INV_HEAD or inv == INV_WAIST or inv in WEAPONS):
            # A helm is cut for each head; a weapon or a buckle fits anyone.
            model, short = per_wearer(entries, lambda fdid: files.model_id(fdid, fitted=inv == INV_HEAD))
            names = ("model", "texture")
        else:
            missing = True
            continue
        missing |= short
        if model:
            out[names[0]] = model
            texture = texture_of(k)
            if texture:
                out[names[1]] = texture
        else:
            missing = True
    if skinned:
        out["skinned"] = skinned
    if inv in INV_CLOAK and "texture" not in out:
        # The body's own cloak geosets wear the cloak's texture, with or without a 3D cape.
        texture = texture_of(0)
        if texture:
            out["texture"] = texture

    if inv == INV_HEAD:
        # The line's helm-visibility rows are keyed as its items are.
        vis = [int(ids[f"HelmetGeosetVis_{i}"]) for i in (0, 1)]
        masks = [helmvis.get((key >> 24 << 24) | v) if v else None for v in vis]
        if any(masks):
            out["hides"] = [
                [[group for group, mask in zip(HELM_GROUPS, row_masks) if mask & (1 << race)] for race, _, _ in RACES]
                if row_masks else [[] for _ in RACES]
                for row_masks in masks
            ]
    if inv == INV_SHIELD:
        out["shield"] = True
    if inv == INV_BOW:
        out["bow"] = True
    if missing:
        out["incomplete"] = True
    return out


def chunks(data: bytes) -> dict[bytes, int]:
    """Where each chunk's contents start."""
    out, at = {}, 0
    while at + 8 <= len(data):
        size = struct.unpack_from("<I", data, at + 4)[0]
        out[data[at:at + 4]] = at + 8
        at += 8 + size
    return out


def quat_part(value: int) -> float:
    return (value + 32768 if value < 0 else value - 32767) / 32767


def stand_pose(data: bytes, sequences: tuple, bones_of: tuple, points: tuple) -> dict:
    """The first frame of Stand. Rows are read back by readPose in pose.ts.

    Each argument starts with the base its offsets count from: a .skel's chunk, or the
    model. Then its count and offset, and for points the lookup's count and offset too.
    """
    sequences_at, count, at = sequences
    stand = next(
        i for i in range(count)
        if struct.unpack_from("<H", data, sequences_at + at + i * SEQUENCE_BYTES)[0] == STAND
        and struct.unpack_from("<I", data, sequences_at + at + i * SEQUENCE_BYTES + 12)[0] & EMBEDDED
    )
    bones_at = bones_of[0]

    def first_key(track: int) -> int | None:
        runs, table = struct.unpack_from("<II", data, track + 12)
        if stand >= runs:
            return None
        keys, values = struct.unpack_from("<II", data, bones_at + table + stand * 8)
        return bones_at + values if keys else None

    def row(*values) -> list:
        return [round(v, PLACES) for v in values]

    _, count, at = bones_of
    bones = []
    for i in range(count):
        bone = bones_at + at + i * BONE_BYTES
        moved, turned, sized = first_key(bone + 16), first_key(bone + 36), first_key(bone + 56)
        rotation = [quat_part(v) for v in struct.unpack_from("<4h", data, turned)] if turned else [0, 0, 0, 1]
        bones.append(row(
            struct.unpack_from("<h", data, bone + 8)[0],
            *struct.unpack_from("<3f", data, bone + 76),
            *(struct.unpack_from("<3f", data, moved) if moved else (0, 0, 0)),
            *rotation,
            *(struct.unpack_from("<3f", data, sized) if sized else (1, 1, 1)),
        ) + [
            # The bone's name hash, which a skinned piece's own bones are matched on.
            struct.unpack_from("<I", data, bone + 12)[0],
        ])

    points_at, count, at, lookups, lookup_at = points
    attachments = {}
    for point in range(lookups):
        index = struct.unpack_from("<h", data, points_at + lookup_at + point * 2)[0]
        if 0 <= index < count:
            entry = points_at + at + index * ATTACHMENT_BYTES
            attachments[str(point)] = row(
                struct.unpack_from("<H", data, entry + 4)[0], *struct.unpack_from("<3f", data, entry + 8),
            )
    return {"bones": bones, "attachments": attachments}


def skel_pose(skel: bytes) -> dict:
    parts = chunks(skel)
    bones_at, sequences_at, points_at = parts[b"SKB1"], parts[b"SKS1"], parts[b"SKA1"]
    return stand_pose(
        skel,
        (sequences_at, *struct.unpack_from("<2I", skel, sequences_at + 8)),
        (bones_at, *struct.unpack_from("<2I", skel, bones_at)),
        (points_at, *struct.unpack_from("<4I", skel, points_at)),
    )


def model_pose(m2: bytes) -> dict:
    """Trolls alone keep their skeleton in the model, laid out as a .skel lays it out."""
    base = chunks(m2)[b"MD21"]
    pair = lambda at: struct.unpack_from("<2I", m2, base + at)  # noqa: E731
    return stand_pose(m2, (base, *pair(0x1c)), (base, *pair(0x2c)), (base, *pair(0xf0), *pair(0xf8)))


def body_poses(tact_cdn, build: str, bodies: dict) -> dict:
    models = tact_cdn.fetch([body["model"] for body in bodies.values()], build)
    poses, skeletons = {}, {}
    for key, body in bodies.items():
        m2 = models[body["model"]]
        parts = chunks(m2)
        if b"SKID" in parts:
            skeletons[key] = struct.unpack_from("<I", m2, parts[b"SKID"])[0]
        else:
            poses[key] = model_pose(m2)
    skels = tact_cdn.fetch(sorted(set(skeletons.values())), build)
    return poses | {key: skel_pose(skels[skeleton]) for key, skeleton in skeletons.items()}


def skins_of(tact_cdn, build: str, files: Files) -> None:
    """The .skin, and the textures, of each model the listfile could not pair with one,
    read from the model's own SFID and TXID chunks. A model with no skin is dropped from
    nothing: the browser reports the piece it cannot draw."""
    wanted = sorted(files.unskinned)
    if not wanted:
        return
    found = 0
    for at in range(0, len(wanted), 64):
        for fdid, m2 in tact_cdn.fetch(wanted[at:at + 64], build).items():
            parts = chunks(m2)
            if b"SFID" in parts:
                skin = struct.unpack_from("<I", m2, parts[b"SFID"])[0]
                if skin in files.root:
                    files.use(skin)
                    if fdid in files.fitted:
                        files.fitted.add(skin)
                    found += 1
            if b"TXID" in parts:
                size = struct.unpack_from("<I", m2, parts[b"TXID"] - 4)[0]
                for texture in struct.unpack_from(f"<{size // 4}I", m2, parts[b"TXID"]):
                    if texture in files.root:
                        files.use(texture)
    print(f"skins read from {found} of {len(wanted)} unnamed models", flush=True)


def body_files(files: Files) -> dict:
    out = {}
    for race, folder, _ in RACES:
        eyes = re.compile(rf"character/{folder}/eyes00_00_\d+\.blp")
        eye_paths = [path for path in files.by_path if eyes.fullmatch(path)]
        for gender, sex_name, _ in SEXES:
            base = f"character/{folder}/{sex_name}/{folder}{sex_name}"
            # Night Elf females name their textures nightelf_female, though not their model.
            spaced = f"character/{folder}/{sex_name}/{folder}_{sex_name}"
            textures = {
                "skin": "skin00_00_hd.blp", "face": "faceupper00_00_hd.blp",
                "pelvis": "nakedpelvisskin00_00_hd.blp",
            }
            if gender:
                textures["torso"] = "nakedtorsoskin00_00_hd.blp"
            entry = {}
            model = files.model(base + "_hd.m2")
            if model:
                entry["model"] = model
            for key, name in textures.items():
                fdid = files.texture(base + name) or files.texture(spaced + name)
                if fdid:
                    entry[key] = fdid
            for key, path in (("hair", f"character/{folder}/hair00_00.blp"), ("eyes", eye_paths[0] if eye_paths else "")):
                fdid = files.texture(path)
                if fdid:
                    entry[key] = fdid
            if "model" in entry and "skin" in entry:
                entry["hairstyle"] = 2
                out[f"{race}-{gender}"] = entry
    return out


def write_shards(folder: Path, rows: dict, shards: int) -> int:
    folder.mkdir(parents=True, exist_ok=True)
    buckets: dict[int, dict] = collections.defaultdict(dict)
    for key, value in rows.items():
        buckets[int(key) % shards][key] = value
    total = 0
    for n, bucket in buckets.items():
        text = json.dumps(bucket, separators=(",", ":"), sort_keys=True)
        (folder / f"{n}.json").write_text(text, encoding="utf8")
        total += len(text)
    return total


def open_cdn(eclipse: Path, cache: Path):
    """The overlay's TACT client, with its cache moved out of that read-only tree."""
    sys.path.insert(0, str(eclipse / "tools" / "lib"))
    import tact_cdn  # noqa: PLC0415

    def cache_dir(build: str) -> str:
        path = cache / build
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    tact_cdn.cache_dir = cache_dir
    return tact_cdn


def place_build(tact_cdn, build: str, keys: dict[int, str]):
    """The FileDataIDs one build serves -> (archive name, offset, size)."""
    T = tact_cdn.T
    cache = tact_cdn.cache_dir(build)
    encoded = T.encoding_lookup(tact_cdn._encoding(build), set(keys.values()))
    row = tact_cdn._build_row(build)
    config = T.config(tact_cdn.PATH, row.get("cdn_config") or row["product_config"], cache)
    want = {bytes.fromhex(e[:32]) for e in encoded.values()}

    def read_index(archive: str):
        return archive, T.cdn(tact_cdn.PATH, "data", archive + ".index", cache=cache)

    found: dict[bytes, tuple[str, int, int]] = {}
    with ThreadPoolExecutor(INDEX_READERS) as pool:
        for n, (archive, data) in enumerate(pool.map(read_index, config["archives"])):
            if data is None:
                continue
            for block in range((len(data) - 28) // 4096 + 1):
                chunk = data[block * 4096:(block + 1) * 4096]
                for at in range(0, 4096 - 23, 24):
                    key = chunk[at:at + 16]
                    # The first hit only. An index ends with a table of contents that
                    # repeats some keys beside unrelated bytes, and those must not win.
                    if key in want and key not in found:
                        size, offset = struct.unpack(">II", chunk[at + 16:at + 24])
                        assert 0 < size and offset + size <= ARCHIVE_LIMIT, (archive, key.hex(), offset, size)
                        found[key] = (archive, offset, size)
            if n % 200 == 0:
                print(f"  {build}: index {n}/{len(config['archives'])}, {len(found)}/{len(want)} placed", flush=True)

    placed = {}
    for fdid, content in keys.items():
        encoded_key = encoded.get(content)
        if not encoded_key:
            continue
        hit = found.get(bytes.fromhex(encoded_key[:32]))
        if hit:
            placed[fdid] = hit
        else:
            # Large files, a body among them, are not in any archive.
            e = encoded_key[:32]
            head = T.get(f"{T.HOST}/{tact_cdn.PATH}/data/{e[:2]}/{e[2:4]}/{e}", rng=(0, 3))
            if head and head[:4] == b"BLTE":
                placed[fdid] = (e,)
    return placed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--eclipse", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--builds", nargs="+", default=BUILDS, help="the best source first")
    args = parser.parse_args()

    tact_cdn = open_cdn(args.eclipse, args.cache)
    roots = [tact_cdn.root_map(build) for build in args.builds]
    # An earlier build wins, so write them last-first.
    root: dict[int, str] = {}
    for one in reversed(roots):
        root.update(one)

    wardrobe = args.eclipse / "Eclipse" / "data" / "wardrobe"
    by_path, models, textures_near = read_listfile(args.eclipse / "re" / "out" / "hearth" / "listfile.csv")
    # The realm renamed many retail recolours; tools/match_textures.py found each one's
    # retail file by its pixels. The listfile's own name wins where both exist.
    for name, fdid in json.loads(ALIASES.read_text(encoding="utf8")).items():
        by_path.setdefault(name, fdid)
    files = Files(by_path, models, textures_near, root)
    rows = read_items_edb(wardrobe / "items.edb")
    helmvis = read_helmvis(wardrobe / "helmvis.edb")

    lines = {}
    for key_byte, folder in LINES.items():
        built = args.eclipse / "work" / folder / "build" / "data"
        shipped = read_items_edb(built / f"{folder}_items.edb")
        displays = json.loads((args.eclipse / "work" / folder / "inventory.json").read_text(encoding="utf8"))["displays"]
        lines[key_byte] = (shipped, displays, read_helmvis(built / f"{folder}_helmvis.edb"))

    recipes, state = {}, collections.Counter()
    for item, _name, inv, *_ in json.loads(ITEMS.read_text(encoding="utf8")):
        if item >> 24:
            shipped, displays, line_helmvis = lines[item >> 24]
            display = displays.get(str(item & 0xFFFFFF)) if item in shipped else None
            row = display if display and "row" in display else None
            made = line_recipe(item, row, inv, files, line_helmvis) if row else {}
        else:
            row = rows.get(item)
            made = recipe(row, inv, files, helmvis) if row else {}
        if not row or not ({"body", "model", "texture", "skinned", "modelBack"} & made.keys()):
            state["nothing to draw"] += 1
            continue
        state["incomplete" if made.get("incomplete") else "complete"] += 1
        recipes[str(item)] = made

    skins_of(tact_cdn, args.builds[-1], files)

    bodies = body_files(files)
    assert len(bodies) == len(RACES) * len(SEXES), sorted(bodies)
    for key, body in sorted(bodies.items()):
        print(key, "has", " ".join(sorted(set(body) - {"hairstyle"})), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "bodies.json").write_text(json.dumps(bodies, separators=(",", ":"), sort_keys=True), encoding="utf8")
    (OUT / "poses").mkdir(exist_ok=True)
    for key, pose in body_poses(tact_cdn, args.builds[-1], bodies).items():
        (OUT / "poses" / f"{key}.json").write_text(json.dumps(pose, separators=(",", ":")), encoding="utf8")
    size = write_shards(OUT / "items", recipes, ITEM_SHARDS)
    print(f"{dict(state)}; {len(bodies)} bodies; recipes {size >> 10} KB; {len(files.used)} files", flush=True)

    # A file is read from the first build that has it, with that build's exact bytes,
    # except a fitted one, which the bodies' build serves first when it has it.
    placed: dict[int, tuple] = {}
    bodies_build = roots[-1]
    for build, one in zip(args.builds, roots):
        wanted = files.used - placed.keys()
        if one is not bodies_build:
            wanted -= files.fitted & bodies_build.keys()
        keys = {fdid: one[fdid] for fdid in wanted if fdid in one}
        got = place_build(tact_cdn, build, keys)
        placed.update(got)
        print(f"{build}: placed {len(got)} of {len(keys)} files", flush=True)

    archives = sorted({place[0] for place in placed.values() if len(place) == 3})
    number = {archive: i for i, archive in enumerate(archives)}
    table = {str(fdid): [number[place[0]], place[1], place[2]] if len(place) == 3 else [place[0]] for fdid, place in placed.items()}
    size = write_shards(OUT / "files", table, FILE_SHARDS)
    (OUT / "manifest.json").write_text(json.dumps({"builds": args.builds, "archives": archives}, separators=(",", ":")), encoding="utf8")
    print(f"placed {len(placed)}/{len(files.used)} files across {len(archives)} archives; table {size >> 10} KB; unplaced e.g. {sorted(files.used - placed.keys())[:6]}")


if __name__ == "__main__":
    main()
