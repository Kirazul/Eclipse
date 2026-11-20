"use client";

import { BadgeCheck, BookOpen, Braces, Download, Images, LayoutGrid, Rabbit, Search, Shirt } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/command";
import type { SearchIndex } from "@/app/api/search/route";
import { Avatar } from "@/components/avatar";
import { sizedAvatar } from "@/lib/avatar";
import type { CreatorEntry, SearchEntry } from "@/lib/data/types";

// Until the CDN's copy from before creators were listed expires, the route may still answer with only the looks.
const readIndex = (body: SearchIndex | SearchEntry[]): SearchIndex =>
  Array.isArray(body) ? { looks: body, creators: [] } : body;

const PAGES = [
  { href: "/community-gallery", label: "gallery", icon: Shirt },
  { href: "/community-gallery?pictures=true", label: "pictures", icon: Images },
  { href: "/loadouts", label: "import", icon: Braces },
  { href: "/dressing-room", label: "dressingRoom", icon: Shirt },
  { href: "/mounts", label: "mounts", icon: Rabbit },
  { href: "/guide", label: "guide", icon: BookOpen },
  { href: "/#features", label: "features", icon: LayoutGrid },
  { href: "/#download", label: "download", icon: Download },
] as const;

export function CommandMenu() {
  const t = useTranslations("search");
  const [open, setOpen] = useState(false);
  const [outfits, setOutfits] = useState<SearchEntry[]>([]);
  const [creators, setCreators] = useState<CreatorEntry[]>([]);
  const fetched = useRef(false);
  const router = useRouter();

  // Fetched on the first open, so the list is not in every page's HTML. A failed
  // fetch leaves the Pages group working and tries again on the next open.
  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    fetch("/api/search")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<SearchIndex | SearchEntry[]>;
      })
      .then((body) => {
        const index = readIndex(body);
        setOutfits(index.looks);
        setCreators(index.creators);
      })
      .catch(() => {
        fetched.current = false;
      });
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("eclipse:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("eclipse:search", onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("title")} description={t("description")}>
      {/* This shadcn CommandDialog has no cmdk root of its own: without Command
          the input has no store, and opening the menu takes the page down. */}
      <Command>
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>
        <CommandGroup heading={t("pages")}>
          {PAGES.map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} value={t(`page.${label}`)} onSelect={() => go(href)}>
              <Icon strokeWidth={1.5} />
              {t(`page.${label}`)}
            </CommandItem>
          ))}
        </CommandGroup>
        {creators.length > 0 && (
          <CommandGroup heading={t("creators")}>
            {creators.map((c) => (
              <CommandItem key={c.id} value={`${c.name} ${c.id}`} onSelect={() => go(`/creators/${c.id}`)}>
                <Avatar account={{ name: c.name, avatar: sizedAvatar(c.avatar) }} size={22} />
                <span className="truncate">{c.name}</span>
                {c.verified && <BadgeCheck className="text-amber" strokeWidth={1.5} aria-label={t("verified")} />}
                <CommandShortcut className="tracking-normal">{t("looks", { count: c.looks })}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={t("outfits")}>
          {outfits.map((o) => (
            // The id keeps values unique: real sets can share a name.
            <CommandItem key={o.id} value={`${o.title} ${o.author ?? ""} ${o.id}`} onSelect={() => go(`/community-gallery/${o.id}`)}>
              <span className="truncate">{o.title}</span>
              {o.author && <CommandShortcut className="tracking-normal">{o.author}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function SearchTrigger() {
  const t = useTranslations("search");
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("eclipse:search"))}
      className="icon-btn"
      aria-label={t("button")}
      aria-keyshortcuts="Control+K"
      title={t("buttonTitle")}
    >
      <Search />
    </button>
  );
}
