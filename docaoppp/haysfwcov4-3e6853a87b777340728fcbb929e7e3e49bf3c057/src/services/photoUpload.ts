/**
 * Preparing a picked photo for the Apps Script upload endpoint.
 *
 * A phone hands the form whatever the operating system chooses: usually JPEG,
 * but also HEIC/HEIF (iPhone photo libraries), a file with no MIME type at all,
 * or a full-resolution photo well over 15 MB (newer Android cameras). The
 * upload endpoint accepts only JPEG/PNG/WebP bodies under 15 MB (21 MB of
 * base64) and verifies their file signatures, so anything else is rejected —
 * which surfaced to project managers as "the photo upload failed".
 *
 * This module normalizes one picked photo into a body the endpoint accepts:
 *
 *   - JPEG/PNG/WebP under the conservative pass-through cap are returned
 *     byte-for-byte: no recompression, no quality loss, no encode wait;
 *   - anything else — HEIC/HEIF, a missing type, an oversized photo — is
 *     decoded (EXIF rotation applied) and re-encoded as a bounded JPEG well
 *     inside the endpoint's limits.
 *
 * The 2560-pixel bound keeps field uploads fast while staying far above what
 * an estimator needs to see damage in a photo.
 */

export interface PreparedPhotoUpload {
  blob: Blob;
  name: string;
  mimeType: string;
  size: number;
}

/** Mirrors the photo cap in apps-script/Code.gs (`info.size` check). */
export const PHOTO_UPLOAD_LIMIT = 15 * 1024 * 1024;
/** Pass-through stays a comfortable margin below the cap. */
const PASSTHROUGH_LIMIT = 10 * 1024 * 1024;
/** Longest edge of a re-encoded photo, in natural pixels. */
const MAX_EDGE = 2560;
/** The endpoint's allow-list for photos (apps-script/Code.gs). */
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|heif|avif|bmp|gif|tiff?)$/i;

/**
 * True when a picked file is meant to be a photo. Some operating systems hand
 * HEIC (and other) photos over with an empty MIME type, so the extension is the
 * only signal left. Anything that slips through is decoded during upload and
 * fails there with a specific message instead.
 */
export function looksLikePhotoFile(file: File): boolean {
  if (String(file.type || "").startsWith("image/")) return true;
  return IMAGE_EXTENSION.test(String(file.name || ""));
}

interface DecodedPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Present only when createImageBitmap produced the source; must be closed. */
  bitmap: ImageBitmap | null;
  /** Object URL of the <img> fallback; revoked once the photo has been drawn. */
  url: string | null;
}

/** Widens the option by hand: `imageOrientation` is missing from lib.dom. */
interface ImageBitmapOrientationOptions {
  imageOrientation?: string;
}

/**
 * Decodes with the browser's own EXIF handling. createImageBitmap with
 * imageOrientation "from-image" bakes the rotation in; older engines reject
 * that option, and Safari decodes HEIC in an <img> but not always through
 * createImageBitmap, so the element path is a real fallback, not dead code.
 */
async function decodePhoto(blob: Blob): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === "function") {
    try {
      const options: ImageBitmapOrientationOptions = {
        imageOrientation: "from-image",
      };
      const bitmap = await createImageBitmap(
        blob,
        options as ImageBitmapOptions,
      );
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
        url: null,
      };
    } catch {
      // Fall through to the <img> path below.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("decode failed"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      bitmap: null,
      url,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function encodeBoundedJpeg(decoded: DecodedPhoto): Promise<Blob> {
  const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(decoded.width * scale));
  canvas.height = Math.max(1, Math.round(decoded.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The photo could not be prepared for upload.");
  // JPEG has no alpha: flatten onto white so a transparent PNG source cannot
  // encode as a black photo.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!jpeg || jpeg.size <= 0) {
    throw new Error("The photo could not be prepared for upload.");
  }
  return jpeg;
}

/** The endpoint stores the name it is given; a converted photo reads as .jpg. */
function jpegName(name: string): string {
  const trimmed = String(name || "").trim() || "photo";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem || "photo"}.jpg`;
}

/**
 * Normalizes one picked photo for upload. Returns the same blob (and name)
 * untouched when it is already a supported type under the pass-through cap, so
 * the common JPEG path never pays for a decode/encode cycle.
 */
export async function preparePhotoForUpload(
  blob: Blob,
  name: string,
): Promise<PreparedPhotoUpload> {
  const type = String(blob.type || "").toLowerCase();
  if (
    SUPPORTED_TYPES.indexOf(type) >= 0 &&
    blob.size > 0 &&
    blob.size <= PASSTHROUGH_LIMIT
  ) {
    return { blob, name, mimeType: type, size: blob.size };
  }
  let decoded: DecodedPhoto;
  try {
    decoded = await decodePhoto(blob);
  } catch {
    throw new Error(
      `The photo "${name || "photo"}" could not be opened. Try taking it again, or pick a JPEG or PNG.`,
    );
  }
  try {
    const jpeg = await encodeBoundedJpeg(decoded);
    if (jpeg.size > PHOTO_UPLOAD_LIMIT) {
      throw new Error(
        `The photo "${name || "photo"}" is still too large to upload after resizing. Try a smaller photo.`,
      );
    }
    return {
      blob: jpeg,
      name: jpegName(name),
      mimeType: "image/jpeg",
      size: jpeg.size,
    };
  } finally {
    decoded.bitmap?.close();
    if (decoded.url) URL.revokeObjectURL(decoded.url);
  }
}
