import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { preload } from "react-dom";
import { HeroStage } from "@/components/site/hero-stage";
import { Icon } from "@/components/site/icons";
import { SupportLinks } from "@/components/site/support-links";
import { WalletSection } from "@/components/site/wallets";
import { discordMembers } from "@/lib/discord-invite";
import { FEATURES } from "@/lib/features";
import { TALL_MEDIA, TALL_SIZES, WIDE_SIZES, tallArt, wideArt } from "@/lib/hero-art";
import { dllReleases } from "@/lib/releases";
import { DISCORD_URL, dllUrl, downloadUrl, releasesUrl } from "@/lib/site";

// The official page's sections, word for word: only the links are new. The hero is
// the exception: Kira took the showcase video out on 2026-11-14 and asked for the
// text in the middle of the screen.

/** Discord's own member count for the invite, or nothing when Discord does not say. */
async function DiscordMembers() {
  const count = await discordMembers();
  const t = await getTranslations("landing");
  return count ? <span className="btn__count">{t("members", { count })}</span> : null;
}

/** The newest DLL on its own, from the Kirazul/Eclipse releases, with its version once GitHub says. */
function DllLink({ href = dllUrl, version }: { href?: string; version?: string }) {
  return (
    <a className="btn btn--ghost" href={href} rel="noopener">
      <Icon id="i-download" /><span>dinput8.dll</span>
      {version && <span className="btn__count">v{version}</span>}
    </a>
  );
}

async function DllButton() {
  const [latest] = await dllReleases();
  return <DllLink href={latest?.url} version={latest?.version} />;
}

/** The earlier DLLs, each its own release, for players who want a previous version. */
async function EarlierDlls() {
  const earlier = (await dllReleases()).slice(1, 4);
  if (!earlier.length) return null;
  const t = await getTranslations("landing");
  return (
    <p className="fine">
      {t("dllEarlier")}{" "}
      {earlier.map((r, i) => (
        <Fragment key={r.version}>{i > 0 && ", "}<a href={r.url} rel="noopener">v{r.version}</a></Fragment>
      ))}
      {" "}&middot;{" "}
      <a href={releasesUrl} target="_blank" rel="noopener">{t("dllAll")}</a>
    </p>
  );
}

export function Hero() {
  // Same srcset and sizes as the <picture>, so each is one download. preload()
  // reaches <head>; a <link> with no href would stay here in the body.
  const art = { as: "image", type: "image/avif", fetchPriority: "high" } as const;
  preload("/assets/img/bg-wide-1920.avif", { ...art, media: "(min-aspect-ratio: 4/5)", imageSrcSet: wideArt("avif"), imageSizes: WIDE_SIZES });
  preload("/assets/img/bg-tall-960.avif", { ...art, media: TALL_MEDIA, imageSrcSet: tallArt("avif"), imageSizes: TALL_SIZES });
  const t = useTranslations("landing");

  return (
    <section className="hero" id="top">
      <HeroStage />
      <div className="wrap hero__text">
        <h1>{t.rich("headline", { flow: (c) => <span className="flow-text">{c}</span> })}</h1>
        <p>{t.rich("lead", { gallery: (c) => <Link href="/community-gallery">{c}</Link> })}</p>
        <div className="cta">
          <a className="btn btn--primary" href="#download"><Icon id="i-download" /><span>{t("download")}</span></a>
          <Link className="btn btn--ghost" href="/community-gallery">{t("browse")}</Link>
        </div>
        <a className="hero__community" href={DISCORD_URL} target="_blank" rel="noopener">
          <Icon id="i-discord" /><span>{t("discord")}</span>
          <Suspense fallback={null}><DiscordMembers /></Suspense>
        </a>
      </div>
      <div className="wrap hero__foot">
        <a className="hero__more" href="#features" aria-label={t("more")}>
          <ChevronDown aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

export function Features({ live }: { live: boolean }) {
  const t = useTranslations("landing");
  const tf = useTranslations("features");
  // FEATURES keeps the English title as each feature's key.
  const text = (title: string, part: "title" | "body") => tf(`${title}.${part}` as never);
  return (
    <section className="section" id="features">
      <div className="wrap">
        <header className="section__head">
          <h2>{t("featuresTitle")}</h2>
          <p>{t.rich("featuresLead", { kbd: (c) => <kbd>{c}</kbd> })}</p>
        </header>
        <div className="features">
          {FEATURES.map((f) => (
            <article key={f.title}>
              <h3>{f.href && (live || !f.needsPosts) ? <Link href={f.href}>{text(f.title, "title")}</Link> : text(f.title, "title")}</h3>
              <p>{text(f.title, "body")}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Download() {
  const t = useTranslations("landing");
  const code = (c: React.ReactNode) => <code>{c}</code>;
  const kbd = (c: React.ReactNode) => <kbd>{c}</kbd>;
  return (
    <section className="section" id="download">
      <div className="wrap">
        <div className="panel download">
          <div className="download__intro">
            <h2>{t("downloadTitle")}</h2>
            <p>{t("downloadLead")}</p>
            <div className="download__btns">
              <a className="btn btn--primary" href={downloadUrl} target="_blank" rel="noopener">
                <Icon id="i-download" /><span>{t("downloadZip")}</span>
              </a>
              <Suspense fallback={<DllLink />}><DllButton /></Suspense>
            </div>
            <p className="fine">
              Google Drive &middot; Windows &middot; World of Warcraft 3.3.5a (12340)
            </p>
            <Suspense fallback={null}><EarlierDlls /></Suspense>
          </div>
          <ol className="steps">
            <li><h3>{t("extract")}</h3><p>{t.rich("extractBody", { code })}</p></li>
            <li><h3>{t("copy")}</h3><p>{t.rich("copyBody", { code })}</p></li>
            <li><h3>{t("play")}</h3><p>{t.rich("playBody", { kbd })}</p></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Support() {
  const t = useTranslations("landing");
  const ts = useTranslations("support");
  return (
    <section className="section" id="support">
      <div className="wrap">
        <header className="section__head section__head--center">
          <h2>{t("supportTitle")}</h2>
          <p>{t("supportLead")}</p>
        </header>
        <div className="support">
          <SupportLinks />
        </div>
        <WalletSection />
        <div className="backer">
          <p className="backer__head"><strong>seolyam</strong><span>{ts("seolyamRole")}</span></p>
          <div className="backer__ways">
            <SupportLinks set="seolyam" />
            <article className="gcash">
              <div className="gcash__qr">
                <Image src="/assets/img/qr-gcash.svg" alt={ts("gcashQr")} width={320} height={320} unoptimized loading="lazy" />
              </div>
              <p className="gcash__text"><strong>GCash</strong><span>{ts("gcashNote")}</span></p>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
