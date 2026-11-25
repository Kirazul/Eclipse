import { smallOf, thumbOf } from "@/lib/screenshots";

// Planning for tools/backfill-small-thumbs.mts, which gives the pictures stored before the
// small copy existed one of their own. Kept here so the choice of files is tested.

/** A file as a storage folder lists it. */
export interface StoredFile {
  name: string;
  size: number;
}

/** One small copy to make: from which stored file, to where, and how much it reads. */
export interface SmallCopy {
  source: string;
  target: string;
  bytes: number;
}

// A picture's own file, not one of its copies.
const PICTURE = /^[0-9a-f-]{36}\.(?:avif|webp)$/;

/**
 * The small copies a folder's pictures still need. Each is made from the picture's thumbnail,
 * half the download of the full file, or from the full file when the thumbnail is missing.
 */
export function smallCopiesToMake(folder: string, files: StoredFile[]): SmallCopy[] {
  const sizes = new Map(files.map((f) => [f.name, f.size]));
  return files
    .filter((f) => PICTURE.test(f.name) && !sizes.has(smallOf(f.name)))
    .map((f) => {
      const source = sizes.has(thumbOf(f.name)) ? thumbOf(f.name) : f.name;
      return { source: `${folder}/${source}`, target: `${folder}/${smallOf(f.name)}`, bytes: sizes.get(source) ?? 0 };
    });
}
