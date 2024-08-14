import { File, toast } from "@carbon/react";
import { useSubmit } from "@remix-run/react";
import type { ChangeEvent } from "react";
import { LuUpload } from "react-icons/lu";
import { usePermissions, useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import { path } from "~/utils/path";

type SalesRFQDocumentFormProps = {
  id: string;
};

const SalesRFQDocumentForm = ({ id }: SalesRFQDocumentFormProps) => {
  const submit = useSubmit();
  const { company } = useUser();
  const { supabase } = useSupabase();
  const permissions = usePermissions();

  const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && supabase && company) {
      const file = e.target.files[0];
      const fileName = `${company.id}/sales-rfq/${id}/${file.name}`;

      const fileUpload = await supabase.storage
        .from("private")
        .upload(fileName, file, {
          cacheControl: `${12 * 60 * 60}`,
        });

      if (fileUpload.error) {
        toast.error("Failed to upload file");
      }

      if (fileUpload.data?.path) {
        toast.success("File uploaded");
        submitFileData({
          path: fileUpload.data.path,
          name: file.name,
          size: file.size,
        });
      }
    }
  };

  const submitFileData = ({
    path: filePath,
    name,
    size,
  }: {
    path: string;
    name: string;
    size: number;
  }) => {
    const formData = new FormData();
    formData.append("path", filePath);
    formData.append("name", name);
    formData.append("size", Math.round(size / 1024).toString());
    formData.append("sourceDocument", "Request for Quote");
    formData.append("sourceDocumentId", id);

    submit(formData, {
      method: "post",
      action: path.to.newDocument,
    });
  };

  return (
    <File
      isDisabled={!permissions.can("update", "sales")}
      leftIcon={<LuUpload />}
      onChange={uploadFile}
    >
      New
    </File>
  );
};

export default SalesRFQDocumentForm;
