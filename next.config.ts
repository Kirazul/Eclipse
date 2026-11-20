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
    ];
  },
  async redirects() {
    return [
      // The Wardrobe became the Community Gallery on 2026-11-14. Links to looks are
      // already in Discord and in players' bookmarks, so the old paths stay.
      { source: "/wardrobe", destination: "/community-gallery", permanent: true },
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
