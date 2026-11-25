// The hero art's sizes, shared by the <picture> and its preloads: when the two
// agree, the browser treats them as one download.

const WIDE = "bg-wide-960 960w, bg-wide-1440 1440w, bg-wide-1920 1920w, bg-wide-2560 2560w, bg-wide-3200 3200w, bg-wide-3840 3840w";
const TALL = "bg-tall-640 640w, bg-tall-960 960w, bg-tall-1339 1339w";

const set = (list: string, ext: string) =>
  list.split(", ").map((entry) => `/assets/img/${entry.replace(" ", `.${ext} `)}`).join(", ");

export const wideArt = (ext: "avif" | "webp") => set(WIDE, ext);
export const tallArt = (ext: "avif" | "webp") => set(TALL, ext);

// The art covers the first screen, so its width is max(100vw, 100vh x aspect),
// times the 1.06 it is drawn at so its slow sway has room to move.
export const WIDE_SIZES = "max(106vw, 188.44vh)";
export const TALL_SIZES = "max(106vw, 65.71vh)";
export const TALL_MEDIA = "(max-aspect-ratio: 4/5)";
