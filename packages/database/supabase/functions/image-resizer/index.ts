import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  ImageMagick,
  initializeImageMagick,
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
    if (!file) {
      throw new Error("No file provided");
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const result = await ImageMagick.read(bytes, (img) => {
      const width = img.width;
      const height = img.height;

      // Calculate the size for cropping
      const size = Math.min(width, height);

      // Calculate offsets for centering the crop
      const x = Math.floor((width - size) / 2);
      const y = Math.floor((height - size) / 2);

      // Crop to square
      img.crop(new MagickGeometry(x, y, size, size));

      // Resize to 400x400
      img.resize(300, 300);

      return img.write((data) => data);
    });

    return new Response(result, {
      headers: {
        ...corsHeaders,
        "Content-Type": "image/png",
        "Content-Length": result.length.toString(),
      },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
