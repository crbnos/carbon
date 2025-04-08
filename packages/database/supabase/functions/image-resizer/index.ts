import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import {
  Gravity,
  ImageMagick,
  initializeImageMagick,
  MagickColor,
  MagickFormat,
  MagickGeometry,
} from "npm:@imagemagick/magick-wasm@0.0.30";

// Initialize ImageMagick with proper error handling
let wasmInitialized = false;
try {
  const wasmBytes = await Deno.readFile(
    new URL(
      "magick.wasm",
      import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30")
    )
  );
  await initializeImageMagick(wasmBytes);
  wasmInitialized = true;
  console.log("ImageMagick WASM initialized successfully");
} catch (error) {
  console.error("Failed to initialize ImageMagick WASM:", error);
}

import { corsHeaders } from "../lib/headers.ts";

// Maximum dimensions to process without aggressive downscaling
const MAX_SAFE_DIMENSION = 2000;
// Maximum dimensions to attempt processing at all
const MAX_ALLOWED_DIMENSION = 5000;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Check if ImageMagick was properly initialized
  if (!wasmInitialized) {
    return new Response(
      JSON.stringify({ error: "Image processing service unavailable" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 503,
      }
    );
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

    // For extremely large files, reject immediately
    if (bytes.length > 10 * 1024 * 1024) {
      // 10MB limit
      throw new Error("File too large, maximum size is 10MB");
    }

    let result: Uint8Array;
    try {
      // First just read the image dimensions without full processing
      const dimensions = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          try {
            ImageMagick.read(bytes, (img) => {
              resolve({ width: img.width, height: img.height });
            });
          } catch (err) {
            reject(err);
          }
        }
      );

      // Reject extremely large images that would cause CPU timeouts
      if (
        dimensions.width > MAX_ALLOWED_DIMENSION ||
        dimensions.height > MAX_ALLOWED_DIMENSION
      ) {
        throw new Error(
          `Image dimensions too large (${dimensions.width}x${dimensions.height}). Maximum allowed is ${MAX_ALLOWED_DIMENSION}x${MAX_ALLOWED_DIMENSION}`
        );
      }

      // Calculate initial scale factor for large images
      let initialScaleFactor = 1.0;
      const maxDimension = Math.max(dimensions.width, dimensions.height);

      if (maxDimension > MAX_SAFE_DIMENSION) {
        initialScaleFactor = MAX_SAFE_DIMENSION / maxDimension;
        console.log(
          `Large image detected. Initial scale factor: ${initialScaleFactor.toFixed(
            2
          )}`
        );
      }

      result = await new Promise<Uint8Array>((resolve, reject) => {
        try {
          const data = ImageMagick.read(bytes, (img) => {
            console.log({
              originalFormat: img.format,
              originalWidth: img.width,
              originalHeight: img.height,
              originalDepth: img.depth,
              originalColorSpace: img.colorSpace,
            });

            // Apply initial scaling for large images
            if (initialScaleFactor < 1.0) {
              const newWidth = Math.floor(img.width * initialScaleFactor);
              const newHeight = Math.floor(img.height * initialScaleFactor);
              console.log(
                `Pre-scaling large image to ${newWidth}x${newHeight}`
              );

              // Use faster resize for initial downscaling
              img.resize(newWidth, newHeight);
            }

            // First convert to PNG to ensure consistent handling
            img.format = MagickFormat.Png;

            const width = img.width;
            const height = img.height;

            if (targetHeight) {
              console.log("Processing with targetHeight:", targetHeight);
              const targetHeightInt = parseInt(targetHeight, 10);

              // Ensure we have valid dimensions
              if (isNaN(targetHeightInt) || targetHeightInt <= 0) {
                throw new Error("Invalid target height");
              }

              const ratio = width / height;
              const targetWidthInt = Math.round(targetHeightInt * ratio);

              console.log(`Resizing to ${targetWidthInt}x${targetHeightInt}`);
              img.resize(targetWidthInt, targetHeightInt);
              img.quality = 90;
            } else if (contained) {
              console.log("Processing with contained mode");

              // For contained mode, use a more efficient approach
              // First resize to a reasonable size while maintaining aspect ratio
              const targetSize = 500; // Target size for the longer dimension
              let newWidth, newHeight;

              if (width > height) {
                newWidth = targetSize;
                newHeight = Math.round(targetSize * (height / width));
              } else {
                newHeight = targetSize;
                newWidth = Math.round(targetSize * (width / height));
              }

              console.log(
                `Resizing to ${newWidth}x${newHeight} before containment`
              );
              img.resize(newWidth, newHeight);

              // Calculate size with 10% padding
              const padding = 0.1; // 10% padding
              const maxDimension = Math.max(newWidth, newHeight);
              const sizeWithPadding = Math.ceil(
                maxDimension * (1 + 2 * padding)
              );

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

              // For square crop, first resize to a reasonable size to reduce CPU usage
              const maxDimension = Math.max(width, height);
              if (maxDimension > 600) {
                const scaleFactor = 600 / maxDimension;
                const newWidth = Math.floor(width * scaleFactor);
                const newHeight = Math.floor(height * scaleFactor);
                console.log(
                  `Pre-scaling to ${newWidth}x${newHeight} before cropping`
                );
                img.resize(newWidth, newHeight);
              }

              // Now perform the square crop
              const size = Math.min(img.width, img.height);
              const x = Math.floor((img.width - size) / 2);
              const y = Math.floor((img.height - size) / 2);

              console.log(
                `Cropping to ${size}x${size} from position ${x},${y}`
              );
              const cropGeometry = new MagickGeometry(x, y, size, size);
              cropGeometry.ignoreAspectRatio = true;
              img.crop(cropGeometry);

              console.log("Resizing to 300x300");
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
          resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    } catch (imgError) {
      console.error("ImageMagick processing error:", imgError);

      // Simplified fallback for problematic images
      result = await new Promise<Uint8Array>((resolve, reject) => {
        try {
          const data = ImageMagick.read(bytes, (img) => {
            console.log("Using simplified fallback processing method");

            // Aggressively downscale first
            const scaleFactor = 800 / Math.max(img.width, img.height);
            const newWidth = Math.floor(img.width * scaleFactor);
            const newHeight = Math.floor(img.height * scaleFactor);

            console.log(`Fallback: downscaling to ${newWidth}x${newHeight}`);
            img.resize(newWidth, newHeight);

            // Convert to PNG to maintain transparency
            img.format = MagickFormat.Png;

            if (contained) {
              // Simple contained mode for fallback
              const size = 300;
              const canvas = new MagickGeometry(0, 0, size, size);
              img.extent(
                canvas,
                Gravity.Center,
                new MagickColor("transparent")
              );
            } else {
              // Simple resize to 300x300
              img.resize(300, 300);
            }

            img.strip();
            img.quality = 85;

            return img.write((data) => data);
          });
          resolve(data);
        } catch (err) {
          reject(err);
        }
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
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
