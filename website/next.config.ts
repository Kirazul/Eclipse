import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The visitor's language and its messages: src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR=.next-build pnpm build verifies a build without touching the
  // .next that a running `next dev` is using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // The 3D engine and its pack format are workspace packages shipped as TypeScript source.
  transpilePackages: ["@eclipse/engine", "@eclipse/format"],
  // Keeps the title and description in <head> for everyone. Otherwise a page with a
  // Suspense boundary flushes first and sends them in the body, Googlebot included.
  htmlLimitedBots: /.*/,
  experimental: {
    // Room for one screenshot (MAX_SCREENSHOT_BYTES) and the form around it.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // Art under public/ is asked for again on every visit unless told otherwise, and a
      // Gallery page shows over a hundred pieces of it. Game art keeps its name for good;
      // the site's own pictures may be replaced under theirs, so they are checked daily.
      ...["/icons/:path*", "/wow/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      })),
      {
        source: "/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=2592000" }],
      },
    ];
  },
  async redirects() {
    return [
      // The Wardrobe became the Community Gallery on 2026-11-14. Links to looks are
      // already in Discord and in players' bookmarks, so the old paths stay.
      { source: "/wardrobe", destination: "/community-gallery", permanent: true },
      // The old Eclipse site's DLL link now lands here. Not permanent: it follows the
      // newest release (dllUrl in src/lib/site.ts).
      { source: "/dinput8.dll", destination: "https://github.com/Kirazul/Eclipse/releases/latest/download/dinput8.dll", permanent: false },
      { source: "/wardrobe/:id", destination: "/community-gallery/:id", permanent: true },
      { source: "/armory", destination: "/community-gallery", permanent: true },
      { source: "/armory/:id", destination: "/community-gallery/:id", permanent: true },
      { source: "/decode", destination: "/loadouts", permanent: true },
      { source: "/world", destination: "/community-gallery", permanent: true },
      // Import and the game's saved sets share the Loadouts page now. The query
      // (?code=, ?from=) carries over, and the overlay still links to /sets.
      { source: "/inspector", destination: "/loadouts", permanent: true },
      { source: "/sets", destination: "/loadouts", permanent: true },
      // The Showcase is the Community Gallery filtered to looks with a studio picture.
      { source: "/showcase", destination: "/community-gallery?pictures=true", permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
