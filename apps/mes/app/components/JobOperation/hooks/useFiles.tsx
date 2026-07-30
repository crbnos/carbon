import { getLogger } from "@carbon/logger";
import { toast } from "@carbon/react";
import { useCallback } from "react";
import { useUser } from "~/hooks";
import type { Job, StorageItem } from "~/services/types";
import { path } from "~/utils/path";

const log = getLogger("mes", "job-operation");

export function useFiles(job: Job) {
  const user = useUser();

  const getFilePath = useCallback(
    (file: StorageItem) => {
      const companyId = user.company.id;
      const { bucket } = file;
      let id: string | null = "";

      switch (bucket) {
        case "job":
          id = job.id;
          break;
        case "opportunity-line":
          id = job.salesOrderLineId ?? job.quoteLineId;
          break;
        case "parts":
          id = file.itemId ?? job.itemId;
          break;
      }

      return `${companyId}/${bucket}/${id}/${file.name}`;
    },
    [job.id, job.itemId, job.quoteLineId, job.salesOrderLineId, user.company.id]
  );

  const downloadFile = useCallback(
    async (file: StorageItem) => {
      const url = path.to.file.previewFile(`private/${getFilePath(file)}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        log.error("Error downloading file", { error });
      }
    },
    [getFilePath]
  );

  const downloadModel = useCallback(
    async (model: { modelId: string | null; modelName: string | null }) => {
      if (!model.modelId || !model.modelName) {
        toast.error("Model data is missing");
        return;
      }

      // The download route resolves the customer's ORIGINAL file — fetching
      // `modelPath` directly would serve the compacted `.xbf.zst` (an OCCT
      // container no CAD tool opens) once compaction has repointed it.
      const url = path.to.api.modelDownload(model.modelId);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          toast.error(
            response.status === 404
              ? "The original model file is no longer available"
              : "Error downloading file"
          );
          return;
        }
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = model.modelName;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (error) {
        toast.error("Error downloading file");
        log.error("Error downloading file", { error });
      }
    },
    []
  );

  return {
    downloadFile,
    downloadModel,
    getFilePath
  };
}
