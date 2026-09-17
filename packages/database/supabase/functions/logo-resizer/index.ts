import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import {
  decodeImage,
  encodeImage,
  flattenOntoWhite,
  resizeImage
} from "../shared/image-pipeline.ts";
import type { RawImage } from "../shared/image-pipeline.ts";
import { round } from "../shared/precision.ts";

const HEX = "0123456789ABCDEF";

/**
 * Pack a monochrome RGBA buffer into a ZPL `^GFA` graphic field: rows of 1-bpp
 * pixels (MSB-first, `1` = black), padded to a byte boundary per row, hex-coded.
 */
function rgbaToGFA(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  thresh = 128
): string {
  const rowBytes = round(w / 8, 0, "up");
  const total = rowBytes * h;
  const bytes = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3];
      const lum =
        a === 0
          ? 255
          : rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
      if (lum < thresh) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  let hex = "";
  for (let k = 0; k < total; k++) {
    hex += HEX[bytes[k] >> 4] + HEX[bytes[k] & 15];
  }
  return `^GFA,${total},${total},${rowBytes},${hex}`;
}

/** In place: every pixel becomes pure black or pure white at `cutoff`. */
function thresholdToMono(image: RawImage, cutoff: number): RawImage {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const value = lum < cutoff ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return image;
}

function cropNormalized(
  image: RawImage,
  x: number,
  y: number,
  w: number,
  h: number
): RawImage {
  const px = Math.max(1, round(w * image.width, 0));
  const py = Math.max(1, round(h * image.height, 0));
  const ox = Math.min(image.width - 1, Math.max(0, round(x * image.width, 0)));
  const oy = Math.min(
    image.height - 1,
    Math.max(0, round(y * image.height, 0))
  );
  const width = Math.min(px, image.width - ox);
  const height = Math.min(py, image.height - oy);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((oy + row) * image.width + ox) * 4;
    data.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return { data, width, height };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const widthDots = Math.max(
      16,
      Math.min(
        1200,
        parseInt((formData.get("widthDots") as string) || "240", 10)
      )
    );
    const threshold = parseInt(
      (formData.get("threshold") as string) || "50",
      10
    );
    // Optional crop, normalized 0..1 relative to the source image.
    const num = (k: string) => {
      const v = formData.get(k);
      return v === null ? null : parseFloat(v as string);
    };
    const cropX = num("cropX");
    const cropY = num("cropY");
    const cropW = num("cropW");
    const cropH = num("cropH");
    const hasCrop =
      cropX !== null && cropY !== null && cropW !== null && cropH !== null;

    if (!file) throw new Error("No file provided");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";

    let image = await decodeImage(bytes, extension);
    if (hasCrop) {
      image = cropNormalized(
        image,
        cropX as number,
        cropY as number,
        cropW as number,
        cropH as number
      );
    }
    // Flatten transparency onto white so it doesn't threshold to black, then
    // scale to the requested dot width and snap to clean 1-bit black & white.
    flattenOntoWhite(image);
    const outH = Math.max(1, round(widthDots * (image.height / image.width), 0));
    const resized = await resizeImage(image, widthDots, outH);
    const cutoff = round((threshold * 255) / 100, 0);
    thresholdToMono(resized, cutoff);

    // PDF B&W logo.
    const png = await encodeImage(resized, "png");
    const monoPng = `data:image/png;base64,${toBase64(png)}`;

    // ZPL graphic.
    const gfa = rgbaToGFA(resized.data, resized.width, resized.height);

    return jsonResponse({
      monoPng,
      gfa,
      widthDots: resized.width,
      heightDots: resized.height
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
});
