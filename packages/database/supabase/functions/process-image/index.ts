import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/mod.ts";
import { corsHeaders } from "../lib/headers.ts";
import { corsPreflight, errorResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import {
  ImageTooLargeError,
  outputFormatFor,
  processImage,
  UnsupportedImageFormatError
} from "../shared/image-pipeline.ts";

// The server-side entry to the shared image pipeline, for callers that have
// no browser: the public API, MCP tools, integrations. Browser uploads run the
// identical pipeline client-side via @carbon/utils and never hit this.
//
// Wasm decoders materialize the full RGBA frame, so this runtime's memory cap
// bounds the input; larger images (48MP iPhone photos) fall back to an
// imgproxy round-trip through storage, which decodes natively.
const MAX_PIXELS = 25_000_000;

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const companyId = formData.get("companyId") as string | null;
    const userId = formData.get("userId") as string | null;
    const targetHeight = formData.get("height") as string | null;
    // Explicit truthy set — !!formData.get() would read "false"/"0" as true
    const asFlag = (name: string) =>
      ["true", "1"].includes(String(formData.get(name) ?? "").toLowerCase());

    if (!file) throw new Error("No file provided");
    if (!companyId || !userId) throw new Error("companyId and userId required");

    let height: number | undefined;
    if (targetHeight) {
      height = Number(targetHeight);
      if (!Number.isInteger(height) || height <= 0 || height > 10_000) {
        throw new Error("height must be a positive integer");
      }
    }

    const client = await requirePermissions(req, companyId, userId, {});

    const options = {
      height,
      contained: asFlag("contained"),
      convert: asFlag("convert")
    };

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      const processed = await processImage(bytes, extension, {
        ...options,
        maxPixels: MAX_PIXELS
      });
      return new Response(processed.data as BodyInit, {
        headers: {
          ...corsHeaders,
          "Content-Type": processed.contentType,
          "Content-Length": processed.data.length.toString()
        }
      });
    } catch (err) {
      if (
        !(err instanceof UnsupportedImageFormatError) &&
        !(err instanceof ImageTooLargeError)
      ) {
        throw err;
      }
      // imgproxy fallback: stage in the company's temp dir, download the
      // transformed rendition, clean up.
      const tempPath = `${companyId}/tmp/${nanoid()}.${extension}`;
      const upload = await client.storage
        .from("private")
        .upload(tempPath, file, { upsert: true });
      if (upload.error) throw new Error(upload.error.message);
      try {
        const transform = options.height
          ? { height: options.height, resize: "contain" as const, quality: 90 }
          : options.convert
            ? { quality: 90 }
            : {
                width: 300,
                height: 300,
                resize: options.contained
                  ? ("contain" as const)
                  : ("cover" as const),
                quality: 90
              };
        const download = await client.storage
          .from("private")
          .download(tempPath, { transform });
        if (download.error) throw new Error(download.error.message);
        const contentType =
          download.data.type ||
          (outputFormatFor(extension) === "jpeg" ? "image/jpeg" : "image/png");
        return new Response(download.data, {
          headers: { ...corsHeaders, "Content-Type": contentType }
        });
      } finally {
        await client.storage.from("private").remove([tempPath]);
      }
    }
  } catch (err) {
    return errorResponse(err, 500);
  }
});
