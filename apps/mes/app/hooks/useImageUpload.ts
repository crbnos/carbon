import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket, storage } from "@carbon/files";
import { isHeic, MediaUploader } from "@carbon/files/media";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useCallback, useMemo } from "react";
import { getPrivateUrl } from "~/utils/path";
import { useUser } from "./useUser";

/**
 * Shared editor/notes image-upload handler (mirror of the ERP hook). HEIC is
 * converted to JPEG before anything is stored; the file lands in the private
 * bucket under `{companyId}/{directory}/{nanoid}.{ext}` and the preview URL
 * is returned for the editor to embed.
 */
export function useImageUpload(directory: string) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const { t } = useLingui();

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

  return useCallback(
    async (file: File) => {
      if (!carbon || !uploader) throw new Error("Carbon client not found");

      let upload = file;
      if (isHeic(file.name, file.type)) {
        try {
          upload = await uploader.convertHeic(file);
        } catch (error) {
          toast.error(t`Failed to convert image`);
          throw error;
        }
      }

      const fileType = upload.name.split(".").pop();
      const fileName = `${company.id}/${directory}/${nanoid()}.${fileType}`;

      const result = await storage(carbon)
        .company(company.id)
        .upload(fileName, upload);

      if (result.error) {
        toast.error(t`Failed to upload image`);
        throw new Error(result.error.message);
      }

      if (!result.data) {
        throw new Error("Failed to upload image");
      }

      return getPrivateUrl(result.data.path);
    },
    [carbon, uploader, company.id, directory, t]
  );
}
