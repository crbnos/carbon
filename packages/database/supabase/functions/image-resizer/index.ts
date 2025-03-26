import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
AlphaOption,
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

    // Log file info for debugging
    console.log({
      fileName: file.name,
      fileType: file.type,
      fileSize: bytes.length,
      targetHeight,
      contained,
    });

    let result;
    try {
      result = ImageMagick.read(bytes, (img) => {
        console.log({
          originalFormat: img.format,
          originalWidth: img.width,
          originalHeight: img.height,
          originalDepth: img.depth,
          originalColorSpace: img.colorSpace,
        });

        // First convert to PNG to ensure consistent handling
        img.format = MagickFormat.Png;
        // Apply background for transparent PNGs to avoid issues
        if (img.hasAlpha) {
          console.log("Image has alpha channel");
          // Flatten the image with a white background to avoid transparency issues
          const background = new MagickColor("white");
          img.backgroundColor = background;
          img.alpha(AlphaOption.Off); // Remove alpha channel after flattening
        }

        // Write to PNG first to ensure format conversion is applied
        img.write((data) => data);

        const width = img.width;
        const height = img.height;

        if (targetHeight) {
          console.log("Processing with targetHeight:", targetHeight);
          const targetHeightInt = parseInt(targetHeight, 10);

          // Ensure we have valid dimensions
          if (isNaN(targetHeightInt) || targetHeightInt <= 0) {
            throw new Error("Invalid target height");
          }

          const ratio = img.width / img.height;
          const targetWidthInt = Math.round(targetHeightInt * ratio);

          console.log(`Resizing to ${targetWidthInt}x${targetHeightInt}`);
          // Add quality settings for resize
          img.resize(targetWidthInt, targetHeightInt);
          img.quality = 90;
        } else if (contained) {
          console.log("Processing with contained mode");
          // Calculate size with 10% padding
          const padding = 0.1; // 10% padding
          const maxDimension = Math.max(width, height);
          const sizeWithPadding = Math.ceil(maxDimension * (1 + 2 * padding));

          console.log(`Extending to ${sizeWithPadding}x${sizeWithPadding}`);
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

          console.log("Resizing to 300x300");
          const resizeGeometry = new MagickGeometry(300, 300);
          resizeGeometry.ignoreAspectRatio = true;
          img.resize(resizeGeometry);
          img.quality = 90;
        } else {
          console.log("Processing with default square crop mode");
          // Calculate the size for cropping
          const size = Math.min(width, height);

          // Calculate offsets for centering the crop
          const x = Math.floor((width - size) / 2);
          const y = Math.floor((height - size) / 2);

          console.log(`Cropping to ${size}x${size} from position ${x},${y}`);
          // Crop to square with explicit geometry
          const cropGeometry = new MagickGeometry(x, y, size, size);
          cropGeometry.ignoreAspectRatio = true;
          img.crop(cropGeometry);

          console.log("Resizing to 300x300");
          // Resize with quality settings
          img.resize(300, 300);
          img.quality = 90;
        }

        // Strip metadata to reduce size
        img.strip();

        console.log("Final processing complete");
        return img.write((data) => {
          console.log("Image data generated, size:", data.length);
          return data;
        });
      });
    } catch (imgError) {
      console.error("ImageMagick processing error:", imgError);
      
      // Fallback processing for problematic images
      result = ImageMagick.read(bytes, (img) => {
        console.log("Using fallback processing method");
        
        // Force conversion to JPEG which has better compatibility
        img.format = MagickFormat.Jpeg;
        img.quality = 90;
        
        if (targetHeight) {
          const targetHeightInt = parseInt(targetHeight, 10);
          const ratio = img.width / img.height;
          const targetWidthInt = Math.round(targetHeightInt * ratio);
          img.resize(targetWidthInt, targetHeightInt);
        } else {
          // Simple resize to 300x300 without complex operations
          img.resize(300, 300);
        }
        
        img.strip();
        return img.write((data) => data);
      });
    }

    console.log("Returning processed image");
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
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
