"""
build_html.py - fill the generated blocks of site/index.html, in place.

index.html is the page, written by hand and readable as-is. Three things in it
are generated, each between a pair of markers, and this script rewrites only
what sits between them - so it can be run any number of times:

    <!-- @sprite --> ... <!-- /@sprite -->   the inline SVG icon sprite
    /* @lqip */ ... /* /@lqip */             the blurred placeholders, from
                                             tools/assets-report.json
    <script id="wallets"> ... </script>      site/assets/wallets.json

Run after tools/build_assets.py:

    python tools/build_html.py
"""

from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "site", "index.html")
ICONS = os.path.join(ROOT, "tools", "icons")

# Line icons, 24 x 24, drawn with the current text colour.
STROKE = {
    "download": ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>', '<path d="m7 10 5 5 5-5"/>', '<path d="M12 15V3"/>'],
    "shirt": ['<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>'],
    "user": ['<circle cx="12" cy="8" r="5"/>', '<path d="M20 21a8 8 0 0 0-16 0"/>'],
    "wind": ['<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/>', '<path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/>', '<path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>'],
    "ghost": ['<path d="M9 10h.01"/>', '<path d="M15 10h.01"/>', '<path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>'],
    "sword": ['<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/>', '<path d="m13 19 6-6"/>', '<path d="m16 16 4 4"/>', '<path d="m19 21 2-2"/>'],
    "paw": ['<circle cx="11" cy="4" r="2"/>', '<circle cx="18" cy="8" r="2"/>', '<circle cx="20" cy="16" r="2"/>', '<path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>'],
    "sparkles": ['<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>', '<path d="M20 3v4"/>', '<path d="M22 5h-4"/>'],
    "zap": ['<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'],
    "crown": ['<path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3l4.27-3.67a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.96-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.67a1 1 0 0 0 1.52-.3z"/>', '<path d="M5 21h14"/>'],
    "feather": ['<path d="M12.67 19a2 2 0 0 0 1.42-.59l6.15-6.17a6 6 0 0 0-8.49-8.49L5.59 9.91A2 2 0 0 0 5 11.33V18a1 1 0 0 0 1 1z"/>', '<path d="M16 8 2 22"/>', '<path d="M17.5 15H9"/>'],
    "palette": ['<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/>', '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>', '<circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>', '<circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>', '<circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>'],
    "mountain": ['<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>'],
    "type": ['<path d="M4 7V4h16v3"/>', '<path d="M9 20h6"/>', '<path d="M12 4v16"/>'],
    "layers": ['<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/>', '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>', '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'],
    "users": ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>', '<circle cx="9" cy="7" r="4"/>', '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>', '<path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
    "shield": ['<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>', '<path d="m9 12 2 2 4-4"/>'],
    "search": ['<circle cx="11" cy="11" r="8"/>', '<path d="m21 21-4.3-4.3"/>'],
    "lock": ['<rect width="18" height="11" x="3" y="11" rx="2"/>', '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>'],
    "folder": ['<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>'],
    "arrow": ['<path d="M5 12h14"/>', '<path d="m12 5 7 7-7 7"/>'],
    "x": ['<path d="M18 6 6 18"/>', '<path d="m6 6 12 12"/>'],
    "copy": ['<rect width="14" height="14" x="8" y="8" rx="2"/>', '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'],
    "check": ['<path d="M20 6 9 17l-5-5"/>'],
    "qr": ['<rect width="5" height="5" x="3" y="3" rx="1"/>', '<rect width="5" height="5" x="16" y="3" rx="1"/>', '<rect width="5" height="5" x="3" y="16" rx="1"/>', '<path d="M21 16h-3a2 2 0 0 0-2 2v3"/>', '<path d="M21 21v.01"/>', '<path d="M12 7v3a2 2 0 0 1-2 2H7"/>', '<path d="M3 12h.01"/>', '<path d="M12 3h.01"/>', '<path d="M12 16v.01"/>', '<path d="M16 12h1"/>', '<path d="M21 12v.01"/>', '<path d="M12 21v-1"/>'],
}

# Filled marks, 24 x 24.
FILL = {
    "play": '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/>',
    "star": '<path d="M11.52 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.9l5.16-.76a2.12 2.12 0 0 0 1.6-1.16z"/>',
}

BRANDS = {"discord": "discord", "kofi": "kofi", "github": "github", "drive": "googledrive"}
COINS = ["btc", "ltc", "usdt", "usdc"]


def inner_svg(path: str) -> tuple[str, str]:
    """(viewBox, inner markup) of a single-file SVG icon."""
    s = open(path, encoding="utf-8").read()
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    body = re.search(r"<svg[^>]*>(.*)</svg>", s, re.S).group(1)
    body = re.sub(r"<title>.*?</title>", "", body, flags=re.S).strip()
    return vb, body


def sprite() -> str:
    out = ['<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">']
    for name, parts in STROKE.items():
        out.append(f'<symbol id="i-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                   f'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{"".join(parts)}</symbol>')
    for name, body in FILL.items():
        out.append(f'<symbol id="i-{name}" viewBox="0 0 24 24" fill="currentColor">{body}</symbol>')
    for name, file in BRANDS.items():
        vb, body = inner_svg(os.path.join(ICONS, file + ".svg"))
        body = body.replace("<path ", '<path fill="currentColor" ', 1) if "fill=" not in body else body
        out.append(f'<symbol id="i-{name}" viewBox="{vb}">{body}</symbol>')
    for c in COINS:
        vb, body = inner_svg(os.path.join(ICONS, f"coin-{c}.svg"))
        out.append(f'<symbol id="c-{c}" viewBox="{vb}">{body}</symbol>')
    out.append("</svg>")
    return "".join(out)


def lqip_css() -> str:
    with open(os.path.join(ROOT, "tools", "assets-report.json"), encoding="utf-8") as f:
        r = json.load(f)
    return ('/* @lqip */\n'
            f'    .hero__plate {{ background: #1c2a30 url("{r["lqip_wide"]}") center / 100% 100% no-repeat; }}\n'
            '    @media (max-aspect-ratio: 4/5) {\n'
            f'      .hero__plate {{ background-image: url("{r["lqip_tall"]}"); }}\n'
            '    }\n'
            '    /* /@lqip */')


def wallets() -> str:
    with open(os.path.join(ROOT, "site", "assets", "wallets.json"), encoding="utf-8") as f:
        return json.dumps(json.load(f), separators=(",", ":"))


def main() -> None:
    s = open(PAGE, encoding="utf-8").read()
    n0 = len(s)
    s, a = re.subn(r"<!-- @sprite -->.*?<!-- /@sprite -->",
                   lambda m: "<!-- @sprite -->" + sprite() + "<!-- /@sprite -->", s, flags=re.S)
    s, b = re.subn(r"/\* @lqip \*/.*?/\* /@lqip \*/", lambda m: lqip_css(), s, flags=re.S)
    s, c = re.subn(r'(<script type="application/json" id="wallets">).*?(</script>)',
                   lambda m: m.group(1) + wallets() + m.group(2), s, flags=re.S)
    if (a, b, c) != (1, 1, 1):
        raise SystemExit(f"marker missing: sprite={a} lqip={b} wallets={c}")
    with open(PAGE, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    print(f"index.html {n0} -> {len(s)} bytes")


if __name__ == "__main__":
    main()
