import { supabaseUrl } from "@/lib/supabase/config";

// A post's gallery holds storage paths, never links: <owner>/<uuid>.avif.

export const SCREENSHOT_BUCKET = "showcase";

export const UPLOAD_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:avif|webp)$/;

/** The small copy stored beside a screenshot, from its path or its link. */
export const thumbOf = (pathOrUrl: string) => pathOrUrl.replace(/\.(avif|webp)$/, "-thumb.$1");

/** The smallest copy, for phones and little thumbnails. Pictures stored before it existed may lack it. */
export const smallOf = (pathOrUrl: string) => pathOrUrl.replace(/\.(avif|webp)$/, "-small.$1");

/** Every file stored for a screenshot: removing it removes them all. */
export const screenshotFiles = (path: string) => [path, thumbOf(path), smallOf(path)];

export const screenshotUrl = (path: string) =>
  `${supabaseUrl}/storage/v1/object/public/${SCREENSHOT_BUCKET}/${path}`;
