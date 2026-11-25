"""Bake the art the site shows that does not come from the item catalogue.

    python tools/export_site_assets.py --eclipse <path-to-eclipse-dev>

Reads, never writes:
    <eclipse>/references/narcissus hexagon rings and studio backdrops
    <upstream>/site, with --upstream: what the retired GitHub Pages site held.
        That copy is done and committed here, so this is only for a re-import.

Fetches from wow.zamimg.com:
    the real inventory-slot textures, class crests, race portraits, and the
    spell and ability icons that stand for a feature.

Writes:
    public/assets/img/*            the official page's images, unchanged
    public/wow/slots|classes|races|ui/<name>.jpg
    public/wow/rings/<quality>.png Narcissus rings, TGA to PNG, pixels unchanged
    public/wow/backdrops/<name>.jpg  Narcissus backdrops, bytes unchanged
    src/app/fonts/*.woff2, src/app/favicon.ico, src/data/wallets.json
    src/data/backdrops.json        the backdrop names

The rings and backdrops are CC BY-NC-SA 4.0, Peterodox, used with the author's
agreement: see references/narcissus/NOTICE.txt. Credit them where they appear.

Existing files are kept, so a re-run fetches only what is missing.
"""
from __future__ import annotations

import argparse
import json
import shutil
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
WOW = PUBLIC / "wow"
CDN = "https://wow.zamimg.com/images/wow/icons/large"

SLOTS = ["head", "neck", "shoulder", "shirt", "chest", "waist", "legs", "feet", "wrists",
         "hands", "finger", "trinket", "mainhand", "offhand", "ranged", "tabard"]
CLASSES = ["deathknight", "druid", "hunter", "mage", "paladin",
           "priest", "rogue", "shaman", "warlock", "warrior"]
# The icon's race word, where it differs from the site's key. "harronir" is
# Blizzard's own spelling of the file.
RACES = {
    "human": "human", "orc": "orc", "dwarf": "dwarf", "nightelf": "nightelf",
    "undead": "scourge", "tauren": "tauren", "gnome": "gnome", "troll": "troll",
    "goblin": "goblin", "bloodelf": "bloodelf", "draenei": "draenei", "worgen": "worgen",
    "pandaren": "pandaren", "nightborne": "nightborne",
    "highmountain": "highmountaintauren", "voidelf": "voidelf",
    "lightforged": "lightforgeddraenei", "zandalari": "zandalaritroll",
    "kultiran": "kultiran", "darkiron": "darkirondwarf", "vulpera": "vulpera",
    "maghar": "magharorc", "mechagnome": "mechagnome", "dracthyr": "dracthyr",
    "earthen": "earthendwarf", "haranir": "harronir",
}
# What stands for a game concept that has no item of its own: a morph, a mount,
# an enchant, an incarnation, a spell visual, a title, a 3D effect, nothing known.
UI = ["inv_misc_questionmark", "ability_mount_ridinghorse", "spell_nature_polymorph",
      "trade_engraving", "ability_druid_treeoflife", "spell_arcane_arcane03",
      "inv_scroll_11", "spell_holy_divineillumination"]
RINGS = {"white": "", "uncommon": "Uncommon", "rare": "Rare", "epic": "Epic",
         "legendary": "Legendary", "heirloom": "Heirloom", "artifact": "Artifact"}


def fetch(icon: str, target: Path) -> bool:
    if target.exists():
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(f"{CDN}/{icon}.jpg", headers={"User-Agent": "eclipse-web"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            target.write_bytes(response.read())
    except OSError as error:
        print(f"  missing {icon}: {error}")
        return False
    return True


def copy_site(upstream: Path) -> None:
    site = upstream / "site"
    images = PUBLIC / "assets" / "img"
    images.mkdir(parents=True, exist_ok=True)
    for f in (site / "assets" / "img").iterdir():
        shutil.copy2(f, images / f.name)
    fonts = ROOT / "src" / "app" / "fonts"
    fonts.mkdir(parents=True, exist_ok=True)
    for f in (site / "assets" / "fonts").iterdir():
        shutil.copy2(f, fonts / f.name)
    shutil.copy2(site / "favicon.ico", ROOT / "src" / "app" / "favicon.ico")
    shutil.copy2(site / "assets" / "wallets.json", ROOT / "src" / "data" / "wallets.json")


def bake_narcissus(eclipse: Path) -> None:
    ref = eclipse / "references" / "narcissus"
    rings = WOW / "rings"
    rings.mkdir(parents=True, exist_ok=True)
    for name, tga in RINGS.items():
        source = ref / "Border" / f"HexagonBorder{'-' + tga if tga else ''}.tga"
        Image.open(source).convert("RGBA").save(rings / f"{name}.png", optimize=True)
    backdrops = WOW / "backdrops"
    backdrops.mkdir(parents=True, exist_ok=True)
    names = []
    for f in sorted((ref / "Backdrops").glob("*.jpg")):
        target = f.name.lower().replace(" ", "_")
        shutil.copy2(f, backdrops / target)
        names.append(target.removesuffix(".jpg"))
    (ROOT / "src" / "data" / "backdrops.json").write_text(json.dumps(names), encoding="utf-8")
    print(f"rings {len(RINGS)}  backdrops {len(names)}")


def bake_game_art() -> None:
    missing = 0
    for slot in SLOTS:
        missing += not fetch(f"inventoryslot_{slot}", WOW / "slots" / f"{slot}.jpg")
    for name in CLASSES:
        missing += not fetch(f"classicon_{name}", WOW / "classes" / f"{name}.jpg")
    for key, word in RACES.items():
        for sex in ("male", "female"):
            missing += not fetch(f"race_{word}_{sex}", WOW / "races" / f"{key}_{sex}.jpg")
    for icon in UI:
        missing += not fetch(icon, WOW / "ui" / f"{icon}.jpg")
    print(f"game art done, {missing} missing")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--eclipse", required=True, type=Path)
    ap.add_argument("--upstream", type=Path)
    a = ap.parse_args()
    if a.upstream:
        copy_site(a.upstream)
    bake_narcissus(a.eclipse)
    bake_game_art()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
