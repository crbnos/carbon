import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  AlphaOption,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickGeometry,
  Percentage,
} from "npm:@imagemagick/magick-wasm@0.0.30";

import { corsHeaders } from "../lib/headers.ts";

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30")
  )
);
await initializeImageMagick(wasmBytes);

const HEX = "0123456789ABCDEF";

/**
 * Pack a monochrome RGBA buffer into a ZPL `^GFA` graphic field: rows of 1-bpp
 * pixels (MSB-first, `1` = black), padded to a byte boundary per row, hex-coded.
 */
function rgbaToGFA(rgba: Uint8Array, w: number, h: number, thresh = 128): string {
  const rowBytes = Math.ceil(w / 8);
  const total = rowBytes * h;
  const bytes = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3];
      const lum =
        a === 0 ? 255 : rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
      if (lum < thresh) bytes[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  let hex = "";
  for (let k = 0; k < total; k++) {
    hex += HEX[bytes[k] >> 4] + HEX[bytes[k] & 15];
  }
  return `^GFA,${total},${total},${rowBytes},${hex}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const widthDots = Math.max(
      16,
      Math.min(1200, parseInt((formData.get("widthDots") as string) || "240", 10))
    );
    const threshold = parseInt((formData.get("threshold") as string) || "50", 10);
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

    let monoPng = "";
    let gfa = "";
    let outW = 0;
    let outH = 0;

    ImageMagick.read(bytes, (img) => {
      // Crop first (normalized → pixels), so downstream sizing sees the region.
      if (hasCrop) {
        const px = Math.max(1, Math.round((cropW as number) * img.width));
        const py = Math.max(1, Math.round((cropH as number) * img.height));
        img.crop(
          new MagickGeometry(
            Math.round((cropX as number) * img.width),
            Math.round((cropY as number) * img.height),
            px,
            py
          )
        );
        img.resetPage();
      }
      // Flatten transparency onto white so it doesn't threshold to black.
      img.backgroundColor = new MagickColor("white");
      img.alpha(AlphaOption.Remove);
      // Grayscale + threshold → clean 1-bit black & white.
      img.grayscale();
      img.threshold(new Percentage(threshold));
      // Scale to the requested dot width (height proportional).
      img.resize(new MagickGeometry(`${widthDots}`));
      outW = img.width;
      outH = img.height;

      // PDF B&W logo.
      img.format = MagickFormat.Png;
      img.write((data) => {
        let b = "";
        for (let i = 0; i < data.length; i++) b += String.fromCharCode(data[i]);
        monoPng = `data:image/png;base64,${btoa(b)}`;
      });

      // ZPL graphic.
      img.getPixels((pixels) => {
        const rgba = pixels.toByteArray(0, 0, outW, outH, "RGBA");
        if (rgba) gfa = rgbaToGFA(rgba, outW, outH);
      });
    });

    return new Response(
      JSON.stringify({ monoPng, gfa, widthDots: outW, heightDots: outH }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
