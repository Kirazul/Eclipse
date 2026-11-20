"use client";

import { ChevronDown, Search, X } from "lucide-react";
import Image from "next/image";
import { debounce, useQueryStates } from "nuqs";
import { useTransition } from "react";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ARMOR_LABEL, ARMOR_TYPES, CATEGORIES, CLASSES, RACE_LABEL, SORT_LABEL, SORTS } from "@/lib/domain";
import { wardrobeParsers } from "@/lib/search-params";
import { classArt, raceArt } from "@/lib/wow-assets";

const ALL = "__all";

function Filter<T extends string>({
  label, value, options, onChange, format = (v) => v, art,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T | null) => void;
  format?: (value: T) => string;
  art?: (value: T) => string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : (v as T))}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-28 rounded-full bg-surface">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Any {label.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {art && <Image src={art(o)} alt="" width={18} height={18} unoptimized className="rounded-sm" />}
            {format(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Category = (typeof CATEGORIES)[number];

/** One menu for what a look contains. It stays open so several tags can be set in one go. */
function TagMenu({
  category, pictures, onCategory, onPictures,
}: {
  category: Category | null;
  pictures: boolean;
  onCategory: (value: Category) => void;
  onPictures: () => void;
}) {
  const count = (category ? 1 : 0) + (pictures ? 1 : 0);
  const item = (checked: boolean, label: string, onSelect: () => void) => (
    <DropdownMenuCheckboxItem
      key={label}
      checked={checked}
      onCheckedChange={onSelect}
      onSelect={(e) => e.preventDefault()}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count ? `Tags, ${count} selected` : "Tags"}
          className="flex h-7 min-w-28 items-center justify-between gap-1.5 rounded-full border border-input bg-surface py-2 pr-2 pl-2.5 text-sm whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:border-line-strong"
        >
          <span className="flex items-center gap-1.5">
            Tags
            {count > 0 && (
              <span className="nums grid size-4 place-items-center rounded-full bg-ink text-[10px] font-medium text-void">{count}</span>
            )}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {item(pictures, "With pictures", onPictures)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Changes</DropdownMenuLabel>
        {CATEGORIES.map((c) => item(category === c, c, () => onCategory(c)))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Race, sort and category only mean something on posts people have published. */
export function OutfitFilters({ count, live }: { count: number; live: boolean }) {
  const [pending, startTransition] = useTransition();
  const [f, setQuery] = useQueryStates(wardrobeParsers, { shallow: false, startTransition });
  // A new filter changes what the pages hold, so it starts from the first.
  const set: typeof setQuery = (values, options) =>
    setQuery(typeof values === "function" ? values : { ...values, page: null }, options);
  const active = f.q || f.class || f.race || f.armor || f.category || f.tag || f.pictures;
  const raceKeys = Object.keys(RACE_LABEL);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 basis-full sm:basis-0">
          <Search className="absolute top-2.5 left-3 size-4 text-ink-faint" strokeWidth={1.5} />
          <Input
            value={f.q}
            aria-label="Search outfits"
            placeholder="Search by title"
            onChange={(e) => set({ q: e.target.value }, { limitUrlUpdates: debounce(250) })}
            className="h-9 rounded-full bg-surface pl-9"
          />
        </div>
        <Filter label="Class" value={f.class} options={CLASSES} art={classArt} onChange={(v) => set({ class: v })} />
        {live && <Filter label="Race" value={f.race} options={raceKeys} format={(k) => RACE_LABEL[k]} art={(k) => raceArt(k)} onChange={(v) => set({ race: v })} />}
        <Filter label="Armor" value={f.armor} options={ARMOR_TYPES} format={(k) => ARMOR_LABEL[k]} onChange={(v) => set({ armor: v })} />
        {live && (
          <TagMenu
            category={f.category}
            pictures={f.pictures}
            onCategory={(c) => set({ category: f.category === c ? null : c })}
            onPictures={() => set({ pictures: !f.pictures })}
          />
        )}
        {live && (
          <Select value={f.sort} onValueChange={(v) => set({ sort: v as (typeof SORTS)[number] })}>
            <SelectTrigger size="sm" aria-label="Sort" className="min-w-28 rounded-full bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SORT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {f.tag && (
          <button type="button" className="pill" aria-pressed aria-label={`Remove tag ${f.tag}`} onClick={() => set({ tag: null })}>
            {f.tag}
            <X className="size-3" />
          </button>
        )}
        <p className="nums ml-auto flex items-center gap-2 text-xs text-ink-faint" aria-live="polite">
          {active && (
            <button
              type="button"
              onClick={() => set({ q: "", class: null, race: null, armor: null, category: null, tag: null, pictures: false })}
              className="flex items-center gap-1 text-ink-dim hover:text-ink"
            >
              <X className="size-3" /> Clear
            </button>
          )}
          <span className={pending ? "opacity-50" : undefined}>
            {count} {count === 1 ? "look" : "looks"}
          </span>
        </p>
      </div>
    </div>
  );
}
