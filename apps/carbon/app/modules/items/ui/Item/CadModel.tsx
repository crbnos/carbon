import { AutodeskViewer, ClientOnly, Spinner, toast } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
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
  metadata?: {
    itemId?: string;
    salesRfqLineId?: string;
    quoteLineId?: string;
  };
  title?: string;
  uploadClassName?: string;
  viewerClassName?: string;
};

const CadModel = ({
  autodeskUrn,
  metadata,
  modelPath,
  title,
  uploadClassName,
  viewerClassName,
}: CadModelProps) => {
  console.log({ modelPath });
  useRealtime("modelUpload", `modelPath=eq.${modelPath ?? "unknown"}`);

  const {
    company: { id: companyId },
  } = useUser();

  const { supabase } = useSupabase();

  const { autodeskToken } = useAutodeskToken();
  const fetcher = useFetcher<{}>();
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
      if (metadata) {
        if (metadata.itemId) {
          formData.append("itemId", metadata.itemId);
        }
        if (metadata.salesRfqLineId) {
          formData.append("salesRfqLineId", metadata.salesRfqLineId);
        }
        if (metadata.quoteLineId) {
          formData.append("quoteLineId", metadata.quoteLineId);
        }
      }

      fetcher.submit(formData, {
        method: "post",
        action: path.to.api.autodeskUpload,
      });
    }
  };

  return (
    <ClientOnly
      fallback={
        <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
          <Spinner className="h-10 w-10" />
        </div>
      }
    >
      {() => {
        return autodeskUrn && autodeskToken ? (
          <AutodeskViewer
            accessToken={autodeskToken}
            className={viewerClassName}
            showDefaultToolbar
            urn={autodeskUrn}
          />
        ) : (
          <CadModelUpload
            className={uploadClassName}
            file={file}
            loading={loading}
            title={title}
            onFileChange={onFileChange}
          />
        );
      }}
    </ClientOnly>
  );
};

export default CadModel;
