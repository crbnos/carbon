import { useCarbon } from "@carbon/auth";
import { useCallback, useState } from "react";
import { uploadModelResumable } from "~/utils/resumable-upload";

export type ModelUploadProgress = {
  percent: number;
  uploaded: number;
  total: number;
};

/**
 * Shared resumable (TUS) model-upload logic — the single source of truth for
 * every CAD upload surface (CadModel, PartForm, ToolForm). Owns the progress
 * state (render it with `<ModelUploadProgress {...upload} />`) and swallows the
 * upload into a `{ error }` result so callers keep their existing flow.
 */
export function useModelUpload() {
  const { accessToken } = useCarbon();
  const [upload, setUpload] = useState<ModelUploadProgress | null>(null);

  const runUpload = useCallback(
    async ({
      bucket,
      path,
      file
    }: {
      bucket: string;
      path: string;
      file: File;
    }): Promise<{ error: unknown }> => {
      setUpload({ percent: 0, uploaded: 0, total: file.size });
      try {
        await uploadModelResumable({
          accessToken,
          bucket,
          path,
          file,
          onProgress: (percent, uploaded, total) =>
            setUpload({ percent, uploaded, total })
        });
        return { error: null };
      } catch (error) {
        return { error };
      } finally {
        setUpload(null);
      }
    },
    [accessToken]
  );

  return { upload, runUpload };
}
