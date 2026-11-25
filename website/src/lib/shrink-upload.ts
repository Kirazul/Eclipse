const MAX_EDGE = 2560;
const JPEG_QUALITY = 0.92;

/**
 * Makes a large capture small enough to send: a server function accepts 4.5 MB on
 * every Vercel plan, and a 4K PNG is several times that. Only a transport step, so
 * it keeps more than the server needs. compress.ts makes the file that is stored.
 */
export async function shrinkForUpload(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", JPEG_QUALITY));
  return blob ? new File([blob], "capture.jpg", { type: "image/jpeg" }) : file;
}
