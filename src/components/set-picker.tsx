"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ItemRing } from "@/components/item-icon";
import { Input } from "@/components/ui/input";
import { term } from "@/i18n/terms";
import type { ItemHit } from "@/lib/catalog";
import { VISIBLE_SLOTS } from "@/lib/domain";
import type { SetHit } from "@/lib/item-sets";
import { qualityColour } from "@/lib/wow-assets";

/** The piece that stands for a set: the first it wears, read top to bottom. */
function faceOf(set: SetHit): { slot: number; piece: ItemHit } | null {
  for (const slot of VISIBLE_SLOTS) {
    const piece = set.pieces[slot];
    if (piece) return { slot, piece };
  }
  return null;
}

/**
 * The game's item sets, by name. Choosing one hands its pieces to the rack; until then
 * nothing changes on the figure, so the 3D preview loads nothing new.
 */
export function SetPicker({ setCount, onWear }: { setCount: number; onWear: (set: SetHit) => void }) {
  const t = useTranslations("dressing");
  const tw = useTranslations();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SetHit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [worn, setWorn] = useState<SetHit | null>(null);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sets?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setHits((await res.json()) as SetHit[]);
        setFailed(false);
      } catch {
        // An abort is a superseded search, and the next one answers.
        if (!controller.signal.aborted) setFailed(true);
      }
    }, 150);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query]);

  const wear = (set: SetHit) => {
    setWorn(set);
    onWear(set);
  };

  // Any number names a set, so the pick is made here and the answer can be cached.
  const random = async () => {
    setRolling(true);
    try {
      const res = await fetch(`/api/sets?at=${Math.floor(Math.random() * 2 ** 31)}`);
      if (!res.ok) throw new Error(String(res.status));
      const [set] = (await res.json()) as SetHit[];
      if (set) wear(set);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRolling(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface/85 p-3">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          aria-label={t("searchSets")}
          placeholder={t("searchSetsCount", { count: setCount })}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="pill shrink-0" onClick={() => void random()} disabled={rolling}>
          {t("randomSet")}
        </button>
      </div>
      <p className="text-xs text-ink-dim">{t("setsHint")}</p>
      <p role="status" className="text-sm empty:hidden">
        {worn && t("woreSet", { name: worn.name, shown: worn.shown, total: worn.total })}
      </p>
      {failed && <p role="alert" className="text-sm text-ink-dim">{t("setsFailed")}</p>}
      {hits && !hits.length && <p className="text-sm text-ink-dim">{t("noSet")}</p>}
      {hits && hits.length > 0 && (
        <ul className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {hits.map((set) => {
            const face = faceOf(set);
            return (
              <li key={set.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => wear(set)}
                  aria-pressed={worn?.id === set.id}
                  className="flex w-full items-center gap-2 rounded-sm p-1 text-left text-sm transition-colors hover:bg-surface-high"
                >
                  <ItemRing icon={face?.piece.icon ?? null} slot={face?.slot ?? 4} quality={face?.piece.quality ?? null} size={36} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate" style={{ color: qualityColour(face?.piece.quality ?? null) }}>{set.name}</span>
                    <span className="truncate text-xs text-ink-dim">
                      {term(tw, "armor", set.armor)} · {t("inPreview", { shown: set.shown, total: set.total })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
