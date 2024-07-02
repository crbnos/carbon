import { AutodeskViewer, ClientOnly, toast } from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useUser } from "~/hooks";
import { useAutodeskToken } from "~/lib/autodesk";
import { useSupabase } from "~/lib/supabase";
import { CadModelUpload } from "~/modules/shared";
import { path } from "~/utils/path";

type CadModelProps = {
  autodeskUrn: string | null;
};

const CadModel = ({ autodeskUrn }: CadModelProps) => {
  const {
    company: { id: companyId },
  } = useUser();
  const { supabase } = useSupabase();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const { autodeskToken } = useAutodeskToken();
  const fetcher = useFetcher<{ urn: string }>();
  const [urn, setUrn] = useState<string | null>(autodeskUrn ?? null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (autodeskUrn !== urn) setUrn(autodeskUrn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autodeskUrn]);

  useEffect(() => {
    if (fetcher.data?.urn) {
      setUrn(fetcher.data.urn);
    }
  }, [fetcher.data]);

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
        return urn && autodeskToken ? (
          <AutodeskViewer
            accessToken={autodeskToken}
            urn={urn}
            showDefaultToolbar
          />
        ) : (
          <CadModelUpload file={file} onFileChange={onFileChange} />
        );
      }}
    </ClientOnly>
  );
};

export default CadModel;
