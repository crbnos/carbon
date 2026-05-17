import { toast } from "@carbon/react";
import {
  buildCompanyPrivateStorageTarget,
  getCompanyPrivateBucket
} from "@carbon/utils";
import { useCallback } from "react";
import { useUser } from "~/hooks";
import type { Job, StorageItem } from "~/services/types";
import { path } from "~/utils/path";

export function useFiles(job: Job) {
  const user = useUser();
  const companyPrivateBucket = getCompanyPrivateBucket(user.company.id);

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

      return buildCompanyPrivateStorageTarget({
        companyId,
        logicalFolder: bucket,
        entityId: id,
        fileName: file.name
      }).objectPath;
    },
    [job.id, job.itemId, job.quoteLineId, job.salesOrderLineId, user.company.id]
  );

  const downloadFile = useCallback(
    async (file: StorageItem) => {
      const url = path.to.file.preview(companyPrivateBucket, getFilePath(file));
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
        console.error(error);
      }
    },
    [companyPrivateBucket, getFilePath]
  );

  const downloadModel = useCallback(
    async (model: { modelPath: string; modelName: string }) => {
      if (!model.modelPath || !model.modelName) {
        toast.error("Model data is missing");
        return;
      }

      const url = path.to.file.preview(companyPrivateBucket, model.modelPath);
      try {
        const response = await fetch(url);
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
        console.error(error);
      }
    },
    [companyPrivateBucket]
  );

  return {
    downloadFile,
    downloadModel,
    getFilePath
  };
}
