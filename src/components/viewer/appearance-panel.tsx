"use client";

import { useTranslations } from "next-intl";
import { useStore } from "@nanostores/react";
import { $customization, $look, $manifest } from "@eclipse/engine/stores";
import { classTag, randomLook, type CustomChoice, type CustomOption, type Look } from "@eclipse/format";
import { ChevronLeft, ChevronRight, Dices, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { $engine } from "@/lib/viewer/state";

/**
 * The body's own customization, after Eclipse's UiCustom.cpp by way of Eclipse-Viewer:
 * retail's tabs, options and names, in retail's order. Only real choices can be worn.
 */

const hasArt = (c: CustomChoice) => !!(c.mat?.length || c.geo?.length || c.pgeo?.length);

/** A row whose first real choice is a colour shows swatches, as retail does. */
const isSwatchRow = (o: CustomOption) => !!o.choices.find(hasArt)?.sw?.length;

function swatch(sw?: string[]) {
  if (!sw?.length) return undefined;
  if (sw.length === 1) return sw[0];
  return `linear-gradient(to right bottom,${sw[0]} 50%,${sw[1]} 50.3%)`;
}

/** "Face (Undead)" reads Face; retail's "Mirror" (the barber's close-up details) reads Details. */
function tabLabel(name: string) {
  const n = name.split(" (")[0] ?? "";
  if (n === "Mirror") return "Details";
  return n || "Options";
}

const choiceName = (o: CustomOption, c: CustomChoice, i: number) => {
  const cls = classTag(c.cls);
  const name = c.name || (!c.sw?.length && !hasArt(c) ? "Off" : `${o.name} ${i + 1}`);
  return cls ? `${name} (${cls})` : name;
};

function SwatchRow({ o, look, onPick }: { o: CustomOption; look: Look; onPick: (c: CustomChoice) => void }) {
  const at = Math.max(0, o.choices.findIndex((c) => c.id === look[o.id]));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex justify-between text-xs"><span>{o.name}</span><span className="text-ink-dim">{choiceName(o, o.choices[at]!, at)}</span></p>
      <div className="flex flex-wrap gap-1">
        {o.choices.map((c, i) => {
          const name = choiceName(o, c, i);
          const on = i === at;
          return (
            <button
              key={c.id}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={on}
              onPointerEnter={() => $engine.get()?.prefetchLook({ ...look, [o.id]: c.id })}
              onClick={() => onPick(c)}
              className={cn(
                "grid size-6 place-items-center rounded-sm border text-[0.6rem] text-ink-dim",
                on ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
              )}
              style={{ background: swatch(c.sw) }}
            >
              {c.sw?.length ? null : i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepRow({ o, look, onPick }: { o: CustomOption; look: Look; onPick: (c: CustomChoice) => void }) {
  const t = useTranslations("viewer");
  const n = o.choices.length;
  const at = Math.max(0, o.choices.findIndex((c) => c.id === look[o.id]));
  const step = (d: number) => o.choices[(at + d + n) % n]!;
  const warm = (c: CustomChoice) => $engine.get()?.prefetchLook({ ...look, [o.id]: c.id });
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs">{o.name}</p>
      <div className="flex items-center gap-1">
        <button type="button" className="pill px-2" disabled={n <= 1} aria-label={t("previous", { name: o.name })} onPointerEnter={() => warm(step(-1))} onClick={() => onPick(step(-1))}>
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm" aria-live="polite">
          {choiceName(o, o.choices[at]!, at)} <span className="text-ink-faint">{at + 1}/{n}</span>
        </span>
        <button type="button" className="pill px-2" disabled={n <= 1} aria-label={t("next", { name: o.name })} onPointerEnter={() => warm(step(1))} onClick={() => onPick(step(1))}>
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Face, hair, skin and the rest for the body on stage. A choice that is a posture asks for another body. */
export function AppearancePanel({ onBody }: { onBody: (bodyId: string) => void }) {
  const manifest = useStore($manifest);
  const data = useStore($customization);
  const look = useStore($look);
  const engine = useStore($engine);
  const t = useTranslations("viewer");
  const [tabId, setTabId] = useState<number | null>(null);

  // Fetched when the panel opens, never with the figure: it is the size of a texture.
  useEffect(() => {
    if (engine && manifest?.customization && data?.id !== manifest.id) void engine.loadCustomization();
  }, [engine, manifest, data?.id]);
  useEffect(() => setTabId(null), [manifest?.id]);

  const tabs = data?.tabs ?? [];
  const activeTab = tabs.find((t) => t.id === tabId)?.id ?? tabs[0]?.id ?? null;
  const options = useMemo(() => (data?.options ?? []).filter((o) => o.tab === activeTab), [data, activeTab]);

  if (!manifest) return <p className="text-sm text-ink-dim">{t("onItsWay")}</p>;
  if (!manifest.customization) return <p className="text-sm text-ink-dim">{t("nothing")}</p>;
  if (!data || !look || data.id !== manifest.id) return <p role="status" className="text-sm text-ink-dim">{t("loadingChair")}</p>;

  const pick = (o: CustomOption, c: CustomChoice) => {
    if (look[o.id] === c.id) return;
    // A posture is its own body; the parent moves the rack over to it.
    if (c.body && c.body !== manifest.id) onBody(c.body);
    else void engine?.setLook({ ...look, [o.id]: c.id });
  };

  return (
    <div className="flex flex-col gap-3">
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("category")}>
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === activeTab} className="pill" onClick={() => setTabId(t.id)}>
              {tabLabel(t.name)}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((o) =>
          isSwatchRow(o)
            ? <SwatchRow key={o.id} o={o} look={look} onPick={(c) => pick(o, c)} />
            : <StepRow key={o.id} o={o} look={look} onPick={(c) => pick(o, c)} />,
        )}
      </div>
      <div className="flex gap-2">
        <button type="button" className="pill" onClick={() => void engine?.setLook(randomLook(data.options, look))}>
          <Dices className="size-3.5" aria-hidden />Randomize
        </button>
        <button type="button" className="pill" disabled={!manifest.look} onClick={() => manifest.look && void engine?.setLook(manifest.look)}>
          <RotateCcw className="size-3.5" aria-hidden />Reset
        </button>
      </div>
    </div>
  );
}
