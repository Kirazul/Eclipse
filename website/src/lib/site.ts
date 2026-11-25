import type { Metadata } from "next";

// This site is Eclipse's only home. NEXT_PUBLIC_SITE_URL names its address, for
// canonical links, the sitemap and social cards; Vercel supplies one if it is unset.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || (vercelHost ? `https://${vercelHost}` : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE_TITLE = "Eclipse - A free wardrobe for World of Warcraft 3.3.5a";
export const SITE_DESCRIPTION =
  "Eclipse is a free overlay for the World of Warcraft 3.3.5a client. Every appearance, mount, spell and title in the game, on your own character.";

export const OPEN_GRAPH: NonNullable<Metadata["openGraph"]> = {
  type: "website",
  siteName: "Eclipse",
  title: SITE_TITLE,
  description: "Every appearance, mount, spell and title in the game, on your own character. Free, for the 3.3.5a client.",
  images: [{ url: "/assets/img/og-image.jpg", width: 1200, height: 630 }],
};

export const GITHUB_URL = "https://github.com/Kirazul/Eclipse";

// Eclipse.zip lives on Google Drive and is overridable. dinput8.dll is published on
// the GitHub releases, and this always lands on the newest one (see the README).
export const downloadUrl =
  process.env.NEXT_PUBLIC_DOWNLOAD_URL || "https://drive.google.com/file/d/1UuOb9tl43sohg41_gV2z82WAgIKBLhXF/view?usp=sharing";
// The Download panel shows it only while a release exists (src/lib/releases.ts).
export const dllUrl = `${GITHUB_URL}/releases/latest`;

export const DISCORD_URL = "https://discord.gg/RvY5VjHgTA";
export const KOFI_URL = "https://ko-fi.com/eclipsewow";
export const NARCISSUS_URL = "https://www.curseforge.com/wow/addons/narcissus";
