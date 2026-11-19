import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { preload } from "react-dom";
import { HeroStage } from "@/components/site/hero-stage";
import { Icon } from "@/components/site/icons";
import { SupportLinks } from "@/components/site/support-links";
import { WalletSection } from "@/components/site/wallets";
import { discordMembers } from "@/lib/discord-invite";
import { FEATURES } from "@/lib/features";
import { TALL_MEDIA, TALL_SIZES, WIDE_SIZES, tallArt, wideArt } from "@/lib/hero-art";
import { latestRelease } from "@/lib/releases";
import { DISCORD_URL, dllUrl, downloadUrl } from "@/lib/site";

// The official page's sections, word for word: only the links are new. The hero is
// the exception: Kira took the showcase video out on 2026-11-14 and asked for the
// text in the middle of the screen.

/** Discord's own member count for the invite, or nothing when Discord does not say. */
async function DiscordMembers() {
  const count = await discordMembers();
  return count ? <span className="btn__count">{count.toLocaleString("en-US")} members</span> : null;
}

/** The DLL on its own, offered only once Kirazul/Eclipse has a release to land on. */
async function DllButton() {
  if (!(await latestRelease())) return null;
  return (
    <a className="btn btn--ghost" href={dllUrl} target="_blank" rel="noopener">
      <Icon id="i-download" /><span>dinput8.dll</span>
    </a>
  );
}

export function Hero() {
  // Same srcset and sizes as the <picture>, so each is one download. preload()
  // reaches <head>; a <link> with no href would stay here in the body.
  const art = { as: "image", type: "image/avif", fetchPriority: "high" } as const;
  preload("/assets/img/bg-wide-1920.avif", { ...art, media: "(min-aspect-ratio: 4/5)", imageSrcSet: wideArt("avif"), imageSizes: WIDE_SIZES });
  preload("/assets/img/bg-tall-960.avif", { ...art, media: TALL_MEDIA, imageSrcSet: tallArt("avif"), imageSizes: TALL_SIZES });

  return (
    <section className="hero" id="top">
      <HeroStage />
      <div className="wrap hero__text">
        <h1>
          A wardrobe for <span className="flow-text">World of Warcraft</span>
        </h1>
        <p>
          Every appearance, mount, spell and title in the game, on your own character. Share a look as a code, or
          find one in the <Link href="/community-gallery">Community Gallery</Link>.
        </p>
        <div className="cta">
          <a className="btn btn--primary" href="#download"><Icon id="i-download" /><span>Download Eclipse</span></a>
          <Link className="btn btn--ghost" href="/community-gallery">Browse the Community Gallery</Link>
        </div>
        <a className="hero__community" href={DISCORD_URL} target="_blank" rel="noopener">
          <Icon id="i-discord" /><span>Join the Discord</span>
          <Suspense fallback={null}><DiscordMembers /></Suspense>
        </a>
      </div>
      <div className="wrap hero__foot">
        <a className="hero__more" href="#features" aria-label="See everything it does">
          <ChevronDown aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

export function Features({ live }: { live: boolean }) {
  return (
    <section className="section" id="features">
      <div className="wrap">
        <header className="section__head">
          <h2>Everything in one overlay</h2>
          <p>Press <kbd>F2</kbd> in game to open it. The key can be changed in Settings.</p>
        </header>
        <div className="features">
          {FEATURES.map((f) => (
            <article key={f.title}>
              <h3>{f.href && (live || !f.needsPosts) ? <Link href={f.href}>{f.title}</Link> : f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Download() {
  return (
    <section className="section" id="download">
      <div className="wrap">
        <div className="panel download">
          <div className="download__intro">
            <h2>Download Eclipse</h2>
            <p>Includes the retail asset pack: items, mounts, fonts, effects and spells.</p>
            <div className="download__btns">
              <a className="btn btn--primary" href={downloadUrl} target="_blank" rel="noopener">
                <Icon id="i-download" /><span>Download Eclipse.zip</span>
              </a>
              <Suspense fallback={null}><DllButton /></Suspense>
            </div>
            <p className="fine">
              Google Drive &middot; Windows &middot; World of Warcraft 3.3.5a (12340)
            </p>
          </div>
          <ol className="steps">
            <li><h3>Extract</h3><p>Unzip <code>Eclipse.zip</code> anywhere.</p></li>
            <li><h3>Copy</h3><p>Place <code>dinput8.dll</code> and the <code>Eclipse</code> folder next to <code>Wow.exe</code>.</p></li>
            <li><h3>Play</h3><p>Start the game, enter the world and press <kbd>F2</kbd>.</p></li>
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Support() {
  return (
    <section className="section" id="support">
      <div className="wrap">
        <header className="section__head section__head--center">
          <h2>Eclipse is free</h2>
          <p>There is no price and there never will be. If it has earned a place in your game, you can help keep it going.</p>
        </header>
        <div className="support">
          <SupportLinks />
        </div>
        <WalletSection />
      </div>
    </section>
  );
}
