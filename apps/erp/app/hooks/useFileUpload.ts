import { useCarbon } from "@carbon/auth";
import {
  getCompanyPrivateBucket,
  safeStorageFileName,
  storage
} from "@carbon/files";
import {
  DuplicateFileNameError,
  MediaUploader,
  wasConvertedFromHeic
} from "@carbon/files/media";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { useUser } from "./useUser";

export type FileUploadOptions = {
  /** Storage path for one prepared file (HEIC already converted to .jpg). */
  getPath?: (file: File) => string;
  /** Runs per successfully stored file — create the record, toast, etc. */
  onSuccess?: (file: File, path: string) => void | Promise<void>;
  /** Runs per failed file, after the error toast. */
  onError?: (file: File) => void;
};

/**
 * The one company-private-bucket upload mutation for document panels: prepare the
 * files (HEIC → JPEG, duplicate-name refusal), store each one, surface
 * failures. Panels supply only what differs — the path and what a stored file
 * means — either once at the hook (the common case) or per call when a
 * variable like the target bucket only exists at call time. Every upload path
 * goes through here or FileDropzone, so "HEIC is never stored" holds without
 * each panel remembering to convert.
 *
 * Shaped like a TanStack mutation: options at the hook, per-call overrides,
 * and an `isUploading` flag for pending UI.
 */
export function useFileUpload(options: FileUploadOptions = {}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();
  const [isUploading, setIsUploading] = useState(false);

  const uploader = useMemo(
    () =>
      carbon
        ? new MediaUploader(carbon, {
            bucket: getCompanyPrivateBucket(company.id),
            directory: `${company.id}/tmp`
          })
        : null,
    [carbon, company.id]
  );

  const {
    getPath: baseGetPath,
    onSuccess: baseOnSuccess,
    onError: baseOnError
  } = options;

  const upload = useCallback(
    async (files: File[], overrides: FileUploadOptions = {}) => {
      const getPath = overrides.getPath ?? baseGetPath;
      const onSuccess = overrides.onSuccess ?? baseOnSuccess;
      const onError = overrides.onError ?? baseOnError;
      if (!getPath) throw new Error("useFileUpload requires getPath");
      if (!carbon || !uploader) {
        toast.error(t`Carbon client not available`);
        return;
      }

      // Storage keys can't hold `?`, `#` or `%` — the first two end the key
      // there, silently shortening the name. Rename up front (before HEIC
      // conversion, which marks the files it produces) and say so, so the
      // stored key, the document record and what the user sees all agree.
      const nameable: File[] = [];
      for (const file of files) {
        const name = safeStorageFileName(file.name);
        if (!name) {
          toast.error(t`Can't upload a file named ${file.name}`);
          onError?.(file);
          continue;
        }
        if (name !== file.name) {
          toast.info(t`${file.name} will be saved as ${name}`);
          nameable.push(
            new File([file], name, {
              type: file.type,
              lastModified: file.lastModified
            })
          );
          continue;
        }
        nameable.push(file);
      }
      if (nameable.length === 0) return;

      setIsUploading(true);
      try {
        let prepared: File[];
        try {
          prepared = await uploader.prepareForUpload(nameable);
        } catch (error) {
          toast.error(
            error instanceof DuplicateFileNameError
              ? t`Duplicate file names after image conversion`
              : t`Failed to convert image`
          );
          return;
        }

        for (const file of prepared) {
          const targetPath = getPath(file);
          // Conversion renamed this file (photo.heic → photo.jpg) — under
          // upsert semantics it could silently replace an existing photo.jpg
          // the user never mentioned. Plain same-name re-uploads keep the
          // replace-by-name behavior; only the masked case is refused.
          if (wasConvertedFromHeic(file)) {
            const existing = await storage(carbon)
              .company(company.id)
              .info(targetPath);
            if (!existing.error && existing.data) {
              toast.error(
                t`A file named ${file.name} already exists — delete or rename it first`
              );
              onError?.(file);
              continue;
            }
          }
          toast.info(t`Uploading ${file.name}`);
          const result = await storage(carbon)
            .company(company.id)
            .upload(targetPath, file, {
              cacheControl: `${12 * 60 * 60}`,
              upsert: true
            });

          if (result.error || !result.data?.path) {
            toast.error(t`Failed to upload file: ${file.name}`);
            onError?.(file);
            continue;
          }
          await onSuccess?.(file, result.data.path);
        }
      } finally {
        setIsUploading(false);
      }
    },
    // options fields are destructured above so callers may pass an inline object
    [carbon, uploader, company.id, t, baseGetPath, baseOnSuccess, baseOnError]
  );

  return { upload, isUploading };
}
