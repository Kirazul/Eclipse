import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode } from "./base64";
import {
  decodeOutfit,
  encodeOutfit,
  emptyOutfit,
  OUTFIT_TAG,
  serializeOutfit,
} from "./outfit";
import { decodeWorld, OUTFIT_WORLD_TAG } from "./world";

// The real block from Eclipse/profiles/morph.cfg: what Serialize wrote, unedited.
const REAL_BODY = `slot 0 259306
slot 2 1001733
slot 4 1001735
slot 5 1001729
slot 6 1001732
slot 8 1001736
slot 9 1001731
slot 14 1001728
mount 134653
`;

describe("base64", () => {
  it("matches the DLL's alphabet and padding", () => {
    expect(base64Encode("slot 0 1\n")).toBe("c2xvdCAwIDEK");
    expect(base64Encode("ab")).toBe("YWI=");
    expect(base64Encode("a")).toBe("YQ==");
  });
  it("skips whitespace, stops at padding, refuses a stray byte", () => {
    expect(base64Decode("YW\r\n I=")).toBe("ab");
    expect(base64Decode("YQ==garbage")).toBe("a");
    expect(base64Decode("YW%I=")).toBeNull();
  });
});

describe("outfit codes", () => {
  const code = OUTFIT_TAG + base64Encode(REAL_BODY);

  it("round-trips a real saved outfit byte for byte", () => {
    const r = decodeOutfit(code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outfit.slots).toEqual({
      0: 259306, 2: 1001733, 4: 1001735, 5: 1001729,
      6: 1001732, 8: 1001736, 9: 1001731, 14: 1001728,
    });
    expect(r.outfit.mount).toBe(134653);
    expect(serializeOutfit(r.outfit)).toBe(REAL_BODY);
    expect(encodeOutfit(r.outfit)).toBe(code);
  });

  it("tolerates what a clipboard does to it, as Share.cpp does", () => {
    const wrapped = `  eca1:${code.slice(5, 20)}\r\n ${code.slice(20)}\n`;
    const r = decodeOutfit(wrapped);
    expect(r.ok && serializeOutfit(r.outfit)).toBe(REAL_BODY);
    const bare = decodeOutfit(code.slice(5));
    expect(bare.ok && serializeOutfit(bare.outfit)).toBe(REAL_BODY);
  });

  it("wears an old code by cutting at the first ~ section", () => {
    const r = decodeOutfit(`${code}~labels~${"x".repeat(5000)}`);
    expect(r.ok && serializeOutfit(r.outfit)).toBe(REAL_BODY);
  });

  it("keeps every field in Serialize's order", () => {
    const body = [
      "slot 15 50672",
      "display 11686 0",
      "mount 134653",
      "mountfly 132807",
      "mounthidden 1",
      "sheathe 0 2",
      "sheathe 1 3",
      "glowok 1",
      "glow 0 3789 1 1 FF8800",
      "glow 1 3368 1 0 000000",
      "scale 1.1000",
      "look 10 1 3 2 5 4 0",
      "ccolok 1",
      "ccol 0 A0522D",
      "wcolok 1",
      "gcolok 1",
      "wcol 0 50672 1800 200 128 0",
      "wcol 3 259306 900 100 90 1",
      "mcolok 1",
      "mcol 0 134653 300 40 50 0",
      "cosok 1",
      "cosm 12345 1 1.0000 0.0000 0.1000 -0.2000 0.000 0.000 0.000 1 0 210.000 0.8000 1.0000 0.2000 0.000 1.000 0.150 0",
      "",
    ].join("\n");
    const r = decodeOutfit(OUTFIT_TAG + base64Encode(body));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(serializeOutfit(r.outfit)).toBe(body);
    expect(r.warnings).toEqual([]);
    expect(r.outfit.look).toMatchObject({ kind: "look", race: 10, gender: 1 });
    expect(r.outfit.glow[0]).toMatchObject({ id: 3789, colour: 0xff8800 });
  });

  it("keeps a retail race's rlook line whole", () => {
    const line = "rlook voidelf f 10:2 11:0 12:5";
    const r = decodeOutfit(OUTFIT_TAG + base64Encode(`slot 0 1\n${line}\n`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outfit.look).toMatchObject({ kind: "rlook", race: "voidelf", sex: "f" });
    expect(serializeOutfit(r.outfit)).toBe(`slot 0 1\n${line}\n`);
  });

  it("carries a newer build's key instead of dropping it", () => {
    const r = decodeOutfit(OUTFIT_TAG + base64Encode("slot 0 1\nsparkle 7\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outfit.unknown).toEqual(["sparkle 7"]);
    expect(serializeOutfit(r.outfit)).toBe("slot 0 1\nsparkle 7\n");
    expect(r.warnings).toHaveLength(1);
  });

  it("applies Deserialize's range checks", () => {
    const body = [
      "slot 19 5", // past the last slot
      "slot 3 7",
      "sheathe 0 9", // no such position
      "glow 2 1 1 1 000000", // no third hand
      "wcol 14 1 1 1 1 1", // past the fourteen
      "wcol 0 0 1 1 1 1", // no item
      "wcol 1 77 4000 300 300 300", // clamped, not refused
      "mcol 1 5 1 1 1 1", // the flying slot holds nothing
      "ccol 5 FF0000", // past the last axis (tattoo is 4)
      "cosm 1 1 nan 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0", // not finite
      "cosm 2 1 0.0000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0", // no size
      "cosm 3 1 1.0000 0 0 0 0 0 0 0 2 0 0 0 0 0 0 0 0", // no such mode
      "cosm 4 1 1.0000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2", // no such scope
      "",
    ].join("\n");
    const r = decodeOutfit(OUTFIT_TAG + base64Encode(body));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outfit.slots).toEqual({ 3: 7 });
    expect(r.outfit.sheathe).toEqual([0, 0]);
    expect(r.outfit.glow).toEqual([null, null]);
    expect(r.outfit.wtint).toEqual([
      { slot: 1, item: 77, hue: 400, sat: 255, light: 255, dye: 255 },
    ]);
    expect(r.outfit.mtint).toEqual([]);
    expect(r.outfit.colors).toEqual([]);
    expect(r.outfit.cosmetics).toEqual([]);
  });

  it("drops a mount colour whose slot holds another mount", () => {
    const r = decodeOutfit(
      OUTFIT_TAG + base64Encode("mount 10\nmcol 0 99 1 1 1 1\nmcol 0 10 2 2 2 2\n"),
    );
    expect(r.ok && r.outfit.mtint).toEqual([
      { slot: 0, item: 10, hue: 2, sat: 2, light: 2, dye: 2 },
    ]);
  });

  it("refuses what is not a code, with a reason", () => {
    for (const text of ["", "   ", "hello world", "ECA1:", "ECA1:%%%", base64Encode("just text\n")]) {
      const r = decodeOutfit(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    const r = decodeOutfit(`${OUTFIT_TAG}${"A".repeat(300_000)}`);
    expect(r.ok).toBe(false);
  });

  it("re-encodes an edit the game will read back", () => {
    const o = emptyOutfit();
    o.slots[4] = 1001735;
    o.mount = 134653;
    const again = decodeOutfit(encodeOutfit(o));
    expect(again.ok && again.outfit.slots).toEqual({ 4: 1001735 });
    expect(again.ok && again.outfit.mount).toBe(134653);
  });
});

describe("world codes", () => {
  const lines = "wstyle.a1519.ground.on 1\nwstyle.a1519.ground.mode 4\nwstyle.a1519.ground.vis 0.45 0.30 0.85 0.35\n";

  it("reads the wstyle lines the DLL writes", () => {
    const r = decodeWorld(OUTFIT_WORLD_TAG + base64Encode(lines));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.places).toHaveLength(1);
    expect(r.places[0].tag).toBe("a1519");
    expect(r.places[0].rows.ground?.on).toBe(true);
    expect(r.places[0].rows.ground?.mode).toBe(4);
    expect(r.places[0].rows.ground?.colour).toEqual([0.45, 0.3, 0.85, 0.35]);
    expect(r.places[0].rows.grass).toBeUndefined();
  });

  it("matches ImportCode: skip the unknown, refuse the unsafe", () => {
    const skip = decodeWorld(OUTFIT_WORLD_TAG + base64Encode(
      `wstyle.m631.grass.on 1\nfuture.key 3\nwstyle.a1519.future.on 1\n`,
    ));
    expect(skip.ok && skip.places.map((p) => p.tag)).toEqual(["m631"]);
    for (const value of ["nan", "inf", "1e99", "9".repeat(40)]) {
      const r = decodeWorld(OUTFIT_WORLD_TAG + base64Encode(
        `wstyle.a1519.ground.on 1\nwstyle.a1519.ground.dist ${value}\n`,
      ));
      expect(r.ok).toBe(false);
    }
  });

  it("refuses other text, including a loadout code", () => {
    for (const text of ["", "not a code", "ECA1:c2xvdCAwIDE5MDE5Cg==", "ECW1:%%%", `ECW1:${"A".repeat(200_000)}`]) {
      expect(decodeWorld(text).ok).toBe(false);
    }
  });
});
