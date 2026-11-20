"use client";

import { useTranslations } from "next-intl";
import { ClipboardPaste, Loader2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { inspectCode, publishOutfit, removeScreenshot, removeSetPicture, uploadScreenshot, type InspectResult } from "@/app/actions";
import { CopyButton } from "@/components/copy-button";
import { term } from "@/i18n/terms";
import { LoadoutFacts, SlotList } from "@/components/outfit-breakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { encodeOutfit } from "@/lib/codec/outfit";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, SCREENSHOT_TYPES } from "@/lib/codec/schema";
import { WORLD_MODES, WORLD_ROWS } from "@/lib/codec/world";
import { DESCRIPTION_MAX } from "@/lib/comments";
import { ARMOR_LABEL, ARMOR_TYPES, CLASSES, RACE_LABEL, toCss, type ArmorType, type ClassName } from "@/lib/domain";
import { screenshotUrl, thumbOf } from "@/lib/screenshots";
import { shrinkForUpload } from "@/lib/shrink-upload";

type OutfitResult = Extract<InspectResult, { kind: "outfit" }>;
type WorldResult = Extract<InspectResult, { kind: "world" }>;

const NONE = "__none";

function Choice<T extends string>({
  id, label, value, options, format = (v) => v, onChange, required = false,
}: {
  id: string;
  label: string;
  value: T | null;
  options: readonly T[];
  format?: (v: T) => string;
  onChange: (v: T | null) => void;
  required?: boolean;
}) {
  const t = useTranslations("decoder");
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-ink-dim">{label}</label>
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : (v as T))}>
        <SelectTrigger id={id} size="sm" className="w-full bg-surface"><SelectValue /></SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={NONE}>{t("notSet")}</SelectItem>}
          {options.map((o) => <SelectItem key={o} value={o}>{format(o)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A saved set and the pictures its game sent of it, offered to the publish form. */
export interface SetPictures {
  id: string;
  gallery: string[];
}

/** The captures a post will carry, as storage paths, the cover first. */
function Screenshots({
  images, onChange, fromSet,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  fromSet: SetPictures | null;
}) {
  const t = useTranslations("decoder");
  const [uploading, startUpload] = useTransition();
  const full = images.length >= MAX_SCREENSHOTS;

  function remove(path: string) {
    onChange(images.filter((x) => x !== path));
    // A game's picture belongs to its set until it is published: taking it off the
    // form takes it off the set.
    if (fromSet?.gallery.includes(path)) void removeSetPicture(fromSet.id, path);
    else void removeScreenshot(path);
  }

  function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, MAX_SCREENSHOTS - images.length);
    event.target.value = "";
    startUpload(async () => {
      const added: string[] = [];
      for (const file of files) {
        const form = new FormData();
        form.set("file", await shrinkForUpload(file, MAX_SCREENSHOT_BYTES));
        const r = await uploadScreenshot(form);
        if (r.ok) added.push(r.value);
        else toast.error(r.error);
      }
      onChange([...images, ...added]);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-dim">
        {t("shotsLead", { max: MAX_SCREENSHOTS })}
        {fromSet && fromSet.gallery.length > 0 && t("fromGame")}
      </p>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((path, i) => (
            <li key={path} className="relative size-16 overflow-hidden rounded-md border border-line">
              <Image src={thumbOf(screenshotUrl(path))} alt={t("shot", { index: i + 1 })} fill unoptimized sizes="4rem" className="object-cover" />
              <button
                type="button"
                aria-label={t("removeShot", { index: i + 1 })}
                onClick={() => remove(path)}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/70 p-0.5 text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="pill self-start">
        {uploading && <Loader2 className="size-3.5 animate-spin" />}
        {t("upload")}
        <input
          type="file"
          multiple
          accept={SCREENSHOT_TYPES.join(",")}
          disabled={full || uploading}
          onChange={upload}
          className="sr-only"
        />
      </label>
    </div>
  );
}

/** The published look a code came from, by way of the Dressing room. */
export interface RemixOf {
  id: string;
  title: string;
  author: string | null;
}

/** `code` is null until a valid loadout code is pasted; the form can be filled in before that. */
function PublishForm({ code, remixOf, fromSet }: { code: string | null; remixOf: RemixOf | null; fromSet: SetPictures | null }) {
  const t = useTranslations("decoder");
  const tw = useTranslations();
  const [credit, setCredit] = useState(remixOf !== null);
  const [title, setTitle] = useState("");
  const [className, setClassName] = useState<ClassName | null>(null);
  const [armor, setArmor] = useState<ArmorType | null>(null);
  const [race, setRace] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [gallery, setGallery] = useState<string[]>(fromSet?.gallery ?? []);
  // Which code was published, so pasting another one offers the form again.
  const [published, setPublished] = useState<{ id: string; code: string } | null>(null);
  const [error, setError] = useState<{ text: string; existing?: string } | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code || gallery.length === 0) return;
    setError(null);
    start(async () => {
      const r = await publishOutfit({
        title,
        code,
        className: className ?? undefined,
        armor: armor ?? undefined,
        race: race ?? undefined,
        description,
        gallery,
        remixedFrom: credit && remixOf ? remixOf.id : undefined,
      });
      if (!r.ok) {
        setError({ text: r.error, existing: r.existing });
        return;
      }
      setPublished({ id: r.id, code });
      toast.success(t("published"));
    });
  }

  if (published && published.code === code) {
    return (
      <p className="text-sm text-ink-dim">
        {t.rich("publishedOpen", {
          open: (c) => <Link href={`/community-gallery/${published.id}`} className="text-amber underline underline-offset-2">{c}</Link>,
        })}
      </p>
    );
  }

  return (
    <form id="publish" onSubmit={submit} className="flex scroll-mt-24 flex-col gap-3">
      {remixOf && (
        <label className="flex items-center gap-2 text-sm text-ink-dim">
          <input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />
          <span>
            {t.rich("basedOn", {
              title: remixOf.title,
              look: (c) => <Link href={`/community-gallery/${remixOf.id}`} className="text-amber underline underline-offset-2">{c}</Link>,
            })}
            {remixOf.author && t("basedOnBy", { author: remixOf.author })}
          </span>
        </label>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="outfit-title" className="text-xs text-ink-dim">{t("title")}</label>
        <Input id="outfit-title" value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} className="bg-surface" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Choice id="outfit-class" label={t("class")} value={className} options={CLASSES} format={(c) => term(tw, "class", c)} onChange={setClassName} />
        <Choice id="outfit-armor" label={t("armor")} value={armor} options={ARMOR_TYPES} format={(a) => term(tw, "armor", a, ARMOR_LABEL[a])} onChange={setArmor} />
        <Choice
          id="outfit-race"
          label={t("race")}
          value={race}
          options={Object.keys(RACE_LABEL)}
          format={(k) => term(tw, "race", k, RACE_LABEL[k])}
          onChange={setRace}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="outfit-description" className="flex justify-between text-xs text-ink-dim">
          <span>{t.rich("description", { optional: (c) => <span className="text-ink-faint">{c}</span> })}</span>
          {description.length > DESCRIPTION_MAX - 80 && (
            <span className={`nums ${description.length > DESCRIPTION_MAX ? "text-bad" : "text-ink-faint"}`}>
              {DESCRIPTION_MAX - description.length}
            </span>
          )}
        </label>
        <Textarea
          id="outfit-description"
          value={description}
          rows={3}
          placeholder={t("inspired")}
          onChange={(e) => setDescription(e.target.value)}
          className="max-h-48 resize-none bg-surface"
        />
      </div>
      <Screenshots images={gallery} onChange={setGallery} fromSet={fromSet} />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error.text}
          {error.existing && (
            <>
              {" "}<Link href={`/community-gallery/${error.existing}`} className="text-amber underline underline-offset-2">{t("openIt")}</Link>
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !code || gallery.length === 0}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("publish")}
        </Button>
        {!code ? (
          <p className="text-xs text-ink-faint">{t("pasteFirst")}</p>
        ) : gallery.length === 0 && (
          <p className="text-xs text-ink-faint">{t("addShot")}</p>
        )}
      </div>
    </form>
  );
}

function OutfitPanel({ result, code, removed, onRemove }: {
  result: OutfitResult;
  code: string;
  removed: number[];
  onRemove: (slot: number) => void;
}) {
  const shown = result.resolved.slots.filter((s) => !removed.includes(s.slot));
  const t = useTranslations("decoder");
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" aria-label={t("holds")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base">{t("pieceCount", { count: shown.length })}</h2>
        <CopyButton code={code} label={removed.length ? t("copyEdited") : undefined} />
      </div>
      <SlotList slots={shown} onRemove={onRemove} />
      <LoadoutFacts resolved={result.resolved} />
      {result.warnings.map((w) => <p key={w} className="text-xs text-info">{w}</p>)}
    </section>
  );
}

/** Where a code's pieces appear, before one is pasted. */
function EmptyPanel() {
  const t = useTranslations("decoder");
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" aria-label={t("holds")}>
      <h2 className="text-base">{t("noPieces")}</h2>
      <p className="text-sm text-ink-dim">{t("noPiecesLead")}</p>
    </section>
  );
}

function WorldResultView({ result, code }: { result: WorldResult; code: string }) {
  const t = useTranslations("decoder");
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" aria-label={t("holds")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base">{t("placeCount", { count: result.places.length })}</h2>
        <CopyButton code={code} toastHint={t("worldHint")} />
      </div>
      <ul className="divide-y divide-line">
        {result.places.map((p) => (
          <li key={p.tag} className="py-2">
            <p className="text-sm">{p.info?.name ?? t("unknownPlace", { tag: p.tag })}</p>
            <p className="text-xs text-ink-faint">
              {p.info ? p.info.path || p.info.group : t("notInCatalogue")}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-3">
              {WORLD_ROWS.map((row) => {
                const r = p.rows[row];
                if (!r) return null;
                return (
                  <li key={row} className="flex items-center gap-1.5 text-xs text-ink-dim capitalize">
                    <span aria-hidden className="size-3 rounded-full border border-line" style={{ background: r.colour ? toCss(r.colour) : undefined }} />
                    {row}
                    {r.mode !== null && <span className="text-ink-faint normal-case">{WORLD_MODES[r.mode]}</span>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Decoder({ initial = "", canPublish = false, remixOf = null, fromSet = null }: {
  initial?: string;
  canPublish?: boolean;
  remixOf?: RemixOf | null;
  /** The saved set `initial` came from, whose pictures are offered while it is unchanged. */
  fromSet?: SetPictures | null;
}) {
  const t = useTranslations("decoder");
  const [text, setText] = useState(initial);
  const [result, setResult] = useState<InspectResult | null>(null);
  // Slots handed back to the wearer's gear, as the game's own slot clear does. A new code starts with none.
  const [removed, setRemoved] = useState<number[]>([]);
  const [pending, start] = useTransition();

  function change(next: string) {
    setText(next);
    setRemoved([]);
  }

  const outfit = result?.kind === "outfit" ? result : null;
  const code = useMemo(() => {
    if (!outfit) return null;
    const slots = Object.fromEntries(
      Object.entries(outfit.outfit.slots).filter(([s]) => !removed.includes(Number(s))),
    );
    return encodeOutfit({ ...outfit.outfit, slots });
  }, [outfit, removed]);
  // A set's pictures show its look: an edited look starts with none.
  const pictures = text === initial && removed.length === 0 ? fromSet : null;

  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      return;
    }
    const handle = setTimeout(() => start(async () => setResult(await inspectCode(text))), 150);
    return () => clearTimeout(handle);
  }, [text]);

  async function paste() {
    try {
      change(await navigator.clipboard.readText());
    } catch {
      toast.error(t("clipboardRefused"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="corona-rim rounded-md">
        <Textarea
          id="code"
          value={text}
          autoFocus
          spellCheck={false}
          aria-label={t("codeLabel")}
          aria-invalid={result?.kind === "error"}
          placeholder="ECA1:c2xvdCAwIDI1OTMwNgpzbG90IDIgMTAwMTczMw..."
          onChange={(e) => change(e.target.value)}
          className="min-h-28 bg-surface font-mono text-xs leading-[18px] break-all"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={paste} className="gap-1.5">
          <ClipboardPaste className="size-4" strokeWidth={1.5} />
          {t("paste")}
        </Button>
        {pending && <Loader2 className="size-4 animate-spin text-ink-faint" aria-label={t("reading")} />}
        {result?.kind === "error" && <p role="alert" className="text-sm text-bad">{result.error}</p>}
        {result && result.kind !== "error" && <p className="text-sm text-good">{t("valid", { kind: result.kind })}</p>}
      </div>
      {result?.kind === "world" ? (
        <WorldResultView result={result} code={text.trim()} />
      ) : canPublish ? (
        // The form shows before a code is pasted and stays mounted across pastes, so what was typed is kept.
        <div className="grid gap-4 lg:grid-cols-2">
          {outfit && code ? (
            <OutfitPanel result={outfit} code={code} removed={removed} onRemove={(s) => setRemoved((r) => [...r, s])} />
          ) : (
            <EmptyPanel />
          )}
          <section className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" aria-label={t("publishLabel")}>
            <h2 className="text-base">{t("publishIt")}</h2>
            <PublishForm key={pictures ? "set" : "code"} code={code} remixOf={remixOf} fromSet={pictures} />
          </section>
        </div>
      ) : (
        outfit && code && (
          <OutfitPanel result={outfit} code={code} removed={removed} onRemove={(s) => setRemoved((r) => [...r, s])} />
        )
      )}
    </div>
  );
}
