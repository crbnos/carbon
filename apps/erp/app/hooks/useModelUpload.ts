// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import {
  findInterruptedUpload,
  forgetUpload,
  type InterruptedUpload,
  noteUploadProgress,
  noteUploadStarted,
  uploadModelResumable
} from "~/utils/resumable-upload";
import { useUser } from "./useUser";

export type ModelUploadProgress = {
  percent: number;
  uploaded: number;
  total: number;
};

export type ModelUploadResult = {
  error: unknown;
  /** The model's id: the uploaded file's name without its extension. */
  modelId: string;
  /** Where the file is in `temp-staging`. */
  modelPath: string;
};

function modelIdOf(path: string) {
  return path.slice(path.lastIndexOf("/") + 1).split(".")[0];
}

/**
 * Shared resumable (TUS) model upload for every CAD upload surface (CadModel,
 * PartForm, ToolForm). Owns the progress state (render it with
 * `<UploadProgress {...upload} />`) and returns `{ error, modelId, modelPath }`.
 *
 * The id and path come from the upload, not the caller: dropping a file whose
 * upload a reload cut off resumes that upload, under its own path. `scope`
 * names what the model is for (`item:<id>`, `new-part`, …); `interrupted` is
 * the upload a reload cut off there, so the page can say to drop it again.
 */
export function useModelUpload(scope: string) {
  const { accessToken } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const [upload, setUpload] = useState<ModelUploadProgress | null>(null);
  const [interrupted, setInterrupted] = useState<InterruptedUpload | null>(
    null
  );

  useEffect(() => {
    let current = true;
    findInterruptedUpload(scope).then((found) => {
      if (current) setInterrupted(found);
    });
    return () => {
      current = false;
    };
  }, [scope]);

  const runUpload = useCallback(
    async (file: File): Promise<ModelUploadResult> => {
      const extension = file.name.split(".").pop();
      let modelPath = `${companyId}/models/${nanoid()}.${extension}`;
      setUpload({ percent: 0, uploaded: 0, total: file.size });
      try {
        ({ path: modelPath } = await uploadModelResumable({
          accessToken,
          bucket: TEMP_STAGING_BUCKET,
          path: modelPath,
          preferPath: interrupted?.path,
          file,
          onStart: (path) => {
            modelPath = path;
            noteUploadStarted(scope, {
              path,
              name: file.name,
              size: file.size
            });
          },
          onProgress: (percent, uploaded, total) => {
            setUpload({ percent, uploaded, total });
            noteUploadProgress(modelPath, percent);
          }
        }));
        forgetUpload(modelPath);
        // A different file landed here instead: the old reminder no longer applies.
        if (interrupted) forgetUpload(interrupted.path);
        setInterrupted(null);
        return { error: null, modelId: modelIdOf(modelPath), modelPath };
      } catch (error) {
        return { error, modelId: modelIdOf(modelPath), modelPath };
      } finally {
        setUpload(null);
      }
    },
    [accessToken, companyId, interrupted, scope]
  );

  const dismissInterrupted = useCallback(() => {
    if (interrupted) forgetUpload(interrupted.path);
    setInterrupted(null);
  }, [interrupted]);

  return { upload, runUpload, interrupted, dismissInterrupted };
}
