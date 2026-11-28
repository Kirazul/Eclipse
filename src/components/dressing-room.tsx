"use client";

import { useTranslations } from "next-intl";
import { term } from "@/i18n/terms";
import { useStore } from "@nanostores/react";
import { $customization, $look, $manifest } from "@eclipse/engine/stores";
import { ImageDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { ItemRing } from "@/components/item-icon";
import { ModelStage } from "@/components/model-stage";
import { SetPicker } from "@/components/set-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppearancePanel } from "@/components/viewer/appearance-panel";
import { ClipPicker } from "@/components/viewer/clip-picker";
import type { ItemHit } from "@/lib/catalog";
import { RACE_LABEL, SLOT_NAMES, VISIBLE_SLOTS } from "@/lib/domain";
import { dressedCode, wearSet, type StartingRack } from "@/lib/dressing-room";
import { NARCISSUS_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import { bodyOf } from "@/lib/viewer/figure";
import { $engine } from "@/lib/viewer/state";
import { backdropFor, qualityColour } from "@/lib/wow-assets";

const LEFT = VISIBLE_SLOTS.slice(0, 7);
const RIGHT = VISIBLE_SLOTS.slice(7);
const OWN_RACE = "own";
const SEXES = ["Male", "Female"];
/** Races in the order a person looks for them, by name. */
const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "vulpera-female" -> race key and gender. */
function splitBody(id: string) {
  const m = /^(.+)-(male|female)$/.exec(id);
  return m ? { race: m[1]!, gender: m[2] === "female" ? 1 : 0 } : null;
}

/** What each slot holds: an item, or null to hide it. No key leaves it to the wearer. */
type Rack = Record<number, ItemHit | null>;

function Piece({ slot, rack, side, active, onChoose }: {
  slot: number;
  rack: Rack;
  side: "left" | "right";
  active: boolean;
  onChoose: (slot: number) => void;
}) {
  const t = useTranslations("dressing");
  const tw = useTranslations();
  const piece = rack[slot];
  const hidden = piece === null;
  const name = piece === undefined ? t("ownGear") : hidden ? tw("pieces.hidden") : piece.name;
  const slotName = term(tw, "slot", SLOT_NAMES[slot]);
  return (
    <li>
      <button
        type="button"
        aria-label={t("choose", { slot: slotName })}
        aria-pressed={active}
        onClick={() => onChoose(slot)}
        className={cn("piece w-full", side === "left" ? "text-left" : "piece--right", active && "bg-surface-high")}
      >
        <ItemRing icon={piece?.icon ?? null} slot={slot} quality={piece?.quality ?? null} size={52} hidden={hidden} empty={piece === undefined} />
        <span className="block min-w-0 flex-1">
          <span
            className="piece__name"
            style={{ color: hidden ? "#1eff00" : piece ? qualityColour(piece.quality) : "var(--ink-faint)" }}
          >
            {name}
          </span>
          <span className="piece__slot block">{slotName}</span>
        </span>
      </button>
    </li>
  );
}

/** Import's publish form, holding this code and crediting the look it started from. */
const publishHref = (code: string, from: string | null) =>
  `/loadouts?${new URLSearchParams(from ? { code, from } : { code })}`;

/** Pick pieces slot by slot, see them on a character, and take away a code. */
export function DressingRoom({ itemCount, setCount, start, from = null, canPublish = false }: {
  itemCount: number;
  /** The game's item sets on offer in the Sets tab. */
  setCount: number;
  start: StartingRack | null;
  /** The published look on the rack, credited if this one is published. */
  from?: string | null;
  canPublish?: boolean;
}) {
  const [rack, setRack] = useState<Rack>(start?.pieces ?? {});
  const [active, setActive] = useState<number>(VISIBLE_SLOTS[0]);
  const t = useTranslations("dressing");
  const tw = useTranslations();
  // Races by name in the reader's language, sorted as that language sorts them.
  const races = Object.keys(RACE_LABEL)
    .map((key) => [key, term(tw, "race", key, RACE_LABEL[key])] as const)
    .sort(([, a], [, b]) => a.localeCompare(b));
  const [query, setQuery] = useState("");
  const activeName = term(tw, "slot", SLOT_NAMES[active]);
  // Results carry their slot: until the next answer lands, the last slot's items
  // must not be offered for this one, or a click would dress the wrong slot.
  const [found, setFound] = useState<{ slot: number; hits: ItemHit[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [race, setRace] = useState(start?.look?.race ?? OWN_RACE);
  const [gender, setGender] = useState(start?.look?.gender ?? 0);
  const search = useRef<HTMLDivElement>(null);
  const engine = useStore($engine);
  const manifest = useStore($manifest);
  const customization = useStore($customization);
  const engineLook = useStore($look);

  const body = race === OWN_RACE ? null : bodyOf({ race, gender });
  // The look it opened with, as a line the engine reads on its first load.
  const startBody = start?.look ? bodyOf(start.look) : null;
  const startLine = start?.look?.choices?.length
    ? `rlook ${start.look.race} ${start.look.gender ? "f" : "m"} ${start.look.choices.map(([o, c]) => `${o}:${c}`).join(" ")}`
    : undefined;

  /** The appearance the code carries: what the figure wears, when it is not the body's first look. */
  const choices = useMemo((): [number, number][] | null => {
    if (!body) return null;
    if (manifest?.id === body && manifest.look && engineLook) {
      const first = manifest.look;
      if (Object.keys(engineLook).every((k) => engineLook[Number(k)] === first[Number(k)])) return null;
      const order = customization?.id === body ? customization.options.map((o) => o.id) : Object.keys(engineLook).map(Number);
      return order.filter((id) => engineLook[id] !== undefined).map((id) => [id, engineLook[id]!]);
    }
    // Before the figure answers, the look it opened with stands.
    return body === startBody ? start?.look?.choices ?? null : null;
  }, [body, manifest, engineLook, customization, startBody, start]);

  const toBody = (id: string) => {
    const next = splitBody(id);
    if (!next) return;
    setRace(next.race);
    setGender(next.gender);
  };

  useEffect(() => {
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?slot=${active}&q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setFound({ slot: active, hits: (await res.json()) as ItemHit[] });
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
  }, [active, query]);

  const choose = (slot: number) => {
    setActive(slot);
    setQuery("");
    // The search sits below the slots, off screen from the upper ones on a phone.
    search.current?.scrollIntoView({ block: "nearest" });
  };
  const wear = (piece: ItemHit | null) => setRack((r) => ({ ...r, [active]: piece }));
  const clear = () => setRack((r) => {
    const next = { ...r };
    delete next[active];
    return next;
  });

  const hits = found?.slot === active ? found.hits : null;
  const code = dressedCode(
    Object.fromEntries(Object.entries(rack).map(([slot, piece]) => [slot, piece?.id ?? 0])),
    race === OWN_RACE ? null : { race, gender, choices },
  );
  const worn = Object.fromEntries(Object.entries(rack).flatMap(([slot, piece]) => (piece ? [[slot, piece.display]] : [])));

  return (
    <section className="studio" aria-label={t("label")}>
      <div className="studio__scene" style={{ backgroundImage: `url(${backdropFor("dressing-room")})` }} aria-hidden />
      <div className="studio__grid pt-5">
        <ul className="flex flex-col gap-1.5">
          {LEFT.map((slot) => <Piece key={slot} slot={slot} rack={rack} side="left" active={slot === active} onChoose={choose} />)}
        </ul>
        <div className="studio__stage">
          <ModelStage pieces={worn} wearer={race === OWN_RACE ? null : { race, gender, line: body === startBody ? startLine : undefined }}>
            <ClipPicker />
            <button
              type="button"
              className="pill bg-surface/90 px-2.5"
              aria-label={t("saveImage")}
              title={t("saveImage")}
              disabled={!engine}
              onClick={() => void engine?.exportPNG(2, true)}
            >
              <ImageDown className="size-4" aria-hidden />
            </button>
          </ModelStage>
        </div>
        <ul className="flex flex-col gap-1.5">
          {RIGHT.map((slot) => <Piece key={slot} slot={slot} rack={rack} side="right" active={slot === active} onChoose={choose} />)}
        </ul>
      </div>
      <Tabs defaultValue="pieces" className="mx-5 mb-4 gap-2">
        <TabsList aria-label={t("whatToChange")}>
          <TabsTrigger value="pieces">{t("pieces")}</TabsTrigger>
          <TabsTrigger value="appearance">{t("appearance")}</TabsTrigger>
          <TabsTrigger value="sets">{t("sets")}</TabsTrigger>
        </TabsList>
        {/* Mounted only while open, so the page opens without asking for any set. */}
        <TabsContent value="sets">
          <SetPicker setCount={setCount} onWear={(set) => setRack((r) => wearSet(r, set.pieces))} />
        </TabsContent>
        <TabsContent value="appearance" className="rounded-md border border-line bg-surface/85 p-3">
          {race === OWN_RACE
            ? <p className="text-sm text-ink-dim">{t("chooseRace")}</p>
            : <AppearancePanel onBody={toBody} />}
        </TabsContent>
        <TabsContent value="pieces" forceMount className="data-[state=inactive]:hidden">
      <div ref={search} className="flex scroll-mt-20 flex-col gap-2 rounded-md border border-line bg-surface/85 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg">{activeName}</h2>
          <div className="flex gap-3 text-xs text-ink-dim">
            <button type="button" onClick={() => wear(null)} className="underline underline-offset-2 hover:text-ink">{t("hideSlot")}</button>
            <button type="button" onClick={clear} disabled={!(active in rack)} className="underline underline-offset-2 enabled:hover:text-ink disabled:no-underline disabled:opacity-50">{t("clear")}</button>
          </div>
        </div>
        <Input
          value={query}
          aria-label={t("searchSlot", { slot: activeName })}
          placeholder={t("searchCount", { count: itemCount })}
          onChange={(e) => setQuery(e.target.value)}
        />
        {failed && <p role="alert" className="text-sm text-ink-dim">{t("loadFailed")}</p>}
        {hits && !hits.length && <p className="text-sm text-ink-dim">{t("noFit")}</p>}
        {hits && (
          <ul className="grid max-h-72 grid-cols-1 gap-0.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((item) => (
              <li key={item.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => wear(item)}
                  aria-pressed={rack[active]?.id === item.id}
                  className="flex w-full items-center gap-2 rounded-sm p-1 text-left text-sm transition-colors hover:bg-surface-high"
                >
                  <ItemRing icon={item.icon} slot={active} quality={item.quality} size={36} />
                  <span className="min-w-0 truncate" style={{ color: qualityColour(item.quality) }}>{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
        <Select value={race} onValueChange={setRace}>
          <SelectTrigger size="sm" aria-label={t("race")} className="min-w-44 rounded-full bg-surface">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OWN_RACE}>{t("ownRace")}</SelectItem>
            {races.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {race !== OWN_RACE && (
          <div className="flex gap-1.5" role="group" aria-label={t("sex")}>
            {SEXES.map((label, value) => (
              <button key={label} type="button" aria-pressed={gender === value} onClick={() => setGender(value)} className="pill">
                {capitalise(term(tw, "sex", label))}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {code && canPublish && (
            <Link href={publishHref(code, from)} className="pill">{t("publish")}</Link>
          )}
          {code
            ? <CopyButton code={code} />
            : <p className="text-sm text-ink-dim">{t("choosePiece")}</p>}
        </div>
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 px-5 pb-4 text-[0.7rem] text-ink-faint">
        <span>
          {t.rich("footnote", {
            import: (c) => <Link href="/loadouts" className="underline underline-offset-2 hover:text-ink-dim">{c}</Link>,
          })}
        </span>
        <span>
          {tw.rich("look.credit", {
            narcissus: (c) => <a href={NARCISSUS_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink-dim">{c}</a>,
          })}
        </span>
      </p>
    </section>
  );
}
