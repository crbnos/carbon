import { useCarbon } from "@carbon/auth";
import { File, toast } from "@carbon/react";
import { useSubmit } from "@remix-run/react";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { LuUpload } from "react-icons/lu";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

const DocumentCreateForm = () => {
  const submit = useSubmit();
  const { carbon } = useCarbon();
  const user = useUser();

  const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      const file = e.target.files[0];
      const fileExtension = file.name.substring(file.name.lastIndexOf(".") + 1);
      const fileName = `${user.id}/${nanoid()}.${fileExtension}`;

      const fileUpload = await carbon.storage
        .from("private")
        .upload(fileName, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true,
        });

      if (fileUpload.error) {
        console.error(fileUpload.error);
        toast.error("Failed to upload file");
      }

      if (fileUpload.data?.path) {
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
    submit(formData, {
      method: "post",
      action: path.to.newDocument,
      navigate: false,
    });
  };

  return (
    <File leftIcon={<LuUpload />} onChange={uploadFile}>
      Upload
    </File>
  );
};

export default DocumentCreateForm;
