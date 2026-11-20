import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { CommandMenu } from "@/components/command-menu";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Sprite } from "@/components/site/icons";
import { SupportDialog } from "@/components/site/support-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { OPEN_GRAPH, siteUrl } from "@/lib/site";
import { supabaseConfigured } from "@/lib/supabase/config";
import "./globals.css";

const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
// Inter's Cyrillic letters, for Russian. It comes first in --sans, but its
// unicode-range limits it to Cyrillic, so an English page never downloads it. No
// fallback face: Inter's own, next in the stack, already has one.
const interCyrillic = localFont({
  src: "./fonts/inter-cyrillic.woff2",
  weight: "100 900",
  variable: "--font-inter-cyrillic",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" }],
});
const newsreader = localFont({
  src: "./fonts/newsreader-display.woff2",
  weight: "300 600",
  variable: "--font-newsreader",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site");
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("title"), template: "%s · Eclipse" },
    description: t("description"),
    icons: { icon: "/assets/img/icon-32.png", apple: "/assets/img/icon-180.png" },
    openGraph: { ...OPEN_GRAPH, title: t("title"), description: t("ogDescription") },
    twitter: { card: "summary_large_image", images: ["/assets/img/og-image.jpg"] },
  };
}

export const viewport: Viewport = {
  themeColor: "#141413",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations("layout");
  return (
    // The font variables go on <html>, because that is where --sans reads them.
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className={`dark ${inter.variable} ${interCyrillic.variable} ${newsreader.variable}`}
    >
      <body className="antialiased">
        <Sprite />
        <a className="skip" href="#main">{t("skip")}</a>
        <NextIntlClientProvider>
        <NuqsAdapter>
          <TooltipProvider>
            <SiteHeader signIn={supabaseConfigured()} />
            {children}
            <SiteFooter />
            <CommandMenu />
            <SupportDialog />
            <Toaster
              position="bottom-center"
              theme="dark"
              toastOptions={{
                classNames: { description: "!text-[#55524c]" },
                style: {
                  background: "var(--ink)",
                  border: "0",
                  color: "var(--void)",
                  borderRadius: 999,
                  fontFamily: "var(--sans)",
                },
              }}
            />
          </TooltipProvider>
        </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
