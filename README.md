<p align="center">
  <img src="site/assets/img/logo-640.png" alt="Eclipse" width="240">
</p>

<h1 align="center">Eclipse</h1>

<p align="center">
  A free, client-side wardrobe for World of Warcraft 3.3.5a.<br>
  Every appearance, mount, spell and title in the game, on your own character.
</p>

<p align="center">
  <a href="https://kirazul.github.io/Eclipse/"><img alt="Website" src="https://img.shields.io/badge/Website-kirazul.github.io%2FEclipse-f7c34a?style=for-the-badge"></a>
  <a href="https://discord.gg/RvY5VjHgTA"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
  <a href="https://ko-fi.com/eclipsewow"><img alt="Ko-fi" src="https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white"></a>
  <a href="https://github.com/Kirazul/Eclipse/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Kirazul/Eclipse?style=for-the-badge&color=ff8a2a"></a>
</p>

<p align="center">
  <img alt="Client" src="https://img.shields.io/badge/client-3.3.5a%20(12340)-2b2a27?style=flat-square">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-2b2a27?style=flat-square">
  <img alt="Price" src="https://img.shields.io/badge/price-free-2b2a27?style=flat-square">
  <img alt="Account" src="https://img.shields.io/badge/account-none%20required-2b2a27?style=flat-square">
</p>

<p align="center">
  <a href="https://kirazul.github.io/Eclipse/"><strong>Website</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="https://drive.google.com/file/d/1UuOb9tl43sohg41_gV2z82WAgIKBLhXF/view?usp=sharing"><strong>Download</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="https://discord.gg/RvY5VjHgTA"><strong>Discord</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#support"><strong>Support</strong></a>
</p>

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [This repository](#this-repository)
- [Disclaimer](#disclaimer)

---

## Overview

Eclipse loads into the World of Warcraft 3.3.5a client and draws its own
interface over the game. Open it with **F2** and you have the whole game's
wardrobe: every item appearance, mount, spell visual, title and effect, applied
to your own character and saved with it.

Everything Eclipse does is **cosmetic**. It changes what you see, and nothing
else. It reads nothing the client was not already showing you, and it never
acts for you.

| | |
| --- | --- |
| **Price** | Free. No subscription, no account, no ads. |
| **Client** | World of Warcraft 3.3.5a, build 12340 |
| **System** | Windows 10 or 11 |
| **Install** | One DLL and one folder next to `Wow.exe`. No injector, no installer. |
| **Open** | **F2** in game (rebindable in Settings) |

---

## Features

### Appearance

| Feature | What it does |
| --- | --- |
| **Wardrobe** | Every item appearance and every set in the game, one slot at a time. Hover to try a piece on the live figure, click to wear it. Nothing is locked. |
| **Character select and Character panel** | Your look is shown on the character-selection screen and in the game's own Character panel, not only in the world. |
| **Customization** | Race, sex, skin, face, hair and facial hair - every option the running client can draw, read from the client's own tables. |
| **Custom colours** | Skin, hair, eyes and death knight eye glow in any colour, composited by the client's own character renderer. |
| **Mounts** | Every mount in the game in a named list beside a life-size render. Browsing is free; riding one is a click. Includes a randomizer. |
| **Creature morph** | Take the form of any creature the client can render. A randomizer reel picks one for you, with every creature equally likely. |
| **Enchants** | Any enchant visual on either weapon, whether or not the weapon itself is morphed. |
| **Weapon colour** | A colour wheel for the main hand, off hand and ranged slot. The hue moves while the lightness is kept, across textures, particles, ribbons and item visuals. Saved with the outfit. |
| **Incarnations** | Druid travel and combat forms, Metamorphosis, warlock demons, hunter pets and ammunition. |
| **Hearthstones** | Around forty retail hearthstone looks for your own hearthstone. |

### Spells

| Feature | What it does |
| --- | --- |
| **Spell visuals** | Any of your spells can wear any other spell's art - the precast, the cast, the missile, the impact and the aura. |
| **Auras** | Wear any aura's visual directly, with no spell involved, for as long as you like. |
| **Procs** | Aura Swap: any aura you gain wears another aura's look. Spell Swap on Aura: one of your spells wears another spell's look for exactly as long as an aura is on you. |
| **Spell colours** | Recolour one of your spells across every rank, including the spells it triggers, or recolour any aura. Presets, a hue strip and a before-and-after preview. |
| **Optimize** | Get your frame rate back in raids by not drawing other players' spell art. Choose what to hide and from whom. Encounter mechanics from 23 raids, Molten Core to the Ruby Sanctum, are always drawn on every difficulty, and your own spells are never hidden. |

### Identity

| Feature | What it does |
| --- | --- |
| **Titles** | Every title in the game, previewed on your own name, in the colours you choose for the title and for the name. |
| **Custom text** | Free text of your own in place of a title, coloured word by word. |

### Effects

| Feature | What it does |
| --- | --- |
| **3D effects** | Real models - wings, capes, effects - attached to your character's bones, textured and animated, and drawn inside the world so they never cover the interface. |
| **Placement** | Position, animation, look, and who sees it, with a live preview. |
| **Import** | Bring your own `.m2x` and `.obj` models. |

### Colour and outline

| Feature | What it does |
| --- | --- |
| **Units** | Recolour each kind of unit on its own - your target, yourself, hostile and friendly players, and NPCs by disposition - as solid, textured, glow, ghost or wireframe. |
| **World** | Tint, wash, stain, vivid, glow, solid or wireframe over the world's own art. |
| **Outline Mode** | Retail's unit outlines, backported, coloured by what each unit is. |

### World

| Feature | What it does |
| --- | --- |
| **Sky and time** | Time of day, weather type and intensity, and skybox. |
| **Atmosphere** | Draw distance, fog colour and range, and field of view. |
| **Units** | Distance culling for players, pets, NPCs, objects and corpses, with your group always shown. Hide shadows, nameplates or chat bubbles. |
| **Texture sharpening** | Filtering, anisotropy, detail bias and full-resolution mipmaps. |
| **Render analysis** | Switch individual parts of the scene on and off: models, terrain, buildings, liquids, clutter, lighting, wireframe and more. |

### Font

| Feature | What it does |
| --- | --- |
| **HD text** | Every glyph the client writes, drawn as vectors and sharp at any resolution. |
| **Combat text** | Colour, spectrum and size for each kind of floating combat text, with shared motion, timing and critical-hit pop. |

### Loadouts and sharing

| Feature | What it does |
| --- | --- |
| **Loadouts** | Save complete looks - equipment, mount, glows, body and weapon positions - and wear them in one click. |
| **Share codes** | Copy a look as a single line of text; import one somebody else copied. |
| **Specializations** | Assign a loadout to each talent specialization. It is worn when you switch, and at no other time. |
| **Shortcut wheel** | Hold a key, flick towards a loadout, let go. Drawn over the world with the overlay closed. |
| **Multiplayer** | Other Eclipse users see your look and you see theirs. Separate switches for gear, body and colours, title and name, mount, creature morph, forms and hearthstone. Nothing is sent to the game server. |

### Settings

| Feature | What it does |
| --- | --- |
| **Key** | Open and close the overlay with **F2**, or any key you choose. |
| **Appearance** | Accent colour and how the overlay starts. |
| **Diagnostics** | One log file per session, kept tidy automatically, with an optional frame-time monitor. |

---

## Installation

1. **Download** [Eclipse.zip](https://drive.google.com/file/d/1UuOb9tl43sohg41_gV2z82WAgIKBLhXF/view?usp=sharing).
   It includes the retail asset pack: items, mounts, fonts, effects and spells.
2. **Extract** it anywhere.
3. **Copy** `dinput8.dll` and the `Eclipse` folder into your game folder, next to `Wow.exe`:

   ```
   World of Warcraft/
   ├── Wow.exe
   ├── dinput8.dll
   └── Eclipse/
   ```

4. **Start** the game, enter the world and press **F2**.

To uninstall, delete `dinput8.dll` and the `Eclipse` folder.

---

## Usage

| | |
| --- | --- |
| Open or close the overlay | **F2** |
| Try an item on | Hover it |
| Wear it | Click it |
| Save the whole look | Loadout, Save |
| Share a look | Loadout, Share - then send the copied line |
| Wear a shared look | Loadout, Import |

The overlay appears once you are in the world with your character loaded.

---

## How it works

**One file, one folder.** Windows loads a DLL from the program's own folder
before the system folder, and `Wow.exe` imports `dinput8.dll`. Eclipse ships as
that file and passes every real DirectInput call through to the system library,
so no injector is needed. Everything Eclipse reads or writes lives in the
`Eclipse` folder beside the game:

```
Eclipse/
├── packs/      art archives mounted into the client
├── data/       the wardrobe, mount, appearance and incarnation databases
├── cache/      recoloured art, rebuilt on demand - safe to delete
├── settings/   the overlay's own settings
├── profiles/   everything you saved: looks, loadouts, effects, specs
└── logs/       one log per session, the last ten kept
```

**Nothing guessed.** Every memory address Eclipse uses is derived from the game
binary by an automated pipeline and re-verified before each build. Nothing is
copied from a forum or typed in by hand.

**Safe by default.** Before touching anything, Eclipse checks that it has been
loaded into the exact client build it was made for, and does nothing at all on
any other. Every individual patch compares the bytes it is about to change
against what the pipeline expects, and refuses if they differ - so an
unexpected client loses one feature, with the reason printed on its page, not
the game.

**Cosmetic only.** Your real equipment, title and character never change on the
server. Other players see your real gear unless they also run Eclipse with
Multiplayer on.

---

## Troubleshooting

**Nothing appears when I press F2.**
The overlay only opens once you are in the world with a character loaded. If it
still does not appear, open the newest log in `Eclipse/logs/` - it records every
step Eclipse took and the reason for anything it refused.

**A page says "Not available".**
That feature checked the client's bytes and found something other than what it
expected, so it left the client alone. The page names the check that failed.

**The wardrobe shows only the client's own items.**
The `Eclipse` folder is missing or not beside `Wow.exe`. Everything is opened
relative to the game's own folder.

**Still stuck?**
Ask in the [Discord](https://discord.gg/RvY5VjHgTA) and bring the newest log
file.

---

## Support

Eclipse is free and it will stay free. If it has earned a place in your game,
any of these keeps it going:

- **Star this repository** - it costs nothing and helps others find Eclipse.
- **[Ko-fi](https://ko-fi.com/eclipsewow)** - support development directly.
- **[Discord](https://discord.gg/RvY5VjHgTA)** - join the community, share your looks, report issues.

### Crypto

| Coin | Network | Address |
| --- | --- | --- |
| Bitcoin (BTC) | Bitcoin | `1KsLBMV4Yp9EdMxqPE3UM8Jx8DNCMq9d8A` |
| Tether (USDT) | TRON (TRC20) | `TV1XE2FipMbG5JPdS9BSRkQnBqHv6ndv2a` |
| USD Coin (USDC) | Ethereum (ERC20) | `0x8d420925562d04b0f0dd318e4cbf661b213c1d4a` |
| Litecoin (LTC) | Litecoin | `LbMF1rvm9n2idxTzZzJFv4aXKcXUnF1fjR` |

Send each coin only on the network listed beside it. The website shows a QR
code for every address.

---

## This repository

This repository holds the Eclipse website and this document. The site is plain
HTML, CSS and JavaScript with no framework and no build step at deploy time,
and it is published to GitHub Pages by GitHub Actions on every push to `main`.

```
.
├── site/                      the website, published as-is
│   ├── index.html
│   ├── 404.html
│   ├── assets/
│   │   ├── css/style.css
│   │   ├── js/main.js
│   │   ├── fonts/             Inter and Newsreader, subset, self-hosted
│   │   ├── img/               generated - see tools/build_assets.py
│   │   └── wallets.json       the crypto addresses, one source for page and QR codes
│   └── site.webmanifest
├── tools/
│   ├── build_assets.py        background ladder, portrait crop, logo, icons, QR codes, social card
│   ├── build_html.py          fills the generated blocks in index.html
│   └── icons/                 brand and coin marks used by the icon sprite
└── .github/workflows/pages.yml
```

### Showcase video

Set the YouTube video id on the player in `site/index.html`:

```html
<div class="player" data-player data-youtube-id="VIDEO_ID">
```

The page then shows the video's own thumbnail with a play button, and loads the
player only when it is clicked.

### Rebuilding the images

The background is the "Threads of Destiny" wallpaper from *World of Warcraft:
The War Within*, from the Blizzard press center. Place the source files in
`source/` (`keyart-eclipse.png`, `logo.png`, `Inter.ttf`, `Newsreader.ttf`) and
run:

```bash
pip install pillow segno fonttools brotli
python tools/build_assets.py
python tools/build_html.py
```

Every background size is computed rather than chosen: the art covers the first
screen, so its rendered width is `max(100vw, 100vh x 16/9)`, and the page tells
the browser exactly that, so each screen downloads the smallest file that is
still sharp. Phones held upright get their own crop.

### Running it locally

```bash
cd site
python -m http.server 8000
```

---

## Disclaimer

Eclipse is a free fan project. It is not affiliated with, endorsed by or
sponsored by Blizzard Entertainment. World of Warcraft, The War Within and the
artwork used on the website are trademarks or property of Blizzard
Entertainment, Inc.
