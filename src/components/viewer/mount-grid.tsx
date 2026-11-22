"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { useDeferredValue, useState } from "react";
import { HoverLink } from "@/components/hover-link";
import { Input } from "@/components/ui/input";
import type { MountCard } from "@/lib/viewer/mounts";

const KINDS = [
  { value: "all", label: "all" },
  { value: "flying", label: "flying" },
  { value: "ground", label: "ground" },
] as const;

/** Every mount, searchable by name, each opening on its own animated stage. */
export function MountGrid({ mounts }: { mounts: MountCard[] }) {
  const t = useTranslations("mounts");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("all");
  const q = useDeferredValue(query.trim().toLowerCase());
  const shown = mounts.filter(
    (m) => (kind === "all" || m.flying === (kind === "flying")) && (!q || m.name.toLowerCase().includes(q)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("search")}
          placeholder={t("searchCount", { count: mounts.length })}
          className="max-w-sm"
        />
        <div className="flex gap-1.5" role="group" aria-label={t("kind")}>
          {KINDS.map((k) => (
            <button key={k.value} type="button" className="pill" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>
      {!shown.length && <p className="text-sm text-ink-dim">{t("none")}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((m) => (
          <li key={m.id}>
            <HoverLink href={`/mounts/${m.id}`} className="group flex flex-col overflow-hidden rounded-md border border-line bg-surface transition-colors hover:border-line-strong">
              <span className="relative aspect-square bg-surface-high">
                {m.poster && <Image src={m.poster} alt="" fill unoptimized sizes="12rem" className="object-contain p-2 transition-transform group-hover:scale-105" />}
              </span>
              <span className="flex flex-col gap-0.5 p-2">
                <span className="truncate text-sm">{m.name}</span>
                <span className="text-xs text-ink-faint">
                  {m.flying ? t("flying") : t("ground")}{m.colours > 1 ? t("colours", { count: m.colours }) : ""}
                </span>
              </span>
            </HoverLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
