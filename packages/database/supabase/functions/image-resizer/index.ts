import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  Gravity,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickGeometry,
} from "npm:@imagemagick/magick-wasm@0.0.30";

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30")
  )
);
await initializeImageMagick(wasmBytes);

import { corsHeaders } from "../lib/headers.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log({
      function: "image-resizer",
    });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const targetHeight = formData.get("height") as string | null;
    const contained = !!(formData.get("contained") as string | null);

    if (!file) {
      throw new Error("No file provided");
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const result = ImageMagick.read(bytes, (img) => {
      // First convert to PNG to ensure consistent handling
      img.format = MagickFormat.Png;
      img.write((data) => data); // Write to PNG first

      const width = img.width;
      const height = img.height;

      if (targetHeight) {
        console.log("targetHeight");
        const targetHeightInt = parseInt(targetHeight, 10);

        // Ensure we have valid dimensions
        if (isNaN(targetHeightInt) || targetHeightInt <= 0) {
          throw new Error("Invalid target height");
        }

        const ratio = img.width / img.height;
        const targetWidthInt = Math.round(targetHeightInt * ratio);

        // Add quality settings for resize
        img.resize(targetWidthInt, targetHeightInt);
        img.quality = 90;
      } else if (contained) {
        console.log("contained");
        // Calculate size with 10% padding
        const padding = 0.1; // 10% padding
        const maxDimension = Math.max(width, height);
        const sizeWithPadding = Math.ceil(maxDimension * (1 + 2 * padding));

        // Create geometry for the centered image with padding
        const containedGeometry = new MagickGeometry(
          0,
          0,
          sizeWithPadding,
          sizeWithPadding
        );
        containedGeometry.ignoreAspectRatio = true;

        img.extent(
          containedGeometry,
          Gravity.Center,
          new MagickColor("transparent")
        );

        const resizeGeometry = new MagickGeometry(300, 300);
        resizeGeometry.ignoreAspectRatio = true;
        img.resize(resizeGeometry);
        img.quality = 90;
      } else {
        console.log("default");
        // Calculate the size for cropping
        const size = Math.min(width, height);

        // Calculate offsets for centering the crop
        const x = Math.floor((width - size) / 2);
        const y = Math.floor((height - size) / 2);

        // Crop to square with explicit geometry
        const cropGeometry = new MagickGeometry(x, y, size, size);
        cropGeometry.ignoreAspectRatio = true;
        img.crop(cropGeometry);

        // Resize with quality settings
        img.resize(300, 300);
        img.quality = 90;
      }

      // Strip metadata to reduce size
      img.strip();

      return img.write((data) => data);
    });

    return new Response(result, {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Content-Length": result.length.toString(),
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (err) {
    console.error("Image processing error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
