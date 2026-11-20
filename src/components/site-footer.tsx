import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/language-switcher";
import { DonateButton } from "@/components/site/support-dialog";
import { DISCORD_URL, GITHUB_URL, KOFI_URL, NARCISSUS_URL } from "@/lib/site";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="foot">
      <div className="wrap foot__inner">
        <Link className="brand" href="/">
          <Image src="/assets/img/logo-96.webp" width={24} height={24} alt="" unoptimized />
          <span>Eclipse</span>
        </Link>
        <nav aria-label={t("label")}>
          <Link href="/#features">{t("features")}</Link>
          <Link href="/guide">{t("guide")}</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>
          <a href={DISCORD_URL} target="_blank" rel="noopener">Discord</a>
          <a href={KOFI_URL} target="_blank" rel="noopener">Ko-fi</a>
          <DonateButton />
          <Link href="/privacy">{t("privacy")}</Link>
          <LanguageSwitcher className="linklike foot__lang" withName />
        </nav>
      </div>
      <p className="wrap foot__legal">
        {t.rich("legal", {
          narcissus: (chunks) => (
            <a href={NARCISSUS_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">{chunks}</a>
          ),
        })}
      </p>
    </footer>
  );
}
