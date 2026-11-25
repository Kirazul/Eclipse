import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eclipse",
    short_name: "Eclipse",
    description: "A free, client-side wardrobe for World of Warcraft 3.3.5a.",
    start_url: "/",
    display: "standalone",
    background_color: "#141413",
    theme_color: "#141413",
    icons: [
      { src: "/assets/img/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/assets/img/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
