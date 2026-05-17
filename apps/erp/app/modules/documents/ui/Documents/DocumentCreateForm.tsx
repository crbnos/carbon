import { useCarbon } from "@carbon/auth";
import { File, toast } from "@carbon/react";
import {
  buildCompanyPrivateStorageTarget,
  getCompanyPrivateBucket
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { LuUpload } from "react-icons/lu";
import { useSubmit } from "react-router";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

const DocumentCreateForm = () => {
  const { t } = useLingui();
  const submit = useSubmit();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();

  const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      const file = e.target.files[0];
      toast.info(t`Uploading ${file.name}`);
      const target = buildCompanyPrivateStorageTarget({
        companyId,
        logicalFolder: "documents",
        entityId: nanoid(),
        fileName: file.name
      });

      const fileUpload = await carbon.storage
        .from(getCompanyPrivateBucket(companyId))
        .upload(target.objectPath, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true
        });

      if (fileUpload.error) {
        console.error(fileUpload.error);
        toast.error(t`Failed to upload file`);
      }

      if (fileUpload.data?.path) {
        submitFileData({
          path: fileUpload.data.path,
          name: file.name,
          size: file.size
        });
      }
    }
  };

  const submitFileData = ({
    path: filePath,
    name,
    size
  }: {
    path: string;
    name: string;
    size: number;
  }) => {
    const formData = new FormData();
    formData.append("path", filePath);
    formData.append("name", name);
    formData.append("size", Math.round(size / 1024).toString());
    submit(formData, {
      method: "post",
      action: path.to.newDocument,
      navigate: false
    });
  };

  return (
    <File leftIcon={<LuUpload />} onChange={uploadFile}>
      <Trans>Upload</Trans>
    </File>
  );
};

export default DocumentCreateForm;
