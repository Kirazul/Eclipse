import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// On glibc Linux without jemalloc, sharp runs libvips on one thread (sharp.concurrency()
// is 1), and one 1920x1080 noise capture takes about 7 s to encode as AVIF there.
vi.setConfig({ testTimeout: 30_000 });

const { compressScreenshot, smallCopy, socialCard } = await import("./compress");

const capture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#403020", noise: { type: "gaussian", mean: 120, sigma: 24 } } });

const compress = async (input: Buffer) => {
  const result = await compressScreenshot(input);
  if (!result) throw new Error("expected a compressed screenshot");
  return result;
};

describe("a stored screenshot", () => {
  it("is AVIF, far smaller than the capture it came from", async () => {
    const input = await capture(1920, 1080).png().toBuffer();
    const { full, thumb, small } = await compress(input);
    expect((await sharp(full).metadata()).format).toBe("heif");
    expect((await sharp(thumb).metadata()).format).toBe("heif");
    expect((await sharp(small).metadata()).format).toBe("heif");
    expect(full.length).toBeLessThan(input.length / 2);
    expect(thumb.length).toBeLessThan(full.length);
    expect(small.length).toBeLessThan(thumb.length);
  });

  it("is sized to what the site can show", async () => {
    const { full, thumb, small } = await compress(await capture(3840, 2160).png().toBuffer());
    expect(await sharp(full).metadata()).toMatchObject({ width: 1600, height: 900 });
    expect(await sharp(thumb).metadata()).toMatchObject({ width: 960, height: 540 });
    expect(await sharp(small).metadata()).toMatchObject({ width: 480, height: 270 });
  });

  it("limits a tall capture by its long edge", async () => {
    const { full } = await compress(await capture(1000, 3000).png().toBuffer());
    expect((await sharp(full).metadata()).height).toBe(1600);
  });

  it("is never enlarged", async () => {
    const { full, thumb, small } = await compress(await capture(320, 180).png().toBuffer());
    expect((await sharp(full).metadata()).width).toBe(320);
    expect((await sharp(thumb).metadata()).width).toBe(320);
    expect((await sharp(small).metadata()).width).toBe(320);
  });

  // A phone's photo can carry the GPS position it was taken at.
  it("drops what the file says about where and how it was taken", async () => {
    const input = await capture(400, 200).jpeg().withExif({ IFD0: { Copyright: "private", Software: "a camera" } }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { full, thumb, small } = await compress(input);
    expect((await sharp(full).metadata()).exif).toBeUndefined();
    expect((await sharp(thumb).metadata()).exif).toBeUndefined();
    expect((await sharp(small).metadata()).exif).toBeUndefined();
  });

  it("is turned the right way up before that note is dropped", async () => {
    const input = await capture(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { full } = await compress(input);
    expect(await sharp(full).metadata()).toMatchObject({ width: 200, height: 400 });
  });

  it("refuses bytes that are not an image", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await compressScreenshot(Buffer.from("not an image"))).toBeNull();
  });
});

describe("the small copy of a picture stored before it existed", () => {
  it("is made from the stored thumbnail, at the small copy's size", async () => {
    const { thumb } = await compress(await capture(1920, 1080).png().toBuffer());
    const small = await smallCopy(thumb);
    expect(small).not.toBeNull();
    expect(await sharp(small!).metadata()).toMatchObject({ format: "heif", width: 480, height: 270 });
  });

  it("is nothing for bytes that are not an image", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await smallCopy(Buffer.from("not an image"))).toBeNull();
  });
});

describe("a link preview", () => {
  // Discord and others do not all read AVIF, which is what the site stores.
  it("is a JPEG at the size link previews use, cropped from a stored screenshot", async () => {
    const { full } = await compress(await capture(1920, 1080).png().toBuffer());
    const card = await socialCard(full);
    expect(card).not.toBeNull();
    expect(await sharp(card!).metadata()).toMatchObject({ format: "jpeg", width: 1200, height: 630 });
  });

  it("is nothing for bytes that are not an image", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await socialCard(Buffer.from("not an image"))).toBeNull();
  });
});
