import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import backdrops from "@/data/backdrops.json";
import wallets from "@/data/wallets.json";
import { CLASSES, RACE_LABEL, SLOT_NAMES } from "@/lib/domain";
import {
  QUALITY_NAME,
  backdropFor,
  cardBackdropFor,
  classArt,
  concept,
  iconSources,
  qualityColour,
  raceArt,
  ringArt,
  slotArt,
} from "./wow-assets";

const onDisk = (path: string) => existsSync(join(process.cwd(), "public", path));

describe("wow-assets", () => {
  it("tries the baked icon, then the CDN, then the slot's own texture", () => {
    expect(iconSources("INV_Helmet_01", 0)).toEqual([
      "/icons/inv_helmet_01.webp",
      "https://wow.zamimg.com/images/wow/icons/large/inv_helmet_01.jpg",
      "/wow/slots/head.jpg",
    ]);
  });

  it("drops a .blp extension, which a catalogue row can carry and no browser reads", () => {
    expect(iconSources("inv_goblin_kart_01.blp", 15)[0]).toBe("/icons/inv_goblin_kart_01.webp");
  });

  it("goes straight to the real empty texture when a row names no icon", () => {
    expect(iconSources(null, 4)).toEqual(["/wow/slots/chest.jpg"]);
    expect(iconSources("", 14)).toEqual(["/wow/slots/chest.jpg"]);
  });

  it("has a real texture on disk for every slot", () => {
    SLOT_NAMES.forEach((name, slot) => expect(onDisk(slotArt(slot)), name).toBe(true));
    expect(onDisk(slotArt(99))).toBe(true);
  });

  it("has a real crest on disk for every class", () => {
    for (const name of CLASSES) expect(onDisk(classArt(name)), name).toBe(true);
  });

  it("has a real portrait on disk for every race key, in both sexes", () => {
    for (const key of Object.keys(RACE_LABEL)) {
      expect(onDisk(raceArt(key, "Male")), key).toBe(true);
      expect(onDisk(raceArt(key, "Female")), key).toBe(true);
    }
  });

  it("has real art on disk for each concept that has no item", () => {
    for (const name of ["morph", "mount", "enchant", "incarnation", "visual", "title", "effect", "unknown"] as const) {
      expect(onDisk(concept(name)), name).toBe(true);
    }
  });

  it("matches the studio's quality rings and colours, neutral when unknown", () => {
    expect(ringArt(2)).toBe("/wow/rings/uncommon.png");
    expect(ringArt(3)).toBe("/wow/rings/rare.png");
    expect(ringArt(4)).toBe("/wow/rings/epic.png");
    expect(ringArt(5)).toBe("/wow/rings/legendary.png");
    expect(ringArt(6)).toBe("/wow/rings/artifact.png");
    expect(ringArt(7)).toBe("/wow/rings/heirloom.png");
    expect(ringArt(null)).toBe("/wow/rings/white.png");
    expect(ringArt(1)).toBe("/wow/rings/white.png");
    expect(qualityColour(4)).toBe("#b45cff");
    expect(qualityColour(null)).toBe("#f2f2f2");
    expect(QUALITY_NAME[4]).toBe("Epic");
    for (const q of [null, 0, 1, 2, 3, 4, 5, 6, 7]) expect(onDisk(ringArt(q)), String(q)).toBe(true);
  });

  it("gives a post the same real backdrop every time", () => {
    const a = backdropFor("crystal-scholar");
    expect(backdropFor("crystal-scholar")).toBe(a);
    expect(onDisk(a)).toBe(true);
    const spread = new Set(Array.from({ length: 200 }, (_, i) => backdropFor(`s${i}`)));
    expect(spread.size).toBeGreaterThan(40);
    expect(backdrops.length).toBe(93);
  });

  it("has a small copy of every backdrop for cards, the same scene as the full one", () => {
    for (const name of backdrops) expect(onDisk(`/wow/backdrops/card/${name}.webp`), name).toBe(true);
    expect(cardBackdropFor("crystal-scholar").replace("/card/", "/").replace(".webp", ".jpg")).toBe(backdropFor("crystal-scholar"));
  });
});

describe("wallets", () => {
  it("has a QR code on disk for each of the four addresses", () => {
    expect(wallets.map((w) => w.id)).toEqual(["btc", "usdt", "usdc", "ltc"]);
    for (const w of wallets) {
      const qr = join(process.cwd(), "public", "assets", "img", `qr-${w.id}.svg`);
      expect(readFileSync(qr, "utf8").startsWith("<svg") || readFileSync(qr, "utf8").includes("<svg"), w.id).toBe(true);
    }
  });
});
