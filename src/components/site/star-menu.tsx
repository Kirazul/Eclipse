"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/components/site/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GITHUB_URL, WEB_GITHUB_URL } from "@/lib/site";

const REPOS = [
  { href: GITHUB_URL, name: "Kirazul/Eclipse", note: "starOverlay" },
  { href: WEB_GITHUB_URL, name: "seolyam/eclipse-web", note: "starWebsite" },
] as const;

/** Star is two repositories, the overlay's and the website's, so it asks which. */
export function StarMenu({ children }: { children: ReactNode }) {
  const t = useTranslations("support");
  // In the support dialog the menu mounts inside it; elsewhere on the body.
  const [box, setBox] = useState<HTMLElement | null>(null);
  // Stable, so React calls it only when the trigger mounts or unmounts.
  const findBox = useCallback((el: HTMLElement | null) => setBox(el?.closest("dialog") ?? null), []);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="slink" ref={findBox}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent container={box} align="end" className="star-menu">
        {REPOS.map((r) => (
          <DropdownMenuItem key={r.href} asChild>
            <a href={r.href} target="_blank" rel="noopener">
              <Icon id="i-github" />
              <span className="star-menu__text">
                <strong>{r.name}</strong>
                <span>{t(r.note)}</span>
              </span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
