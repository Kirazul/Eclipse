"use client";

import { useTranslations } from "next-intl";
import { useStore } from "@nanostores/react";
import { $clipLoading, $clips, $currentClip } from "@eclipse/engine/stores";
import type { ClipEntry } from "@eclipse/format";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { $engine } from "@/lib/viewer/state";

const TPOSE = "T-Pose";

const clipLabel = (c: ClipEntry) => (c.variation ? `${c.name} ${c.variation + 1}` : c.name);

/** Every animation the body has, searchable, with the T-pose pinned first (Eclipse-Viewer ClipPicker). */
export function ClipPicker() {
  const clips = useStore($clips);
  const current = useStore($currentClip);
  const loading = useStore($clipLoading);
  const engine = useStore($engine);
  const t = useTranslations("viewer");
  const [open, setOpen] = useState(false);

  const rows = [
    { id: TPOSE, label: TPOSE },
    ...[...clips]
      .sort((a, b) => clipLabel(a).localeCompare(clipLabel(b), undefined, { numeric: true }))
      .map((c) => ({ id: c.id, label: clipLabel(c) })),
  ];
  const label = rows.find((r) => r.id === current)?.label ?? TPOSE;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={t("animation")}
          disabled={!engine || !clips.length}
          className="pill min-w-0 flex-1 justify-between bg-surface/90"
        >
          <span className={cn("truncate", loading && "text-amber")}>{label}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} align="start" collisionPadding={8} className="z-50 w-64 rounded-md border border-line bg-surface shadow-lg">
          <Command loop>
            <CommandInput placeholder={t("searchAnimations")} autoFocus />
            <CommandList className="max-h-72">
              <CommandEmpty>{t("noAnimations")}</CommandEmpty>
              {rows.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.label} ${r.id}`}
                  onSelect={() => {
                    void engine?.playAnimationByName(r.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-3.5", (current ?? TPOSE) === r.id ? "opacity-100" : "opacity-0")} aria-hidden />
                  {r.label}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
