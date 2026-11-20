"use client";

import { BadgeCheck, Bookmark, ChevronDown, Flag, Heart, Layers, LogOut, Settings, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";
import { AccountDialog } from "@/components/account-dialog";
import { Avatar } from "@/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/site/icons";
import { PROVIDER_NAMES } from "@/lib/account";
import { DISCORD_URL } from "@/lib/site";
import type { Account } from "@/lib/data/types";

/** The header's signed-in control. Settings opens by itself until a name is chosen. */
export function AccountMenu({ account, linkedRoles = false, onNamed }: {
  account: Account;
  /** Offer Discord roles: only once they are switched on. */
  linkedRoles?: boolean;
  onNamed: (name: string) => void;
}) {
  const t = useTranslations("account");
  const [settings, setSettings] = useState(account.name === null);
  const signOut = useRef<HTMLFormElement>(null);
  const provider = account.provider ? PROVIDER_NAMES[account.provider] : null;

  return (
    <>
      {/* Not modal: a modal menu and the dialog it opens both lock the page, and fight over it. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="btn btn--ghost btn--sm bar__account" aria-label={t("menuLabel")}>
          <Avatar account={account} />
          <span className="bar__account-name">{account.name ?? t("chooseName")}</span>
          <ChevronDown className="bar__account-caret" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar account={account} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">{account.name ?? t("noName")}</p>
              {provider && <p className="text-xs text-ink-faint">{t("signedInWith", { provider })}</p>}
              {account.moderator && <p className="text-xs text-amber">{t("moderator")}</p>}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/creators/${account.id}`}><UserRound />{t("profile")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/community-gallery?saved=true&sort=newest"><Bookmark />{t("bookmarks")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/loadouts"><Layers />{t("loadouts")}</Link>
          </DropdownMenuItem>
          {account.moderator && (
            <DropdownMenuItem asChild>
              <Link href="/moderation"><Flag />{t("reports")}</Link>
            </DropdownMenuItem>
          )}
          {linkedRoles && (
            <DropdownMenuItem asChild>
              <Link href="/linked-roles"><BadgeCheck />{t("discordRoles")}</Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setSettings(true)}><Settings />{t("settings")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/#support"><Heart />{t("support")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={DISCORD_URL} target="_blank" rel="noopener"><Icon id="i-discord" />{t("discord")}</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut.current?.requestSubmit()}><LogOut />{t("signOut")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Outside the menu, which unmounts as soon as an item is chosen. A real form:
          signing out ends in a redirect, which a page refresh must not repeat. */}
      <form ref={signOut} action="/auth/logout" method="post" hidden />
      <AccountDialog account={account} open={settings} onOpenChange={setSettings} onNamed={onNamed} />
    </>
  );
}
