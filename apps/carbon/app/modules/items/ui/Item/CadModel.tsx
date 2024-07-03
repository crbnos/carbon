import { AutodeskViewer, ClientOnly, toast } from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useRealtime, useUser } from "~/hooks";
import { useAutodeskToken } from "~/lib/autodesk";
import { useSupabase } from "~/lib/supabase";
import { CadModelUpload } from "~/modules/shared";
import { path } from "~/utils/path";

type CadModelProps = {
  autodeskUrn: string | null;
  modelPath: string | null;
};

const CadModel = ({ autodeskUrn, modelPath }: CadModelProps) => {
  useRealtime("modelUpload", `modelPath=eq.${modelPath ?? "unknown"}`);

  const {
    company: { id: companyId },
  } = useUser();

  const { supabase } = useSupabase();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const { autodeskToken } = useAutodeskToken();
  const fetcher = useFetcher();
  const [file, setFile] = useState<File | null>(null);
  const loading = (!!file && !autodeskUrn) || (!!modelPath && !autodeskUrn);

  useEffect(() => {
    if (!loading) setFile(null);
  }, [loading]);

  const onFileChange = async (file: File | null) => {
    setFile(file);
    if (file) {
      if (!supabase) throw new Error("Failed to initialize supabase client");
      const fileId = nanoid();
      const fileExtension = file.name.split(".").pop();
      const fileName = `${companyId}/models/${fileId}.${fileExtension}`;

      const modelUpload = await supabase.storage
        .from("private")
        .upload(fileName, file, {
          upsert: true,
        });

      if (modelUpload.error) {
        toast.error("Failed to upload file to storage");
      }

      const formData = new FormData();
      formData.append("name", file.name);
      formData.append("fileId", fileId);
      formData.append("modelPath", modelUpload.data!.path);
      formData.append("itemId", itemId);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.api.autodeskUpload,
      });
    }
  };
  return (
    <ClientOnly
      fallback={
        <div className="w-full h-full rounded bg-gradient-to-tr from-[#979797] to-[#BEBEBE]" />
      }
    >
      {() => {
        return autodeskUrn && autodeskToken ? (
          <AutodeskViewer
            accessToken={autodeskToken}
            urn={autodeskUrn}
            showDefaultToolbar
          />
        ) : (
          <CadModelUpload
            file={file}
            loading={loading}
            onFileChange={onFileChange}
          />
        );
      }}
    </ClientOnly>
  );
};

export default CadModel;
