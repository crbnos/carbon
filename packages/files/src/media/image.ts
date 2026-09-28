import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type {
  ImageShapeOptions,
  ProcessedImage
} from "../../../database/supabase/functions/shared/image-pipeline.ts";
import {
  ImageTooLargeError,
  outputFormatFor,
  processImage,
  processRawImage,
  UnsupportedImageFormatError
} from "../../../database/supabase/functions/shared/image-pipeline.ts";
import { isUnsafeStoragePath } from "../storage";
import { getFileExtension, isHeic } from "./media";

export * from "../../../database/supabase/functions/shared/image-pipeline.ts";

export type StorageClient = Pick<SupabaseClient, "storage">;

function replaceExtension(fileName: string, extension: string): string {
  const base = fileName.replace(/\.[^.]*$/, "");
  return `${base}.${extension}`;
}

function toFile(processed: ProcessedImage, sourceName: string): File {
  return new File(
    [processed.data as BufferSource],
    replaceExtension(sourceName, processed.extension),
    { type: processed.contentType }
  );
}

/**
 * Run a stored-object image transform (imgproxy) by round-tripping through
 * storage: upload to a temp path, download the transformed rendition, delete
 * the temp. The FALLBACK engine — used when the wasm pipeline can't take an
 * input (unsupported format on the server, or over the memory guard). Works
 * with a user-JWT client (RLS applies — the directory must be one the caller
 * can write, i.e. companyId-scoped) or the service role.
 */
export async function transformImageViaStorage(
  client: StorageClient,
  {
    bucket,
    directory,
    file,
    transform
  }: {
    bucket: string;
    directory: string;
    file: File;
    transform: {
      width?: number;
      height?: number;
      resize?: "cover" | "contain" | "fill";
      quality?: number;
    };
  }
): Promise<Blob> {
  const extension = file.name.split(".").pop() ?? "bin";
  const tempPath = `${directory}/${nanoid()}.${extension}`;
  // The directory is the caller's and the extension comes from the file name;
  // neither may move the staged object out of the directory it names.
  if (isUnsafeStoragePath(tempPath)) {
    throw new Error(`Refused to stage an image at an unsafe path: ${tempPath}`);
  }

  const upload = await client.storage.from(bucket).upload(tempPath, file, {
    upsert: true
  });
  if (upload.error) {
    throw new Error(
      `Failed to stage image for conversion: ${upload.error.message}`
    );
  }

  try {
    const download = await client.storage
      .from(bucket)
      .download(tempPath, { transform });
    if (download.error) {
      throw new Error(`Failed to convert image: ${download.error.message}`);
    }
    return download.data;
  } finally {
    await client.storage.from(bucket).remove([tempPath]);
  }
}

/**
 * Decode via the browser's native decoders (gif, avif, anything the wasm
 * pipeline doesn't cover) and re-enter the shared pipeline with the RGBA.
 */
async function processViaNativeDecode(
  file: File,
  options: ImageShapeOptions
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.drawImage(bitmap, 0, 0);
    const raw = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const processed = await processRawImage(
      { data: raw.data, width: raw.width, height: raw.height },
      getFileExtension(file.name),
      options
    );
    return toFile(processed, file.name);
  } finally {
    bitmap.close();
  }
}

/**
 * The one upload pipeline: decode/shape/re-encode `file` per `options` using
 * the shared wasm pipeline. Formats the pipeline can't decode fall back to the
 * browser's native decoder when running client-side, else to an imgproxy
 * round-trip through storage. Returns the file to store.
 */
export async function prepareImageUpload(
  client: StorageClient,
  {
    bucket,
    directory,
    file,
    ...options
  }: {
    bucket: string;
    directory: string;
    file: File;
  } & ImageShapeOptions
): Promise<File> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const processed = await processImage(
      bytes,
      getFileExtension(file.name),
      options
    );
    return toFile(processed, file.name);
  } catch (error) {
    if (
      !(error instanceof UnsupportedImageFormatError) &&
      !(error instanceof ImageTooLargeError)
    ) {
      throw error;
    }
    if (
      error instanceof UnsupportedImageFormatError &&
      typeof document !== "undefined"
    ) {
      return processViaNativeDecode(file, options);
    }
    // Server-side fallback: imgproxy. No padding support there — contained
    // becomes a plain contain fit; convert keeps dimensions via quality-only.
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
    const blob = await transformImageViaStorage(client, {
      bucket,
      directory,
      file,
      transform
    });
    const jpeg = outputFormatFor(getFileExtension(file.name)) === "jpeg";
    return new File([blob], replaceExtension(file.name, jpeg ? "jpg" : "png"), {
      type: blob.type || (jpeg ? "image/jpeg" : "image/png")
    });
  }
}

// Conversion RENAMES a file (photo.heic → photo.jpg), which can silently
// collide with a photo.jpg already in storage under upsert semantics. The
// upload sites probe the target path for files this set marks; a WeakSet
// holds no references once the File is gone.
const convertedFromHeic = new WeakSet<File>();

/** Was this File produced by HEIC conversion (and therefore renamed)? */
export function wasConvertedFromHeic(file: File): boolean {
  return convertedFromHeic.has(file);
}

/**
 * HEIC/HEIF → JPEG at original dimensions. HEIC must never be stored — call
 * this before any upload that could carry an iPhone photo.
 */
export async function convertHeicToJpeg(
  client: StorageClient,
  { bucket, directory, file }: { bucket: string; directory: string; file: File }
): Promise<File> {
  const converted = await prepareImageUpload(client, {
    bucket,
    directory,
    file,
    convert: true
  });
  convertedFromHeic.add(converted);
  return converted;
}

/**
 * Convert any HEIC files in a picked-file list; other files pass through.
 * Sequential on purpose — each decode materializes a full RGBA frame, and a
 * handful of 48MP photos decoded at once can exhaust browser memory.
 */
export async function convertHeicFiles(
  client: StorageClient,
  { bucket, directory }: { bucket: string; directory: string },
  files: File[]
): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    out.push(
      isHeic(file.name, file.type)
        ? await convertHeicToJpeg(client, { bucket, directory, file })
        : file
    );
  }
  return out;
}

/**
 * First filename appearing twice, or null. Conversion renames `photo.heic`
 * to `photo.jpg`, so a selection holding both collapses to one name — the
 * panels derive storage paths from `file.name` with `upsert: true`, and the
 * second upload would silently replace the first. Callers reject on non-null.
 */
export function findDuplicateFileName(files: File[]): string | null {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.name)) return file.name;
    seen.add(file.name);
  }
  return null;
}
