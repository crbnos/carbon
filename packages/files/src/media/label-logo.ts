// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import {
  decodeImage,
  encodeImage,
  flattenOntoWhite,
  type RawImage,
  resizeImage
} from "./image";
import { initNodeImageCodecs } from "./node";

export type LabelLogoCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LabelLogo = {
  /** Monochrome PNG data URL, for the PDF's B&W logo. */
  monoPng: string;
  /** ZPL `^GFA` graphic field. */
  gfa: string;
  widthDots: number;
  heightDots: number;
};

/**
 * A company logo as a 1-bit label graphic, `widthDots` wide (clamped to
 * 16–1200). `crop` is normalized 0..1 against the source image; ZPL and the
 * mono PNG can't clip at render time, so it is applied before the threshold.
 * Transparency is flattened onto white so it doesn't print black.
 */
export async function renderLabelLogo(
  bytes: Uint8Array,
  extension: string,
  options: { widthDots: number; threshold?: number; crop?: LabelLogoCrop }
): Promise<LabelLogo> {
  await initNodeImageCodecs();
  const widthDots = Math.max(16, Math.min(1200, options.widthDots));
  const cutoff = round(((options.threshold ?? 50) * 255) / 100, 0);

  let image = await decodeImage(bytes, extension);
  if (options.crop) image = cropNormalized(image, options.crop);
  flattenOntoWhite(image);
  const height = Math.max(
    1,
    round(widthDots * (image.height / image.width), 0)
  );
  const mono = thresholdToMono(
    await resizeImage(image, widthDots, height),
    cutoff
  );

  const png = await encodeImage(mono, "png");
  return {
    monoPng: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
    gfa: toGraphicField(mono),
    widthDots: mono.width,
    heightDots: mono.height
  };
}

/** Rec. 601 luma of the pixel at byte offset `i`. */
function luma(data: Uint8ClampedArray, i: number): number {
  return data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
}

/** In place: every pixel becomes opaque pure black or pure white at `cutoff`. */
function thresholdToMono(image: RawImage, cutoff: number): RawImage {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    data.fill(luma(data, i) < cutoff ? 0 : 255, i, i + 3);
    data[i + 3] = 255;
  }
  return image;
}

/**
 * Packs a monochrome image into a ZPL `^GFA` field: 1 bit per dot, MSB first,
 * `1` = black, each row padded to a whole byte, hex-coded.
 */
function toGraphicField({ data, width, height }: RawImage): string {
  const rowBytes = round(width / 8, 0, "up");
  const bytes = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] !== 0 && luma(data, i) < 128) {
        bytes[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  const total = bytes.length;
  return `^GFA,${total},${total},${rowBytes},${bytes.toString("hex").toUpperCase()}`;
}

function cropNormalized(image: RawImage, crop: LabelLogoCrop): RawImage {
  const clamp = (value: number, max: number) =>
    Math.min(max, Math.max(0, round(value, 0)));
  const left = clamp(crop.x * image.width, image.width - 1);
  const top = clamp(crop.y * image.height, image.height - 1);
  const width = Math.max(
    1,
    clamp(crop.width * image.width, image.width - left)
  );
  const height = Math.max(
    1,
    clamp(crop.height * image.height, image.height - top)
  );
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * image.width + left) * 4;
    data.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return { data, width, height };
}
