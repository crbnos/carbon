import type { ImageShapeOptions } from "../../../database/supabase/functions/shared/image-pipeline.ts";
import {
  convertHeicFiles,
  convertHeicToJpeg,
  findDuplicateFileName,
  prepareImageUpload,
  type StorageClient
} from "./image";

/**
 * Conversion renamed two picked files to the same name (photo.heic +
 * photo.jpg → photo.jpg). Uploading would silently overwrite one with the
 * other, so preparation refuses instead.
 */
export class DuplicateFileNameError extends Error {
  constructor(readonly fileName: string) {
    super(`Duplicate file name after conversion: ${fileName}`);
    this.name = "DuplicateFileNameError";
  }
}

/**
 * The one object that knows HOW files become storable: which storage client
 * to convert through and where HEIC staging lives. Callers hold one of these
 * instead of threading (client, {bucket, directory}) through every function.
 *
 * "HEIC is never stored" is enforced here: every upload path calls
 * `prepareForUpload` (or `convertHeic`) before anything is written.
 */
export class MediaUploader {
  constructor(
    private readonly client: StorageClient,
    private readonly staging: { bucket: string; directory: string }
  ) {}

  /**
   * Make a picked-file list storable: HEIC converts to JPEG (sequentially —
   * each decode materializes a full RGBA frame), everything else passes
   * through. Throws `DuplicateFileNameError` when conversion collapses two
   * names into one; conversion failures throw whatever the pipeline threw.
   */
  async prepareForUpload(files: File[]): Promise<File[]> {
    const prepared = await convertHeicFiles(this.client, this.staging, files);
    const duplicate = findDuplicateFileName(prepared);
    if (duplicate) throw new DuplicateFileNameError(duplicate);
    return prepared;
  }

  /** HEIC/HEIF → JPEG at original dimensions; other files pass through. */
  async convertHeic(file: File): Promise<File> {
    return convertHeicToJpeg(this.client, { ...this.staging, file });
  }

  /** Full image shaping (crop/contain/height/convert) for curated uploads. */
  async prepareImage(
    file: File,
    options: ImageShapeOptions = {}
  ): Promise<File> {
    return prepareImageUpload(this.client, {
      ...this.staging,
      file,
      ...options
    });
  }
}
