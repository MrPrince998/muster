/** A file on the API (an event's cover image, "/files/covers/..."), as a link the browser can load. */
export const apiUrl = (path: string) => `${process.env.NEXT_PUBLIC_API_URL}${path}`;

/**
 * A photo made ready to upload: at most `max` pixels on its longer side, as
 * WebP (or JPEG, where the browser can't write WebP). Phones take 4000px,
 * 5 MB pictures; this sends a few hundred KB, and the server never has to
 * decode anything.
 */
export async function resizeImage(file: File, max = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // Safari writes PNG when asked for WebP: check what came back
  const webp = await encode("image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("This browser couldn't prepare the image");
  return jpeg;
}
