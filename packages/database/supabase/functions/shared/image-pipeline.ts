// The one image-processing pipeline for the whole codebase: browser upload
// chokepoints, the process-image edge function, and Node consumers (paperless,
// jobs) all run THIS code, so an image processed anywhere produces identical
// bytes. Codecs are wasm, loaded lazily per format:
//   decode  — libheif (HEIC/HEIF), mozjpeg, squoosh-png, libwebp (jSquash)
//   resize  — squoosh resize (Lanczos)
//   encode  — mozjpeg (photos), squoosh-png (graphics, keeps alpha)
// Bare specifiers resolve via package.json in Node/browser and via the
// functions/deno.json import map in the edge runtime (same pattern as "pg").
// Node callers must run initNodeImageCodecs() from @carbon/utils/image-node
// first — Node's fetch cannot load the wasm from file: URLs.
/// <reference path="./wasm-codecs.d.ts" />
import { round, RoundingMode } from "./precision.ts";

export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ImageShapeOptions = {
  /** Proportional resize to this height (logos). Wins over `contained`. */
  height?: number;
  /** Fit into a 300×300 square with 10% padding (item thumbnails). */
  contained?: boolean;
  /** Format normalization only (HEIC→JPEG etc.), dimensions untouched. */
  convert?: boolean;
  // none of the above → center square crop to 300×300 (avatars)
};

// jSquash types its codec IO as DOM ImageData/ArrayBuffer; at runtime it only
// touches data/width/height, and the spike verified Uint8Array inputs work in
// every runtime — adapt rather than copy buffers.
function asImageData(image: RawImage): ImageData {
  return {
    data: image.data,
    width: image.width,
    height: image.height,
    colorSpace: "srgb"
  } as unknown as ImageData;
}

export class UnsupportedImageFormatError extends Error {
  constructor(extension: string) {
    super(`Cannot decode .${extension} images`);
    this.name = "UnsupportedImageFormatError";
  }
}

export class ImageTooLargeError extends Error {
  constructor(pixels: number, maxPixels: number) {
    super(`Image is ${pixels} pixels; the limit here is ${maxPixels}`);
    this.name = "ImageTooLargeError";
  }
}

const THUMBNAIL_SIZE = 300;
const THUMBNAIL_PADDING = 1.2; // 10% padding each side, as the old resizer did
const JPEG_QUALITY = 85;

/** Source formats that re-encode as JPEG; everything else becomes PNG. */
const JPEG_OUTPUT_EXTENSIONS = ["jpg", "jpeg", "heic", "heif", "avif"];

async function decodeHeic(
  bytes: Uint8Array,
  maxPixels?: number
): Promise<RawImage> {
  const { default: libheif } = await import("libheif-js/wasm-bundle.js");
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  const image = images[0];
  if (!image) throw new Error("HEIC file contains no images");
  const width = image.get_width();
  const height = image.get_height();
  // Guard BEFORE allocating + display() — those materialize the full RGBA
  // frame, which is exactly the memory blow-up the limit exists to prevent.
  // The handle's dimensions are readable without decoding pixel data.
  if (maxPixels) assertPixelLimit({ width, height }, maxPixels);
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise((resolve, reject) => {
    image.display({ data, width, height }, (ok: unknown) =>
      ok ? resolve(ok) : reject(new Error("Failed to decode HEIC image"))
    );
  });
  return { data, width, height };
}

/**
 * Read dimensions from the container header WITHOUT decoding pixel data, so
 * the pixel limit can run before the full RGBA allocation (a compact file can
 * declare enormous dimensions). Returns null when the header is unrecognized —
 * the decoder will reject malformed input itself; every VALID jpeg/png/webp
 * has a parseable header, so fail-open here cannot bypass the guard.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  extension: string
): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  const u32be = (i: number) =>
    ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
  switch (extension.toLowerCase()) {
    case "png": {
      // signature (8) + IHDR length/type (8), then width/height as u32be
      if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
      return { width: u32be(16), height: u32be(20) };
    }
    case "jpg":
    case "jpeg": {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1]!;
        // SOF0–SOF15 carry the frame dimensions (C4/C8/CC are not SOFs)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: u16be(i + 7), height: u16be(i + 5) };
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) i += 2;
        else i += 2 + u16be(i + 2);
      }
      return null;
    }
    case "webp": {
      if (bytes.length < 30) return null;
      const fourCC = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
      if (fourCC === "VP8 ") {
        // lossy: 3-byte frame tag + 9D 01 2A, then 14-bit width/height (LE)
        return {
          width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
          height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff
        };
      }
      if (fourCC === "VP8L") {
        // lossless: 0x2F then width-1 (14 bits) and height-1 (14 bits), bitpacked LE
        if (bytes[20] !== 0x2f) return null;
        const b = (i: number) => bytes[21 + i]!;
        const width = 1 + (((b(1) & 0x3f) << 8) | b(0));
        const height = 1 + (((b(3) & 0x0f) << 10) | (b(2) << 2) | (b(1) >> 6));
        return { width, height };
      }
      if (fourCC === "VP8X") {
        // extended: canvas width-1 / height-1 as 24-bit LE
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width, height };
      }
      return null;
    }
    default:
      return null;
  }
}

export async function decodeImage(
  bytes: Uint8Array,
  extension: string,
  maxPixels?: number
): Promise<RawImage> {
  // HEIC guards inside decodeHeic (dims come from the decoder handle); the
  // container formats guard here, before the decoder allocates the frame.
  if (maxPixels) {
    const dims = readImageDimensions(bytes, extension);
    if (dims) assertPixelLimit(dims, maxPixels);
  }
  switch (extension.toLowerCase()) {
    case "heic":
    case "heif":
      return decodeHeic(bytes, maxPixels);
    case "jpg":
    case "jpeg": {
      const { default: decode } = await import("@jsquash/jpeg/decode.js");
      return (await decode(bytes as unknown as ArrayBuffer)) as RawImage;
    }
    case "png": {
      const { default: decode } = await import("@jsquash/png/decode.js");
      return (await decode(bytes as unknown as ArrayBuffer)) as RawImage;
    }
    case "webp": {
      const { default: decode } = await import("@jsquash/webp/decode.js");
      return (await decode(bytes as unknown as ArrayBuffer)) as RawImage;
    }
    default:
      throw new UnsupportedImageFormatError(extension);
  }
}

export async function resizeImage(
  image: RawImage,
  width: number,
  height: number
): Promise<RawImage> {
  const { default: resize } = await import("@jsquash/resize");
  const out = await resize(asImageData(image), {
    width,
    height,
    fitMethod: "stretch"
  });
  return { data: out.data, width: out.width, height: out.height };
}

function cropImage(
  image: RawImage,
  x: number,
  y: number,
  width: number,
  height: number
): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    data.set(
      image.data.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4
    );
  }
  return { data, width, height };
}

/** Composite `image` centered onto a square canvas (transparent background). */
function padToSquare(image: RawImage, size: number): RawImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const offsetX = round((size - image.width) / 2, 0);
  const offsetY = round((size - image.height) / 2, 0);
  for (let row = 0; row < image.height; row++) {
    data.set(
      image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4),
      ((offsetY + row) * size + offsetX) * 4
    );
  }
  return { data, width: size, height: size };
}

/** JPEG has no alpha channel — composite transparency onto white first. */
export function flattenOntoWhite(image: RawImage): RawImage {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 255) / 255;
    if (alpha === 1) continue;
    const white = 255 * (1 - alpha);
    data[i] = (data[i] ?? 0) * alpha + white;
    data[i + 1] = (data[i + 1] ?? 0) * alpha + white;
    data[i + 2] = (data[i + 2] ?? 0) * alpha + white;
    data[i + 3] = 255;
  }
  return image;
}

export async function shapeImage(
  image: RawImage,
  options: ImageShapeOptions
): Promise<RawImage> {
  if (options.height) {
    const width = round(
      options.height * (image.width / image.height),
      0,
      RoundingMode.HalfUp
    );
    return resizeImage(image, Math.max(1, width), options.height);
  }
  if (options.contained) {
    const inner = THUMBNAIL_SIZE / THUMBNAIL_PADDING;
    const scale = inner / Math.max(image.width, image.height);
    const fitted = await resizeImage(
      image,
      Math.max(1, round(image.width * scale, 0)),
      Math.max(1, round(image.height * scale, 0))
    );
    return padToSquare(fitted, THUMBNAIL_SIZE);
  }
  if (options.convert) {
    return image;
  }
  // Default: center square crop (avatars).
  const size = Math.min(image.width, image.height);
  const cropped = cropImage(
    image,
    round((image.width - size) / 2, 0),
    round((image.height - size) / 2, 0),
    size,
    size
  );
  return resizeImage(cropped, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
}

export async function encodeImage(
  image: RawImage,
  format: "jpeg" | "png"
): Promise<Uint8Array> {
  if (format === "jpeg") {
    const { default: encode } = await import("@jsquash/jpeg/encode.js");
    const out = await encode(asImageData(flattenOntoWhite(image)), {
      quality: JPEG_QUALITY
    });
    return new Uint8Array(out);
  }
  const { default: encode } = await import("@jsquash/png/encode.js");
  const out = await encode(asImageData(image));
  return new Uint8Array(out);
}

export type ProcessedImage = {
  data: Uint8Array;
  contentType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
};

export function outputFormatFor(extension: string): "jpeg" | "png" {
  return JPEG_OUTPUT_EXTENSIONS.includes(extension.toLowerCase())
    ? "jpeg"
    : "png";
}

export function assertPixelLimit(
  image: { width: number; height: number },
  maxPixels: number
): void {
  const pixels = image.width * image.height;
  if (pixels > maxPixels) throw new ImageTooLargeError(pixels, maxPixels);
}

/**
 * The full pipeline: decode → shape → encode. Throws
 * UnsupportedImageFormatError for formats it cannot decode (callers fall back
 * to imgproxy or the browser's native decoder) and ImageTooLargeError when
 * `maxPixels` is given and exceeded (memory guard for constrained runtimes).
 */
export async function processImage(
  bytes: Uint8Array,
  extension: string,
  options: ImageShapeOptions & { maxPixels?: number } = {}
): Promise<ProcessedImage> {
  const { maxPixels, ...shape } = options;
  // HEIC is guarded pre-decode inside decodeHeic; the post-decode assert
  // still covers the remaining formats (their decoders are single-shot).
  const image = await decodeImage(bytes, extension, maxPixels);
  if (maxPixels) assertPixelLimit(image, maxPixels);
  const shaped = await shapeImage(image, shape);
  const format = outputFormatFor(extension);
  const data = await encodeImage(shaped, format);
  return {
    data,
    contentType: format === "jpeg" ? "image/jpeg" : "image/png",
    extension: format === "jpeg" ? "jpg" : "png"
  };
}

/** Shape a pre-decoded RGBA image (browser canvas-decode fallback path). */
export async function processRawImage(
  image: RawImage,
  extension: string,
  options: ImageShapeOptions = {}
): Promise<ProcessedImage> {
  const shaped = await shapeImage(image, options);
  const format = outputFormatFor(extension);
  const data = await encodeImage(shaped, format);
  return {
    data,
    contentType: format === "jpeg" ? "image/jpeg" : "image/png",
    extension: format === "jpeg" ? "jpg" : "png"
  };
}
