"use client";

import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccountMenu } from "@/components/account-menu";
import { SearchTrigger } from "@/components/command-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SignInDialog, SignInOptions } from "@/components/sign-in-dialog";
import { Icon } from "@/components/site/icons";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DISCORD_URL, GITHUB_URL } from "@/lib/site";
import { useAccount } from "@/lib/use-account";

// The logo is the way home, and each section's pills reach its other views. Support
// and Discord live in the account menu and on the home page.
const NAV = [
  { href: "/community-gallery", label: "gallery", routes: ["/community-gallery"] },
  { href: "/loadouts", label: "loadouts", routes: ["/loadouts", "/sets"] },
  { href: "/dressing-room", label: "dressingRoom", routes: ["/dressing-room", "/mounts"] },
] as const;

function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

/** Says how a sign-in ended, then takes the note out of the address. */
function useAuthNotice() {
  const t = useTranslations("auth");
  useEffect(() => {
    const notices: Record<string, () => void> = {
      "signed-in": () => toast.success(t("signedIn")),
      failed: () => toast.error(t("failed")),
      cancelled: () => toast.error(t("cancelled")),
    };
    const url = new URL(window.location.href);
    const notice = notices[url.searchParams.get("auth") ?? ""];
    if (!notice) return;
    url.searchParams.delete("auth");
    window.history.replaceState(null, "", url);
    // The next task: the Toaster comes later in the layout and is not listening yet.
    const timer = setTimeout(notice);
    return () => clearTimeout(timer);
  }, [t]);
}

export function SiteHeader({ signIn }: { signIn: boolean }) {
  const pathname = usePathname();
  const home = pathname === "/";
  const scrolled = useScrolled();
  const [menu, setMenu] = useState(false);
  const [account, setAccount, checking] = useAccount(signIn);
  const t = useTranslations("nav");
  useAuthNotice();

  const isActive = (n: (typeof NAV)[number]) => n.routes.some((r) => pathname.startsWith(r));

  return (
    <header className={`bar ${home ? "" : "bar--page"} ${!home || scrolled ? "is-solid" : ""}`}>
      <div className="bar__inner">
        <Link className="brand" href="/" aria-label={t("home")}>
          <Image src="/assets/img/logo-96.webp" width={28} height={28} alt="" unoptimized />
          <span>Eclipse</span>
        </Link>
        <nav className="bar__nav" aria-label={t("primary")}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(n) ? "is-active" : undefined}>
              {t(n.label)}
            </Link>
          ))}
        </nav>
        <div className="bar__actions">
          <SearchTrigger />
          <LanguageSwitcher className="lang-btn" />
          {account ? <AccountMenu account={account} onNamed={(name) => setAccount({ ...account, name })} /> : signIn && <SignInDialog pending={checking} />}
          <Link className="btn btn--primary btn--sm" href="/#download" aria-label={t("downloadLabel")}>
            <Icon id="i-download" /><span>{t("download")}</span>
          </Link>
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetTrigger className="icon-btn bar__menu" aria-label={t("openMenu")}>
              <Menu />
            </SheetTrigger>
            <SheetContent className="w-72 border-line bg-surface">
              <SheetHeader>
                <SheetTitle>Eclipse</SheetTitle>
                <SheetDescription className="sr-only">{t("siteNavigation")}</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4 text-ink-dim" aria-label={t("mobile")}>
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-md px-3 py-2 hover:bg-surface-high hover:text-ink">
                    {t(n.label)}
                  </Link>
                ))}
                <Link href="/#support" onClick={() => setMenu(false)} className="rounded-md px-3 py-2 hover:bg-surface-high hover:text-ink">
                  {t("support")}
                </Link>
                <a href={DISCORD_URL} target="_blank" rel="noopener" className="rounded-md px-3 py-2 hover:bg-surface-high hover:text-ink">
                  Discord
                </a>
                <a href={GITHUB_URL} target="_blank" rel="noopener" className="rounded-md px-3 py-2 hover:bg-surface-high hover:text-ink">
                  GitHub
                </a>
              </nav>
              {signIn && !account && !checking && (
                <div className="mx-4 mt-2 border-t border-line pt-4">
                  <SignInOptions />
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
