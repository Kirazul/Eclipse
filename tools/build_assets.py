"""
build_assets.py - every image the site serves, generated from two sources.

    source/keyart-eclipse.png     "Threads of Destiny" wallpaper, World of
                                  Warcraft: The War Within, 3840 x 2160, from
                                  the Blizzard press center
                                  (blizzard.gamespress.com), with the corner
                                  logo lockup painted out
    source/logo.png               the Eclipse emblem, 1254 x 1254 RGBA

Nothing in site/assets/img is edited by hand. Change a number here and run:

    python tools/build_assets.py

WHY THE BACKGROUND WIDTHS ARE WHAT THEY ARE
-------------------------------------------
The art is 16:9 and covers the first screen, so its rendered width is
max(viewport width, viewport height * 16/9). The page draws it 1.06x larger
than that so its slow zoom has room to move, and tells the browser exactly:

    sizes="max(106vw, 188.44vh)"

so every screen downloads the smallest file that is still at least 1:1. The
ladder stops at 3840 because that is the source; a 4K screen at the deepest
point of the zoom scales it by 1.06 at most.

A phone held upright is the opposite case. Height-bound, the landscape art
would be a sliver of a very large file. So narrow screens get their own crop,
centred on the eclipse, with its own ladder and its own sizes expression.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source")
OUT = os.path.join(ROOT, "site", "assets", "img")

KEYART = os.path.join(SRC, "keyart-eclipse.png")
LOGO = os.path.join(SRC, "logo.png")

# Landscape ladder. Each step is roughly 1.35x the last, which keeps the
# overshoot the browser accepts under ~35% at every screen size.
WIDE_WIDTHS = [960, 1440, 1920, 2560, 3200, 3840]

# Portrait crop for screens taller than they are wide: aspect 0.62, centred
# on Xal'atath and the eclipse behind her. 1339 px is the crop's full width.
TALL_ASPECT = 0.62
TALL_CENTER_X = 0.50
TALL_WIDTHS = [640, 960, 1339]

AVIF_QUALITY = 58
WEBP_QUALITY = 80


def save_pair(im: Image.Image, stem: str) -> dict:
    """Write stem.avif and stem.webp, return their sizes in bytes."""
    sizes = {}
    avif = os.path.join(OUT, stem + ".avif")
    im.save(avif, "AVIF", quality=AVIF_QUALITY, speed=4)
    sizes["avif"] = os.path.getsize(avif)
    webp = os.path.join(OUT, stem + ".webp")
    im.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
    sizes["webp"] = os.path.getsize(webp)
    return sizes


def lqip(im: Image.Image, width: int) -> str:
    """A tiny blurred JPEG as a data URI - painted before any request lands."""
    h = max(1, round(width * im.height / im.width))
    small = im.resize((width, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    small.save(buf, "JPEG", quality=62, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def build_background(report: dict) -> None:
    art = Image.open(KEYART).convert("RGB")
    W, H = art.size
    report["keyart"] = {"width": W, "height": H, "aspect": round(W / H, 5)}

    for w in WIDE_WIDTHS:
        h = round(w * H / W)
        report.setdefault("wide", {})[w] = save_pair(
            art.resize((w, h), Image.LANCZOS), f"bg-wide-{w}")

    cw = round(H * TALL_ASPECT)
    cx = round(W * TALL_CENTER_X)
    left = min(max(0, cx - cw // 2), W - cw)
    tall = art.crop((left, 0, left + cw, H))
    for w in TALL_WIDTHS:
        h = round(w * tall.height / tall.width)
        report.setdefault("tall", {})[w] = save_pair(
            tall.resize((w, h), Image.LANCZOS), f"bg-tall-{w}")

    report["lqip_wide"] = lqip(art, 32)
    report["lqip_tall"] = lqip(tall, 16)
    report["tall_aspect"] = round(tall.width / tall.height, 5)


def trimmed_logo() -> Image.Image:
    """The emblem on a square canvas with its glow intact and no dead border."""
    logo = Image.open(LOGO).convert("RGBA")
    box = logo.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
    logo = logo.crop(box)
    side = max(logo.size)
    pad = round(side * 0.02)
    canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    canvas.paste(logo, ((canvas.width - logo.width) // 2,
                        (canvas.height - logo.height) // 2), logo)
    return canvas


def build_logo(report: dict) -> Image.Image:
    logo = trimmed_logo()
    for w in (320, 640, 1080):
        im = logo.resize((w, w), Image.LANCZOS)
        im.save(os.path.join(OUT, f"logo-{w}.avif"), "AVIF", quality=70, speed=4)
        im.save(os.path.join(OUT, f"logo-{w}.webp"), "WEBP", quality=88, method=6)
    logo.resize((640, 640), Image.LANCZOS).save(
        os.path.join(OUT, "logo-640.png"), optimize=True)
    # Favicons and install icons.
    for s in (32, 180, 192, 512):
        logo.resize((s, s), Image.LANCZOS).save(
            os.path.join(OUT, f"icon-{s}.png"), optimize=True)
    logo.resize((256, 256), Image.LANCZOS).save(
        os.path.join(ROOT, "site", "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    report["logo_side"] = logo.width
    return logo


def build_social(logo: Image.Image) -> None:
    """1200 x 630 Open Graph card: the art, darkened, with the emblem and name."""
    art = Image.open(KEYART).convert("RGB")
    W, H = 1200, 630
    scale = max(W / art.width, H / art.height)
    im = art.resize((round(art.width * scale), round(art.height * scale)), Image.LANCZOS)
    x0 = round((im.width - W) * 0.5)
    im = im.crop((x0, 0, x0 + W, H)).convert("RGBA")

    # The same shade as the page's hero: the page colour, strongest at the
    # edges, so the type sits on the art the way it does on the site.
    shade = Image.new("RGBA", (W, H))
    d = ImageDraw.Draw(shade)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(20, 20, 19, int(150 + 80 * abs(t - 0.45) * 2)))
    im = Image.alpha_composite(im, shade)

    em = logo.resize((96, 96), Image.LANCZOS)
    im.alpha_composite(em, ((W - 96) // 2, 150))

    draw = ImageDraw.Draw(im)
    title = ImageFont.truetype(os.path.join(SRC, "Newsreader.ttf"), 92)
    title.set_variation_by_axes([400])
    sub = ImageFont.truetype(os.path.join(SRC, "Inter.ttf"), 30)
    sub.set_variation_by_axes([14, 400])

    def centred(text, font, y, fill):
        w = draw.textlength(text, font=font)
        draw.text(((W - w) / 2, y), text, font=font, fill=fill)

    centred("Eclipse", title, 268, (250, 249, 245, 255))
    centred("A free wardrobe for World of Warcraft 3.3.5a", sub, 392,
            (214, 211, 202, 255))
    im.convert("RGB").save(os.path.join(OUT, "og-image.jpg"), quality=88,
                           optimize=True, progressive=True)


def build_qr(report: dict) -> None:
    """One SVG QR per wallet - scanned from a phone, never retyped."""
    try:
        import segno
    except ImportError:
        sys.exit("segno is required: pip install segno")
    with open(os.path.join(ROOT, "site", "assets", "wallets.json"), encoding="utf-8") as f:
        wallets = json.load(f)
    for w in wallets:
        qr = segno.make(w["address"], error="m")
        buf = io.BytesIO()
        qr.save(buf, kind="svg", scale=1, border=2, dark="#0b1016", light="#ffffff",
                xmldecl=False, svgns=True, omitsize=True, nl=False)
        with open(os.path.join(OUT, f"qr-{w['id']}.svg"), "wb") as f:
            f.write(buf.getvalue())
    report["qr"] = [w["id"] for w in wallets]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    report: dict = {}
    build_background(report)
    logo = build_logo(report)
    build_social(logo)
    build_qr(report)
    with open(os.path.join(ROOT, "tools", "assets-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    for w, s in report["wide"].items():
        print(f"bg-wide-{w:<5} avif {s['avif'] // 1024:>5} KB   webp {s['webp'] // 1024:>5} KB")
    print("lqip", len(report["lqip_wide"]), "chars")


if __name__ == "__main__":
    main()
