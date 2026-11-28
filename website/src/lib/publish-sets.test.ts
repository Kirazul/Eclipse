import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { resolveOutfit } from "@/lib/catalog";
import { decodeOutfit } from "@/lib/codec/outfit";
import { PUBLISHING_LIMIT_ERROR, type GameSet } from "@/lib/data/types";
import { publishSetsInTurn, SET_NOT_READY, setAsLook } from "./publish-sets";

const CODE = `ECA1:${Buffer.from("slot 0 259306\nslot 4 1001735\n").toString("base64")}`;
const PICTURE = "00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000000aa.avif";
const set = (n: number, extra: Partial<GameSet> = {}): GameSet => ({
  id: `1111111${n}-1111-4111-8111-111111111111`,
  name: `Raid night ${n}`,
  code: CODE,
  updatedAt: "2026-11-20T00:00:00.000Z",
  gallery: [PICTURE],
  className: null,
  race: null,
  ...extra,
});

describe("a ready set as a look", () => {
  it("fills in what the publish form would: the set's name, its pictures, its character", () => {
    const decoded = decodeOutfit(CODE);
    if (!decoded.ok) throw new Error(decoded.error);
    const resolved = resolveOutfit(decoded.outfit);
    expect(setAsLook(set(1, { className: "Paladin", race: "human" }))).toEqual({
      title: "Raid night 1",
      code: CODE,
      className: "Paladin",
      armor: resolved.armor ?? undefined,
      race: resolved.raceKey ?? "human",
      gallery: [PICTURE],
    });
  });

  it("leaves out what nothing says", () => {
    const look = setAsLook(set(1));
    expect(look.className).toBeUndefined();
    expect(look.race).toBeUndefined();
  });

  it("keeps a long name to the title's limit", () => {
    expect(setAsLook(set(1, { name: `  ${"x".repeat(120)}  ` })).title).toBe("x".repeat(80));
  });
});

describe("publishing ready sets in turn", () => {
  const ok = (id: string) => ({ ok: true as const, id });

  it("publishes each set through the one publish path, in the order chosen", async () => {
    const sets = [set(1), set(2)];
    const publish = vi.fn(async (look: { title: string }) => ok(`look-${look.title}`));
    const done = await publishSetsInTurn([sets[1].id, sets[0].id], {
      getSet: async (id) => sets.find((s) => s.id === id) ?? null,
      publish,
    });
    expect(publish.mock.calls.map(([look]) => look.title)).toEqual(["Raid night 2", "Raid night 1"]);
    expect(done).toEqual({
      outcomes: [
        { setId: sets[1].id, name: "Raid night 2", ok: true, id: "look-Raid night 2" },
        { setId: sets[0].id, name: "Raid night 1", ok: true, id: "look-Raid night 1" },
      ],
      notTried: 0,
      stoppedBy: null,
    });
  });

  it("publishes a set chosen twice once", async () => {
    const publish = vi.fn(async () => ok("look"));
    await publishSetsInTurn([set(1).id, set(1).id], { getSet: async () => set(1), publish });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("goes on past a set that fails for its own reason", async () => {
    const sets = [set(1), set(2)];
    const done = await publishSetsInTurn(sets.map((s) => s.id), {
      getSet: async (id) => sets.find((s) => s.id === id) ?? null,
      publish: async (look) =>
        look.title === "Raid night 1"
          ? { ok: false, error: "This look is already in the Community Gallery.", existing: "old" }
          : ok("new"),
    });
    expect(done.outcomes).toEqual([
      { setId: sets[0].id, name: "Raid night 1", ok: false, error: "This look is already in the Community Gallery.", existing: "old" },
      { setId: sets[1].id, name: "Raid night 2", ok: true, id: "new" },
    ]);
    expect(done.stoppedBy).toBeNull();
  });

  it("stops at the publishing limit and counts the sets it never tried", async () => {
    const sets = [set(1), set(2), set(3), set(4)];
    const publish = vi.fn(async (look: { title: string }) =>
      look.title === "Raid night 1" ? ok("first") : { ok: false as const, error: PUBLISHING_LIMIT_ERROR },
    );
    const done = await publishSetsInTurn(sets.map((s) => s.id), {
      getSet: async (id) => sets.find((s) => s.id === id) ?? null,
      publish,
    });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(done.outcomes).toEqual([{ setId: sets[0].id, name: "Raid night 1", ok: true, id: "first" }]);
    expect(done.notTried).toBe(3);
    expect(done.stoppedBy).toBe(PUBLISHING_LIMIT_ERROR);
  });

  it("publishes nothing for a set that is gone or has no picture", async () => {
    const publish = vi.fn(async () => ok("look"));
    const bare = set(2, { gallery: [] });
    const done = await publishSetsInTurn([set(1).id, bare.id], {
      getSet: async (id) => (id === bare.id ? bare : null),
      publish,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(done.outcomes).toEqual([
      { setId: set(1).id, name: "", ok: false, error: SET_NOT_READY },
      { setId: bare.id, name: bare.name, ok: false, error: SET_NOT_READY },
    ]);
  });
});
