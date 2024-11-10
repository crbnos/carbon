import { useCarbon } from "@carbon/auth";
import {
  CardHeader,
  CardTitle,
  ClientOnly,
  cn,
  ModelViewer,
  Spinner,
  supportedModelTypes,
  toast,
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useDropzone } from "react-dropzone";
import { LuUploadCloud } from "react-icons/lu";
import { useUser } from "~/hooks";
import { useMode } from "~/hooks/useMode";
import { getPrivateUrl, path } from "~/utils/path";

const fileSizeLimitMb = 50;

type CadModelProps = {
  modelPath: string | null;
  metadata?: {
    itemId?: string;
    salesRfqLineId?: string;
    quoteLineId?: string;
    salesOrderLineId?: string;
    jobId?: string;
  };
  title?: string;
  uploadClassName?: string;
  viewerClassName?: string;
  isReadOnly?: boolean;
};

const CadModel = ({
  isReadOnly,
  metadata,
  modelPath,
  title,
  uploadClassName,
  viewerClassName,
}: CadModelProps) => {
  const {
    company: { id: companyId },
  } = useUser();
  const mode = useMode();
  const { carbon } = useCarbon();

  const fetcher = useFetcher<{}>();
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const uploadThumbnail = async () => {
    if (!dataUrl) return;
    if (!id) return;
    if (!carbon) return;

    const base64Data = dataUrl.split(",")[1];
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    const thumbnailFile = new File([byteArray], "thumbnail.png", {
      type: "image/png",
    });

    if (!carbon) {
      toast.error("Failed to initialize carbon client");
      return;
    }

    const thumbnailId = nanoid();
    const thumbnailPath = `${companyId}/thumbnails/${thumbnailId}.png`;

    const thumbnailUpload = await carbon.storage
      .from("private")
      .upload(thumbnailPath, thumbnailFile, {
        upsert: true,
        contentType: "image/png",
      });

    if (thumbnailUpload.error) {
      toast.error("Failed to upload thumbnail");
    }

    const update = await carbon
      .from("modelUpload")
      .update({
        thumbnailPath: thumbnailUpload.data!.path,
      })
      .eq("id", id);

    if (update.error) {
      toast.error("Failed to update model upload");
    }
  };

  // we want to upload the thumbnail after the file is uploaded
  useEffect(() => {
    if (file && modelPath && dataUrl && id) {
      uploadThumbnail();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl, file, id, modelPath]);

  const onDataUrl = (dataUrl: string) => {
    setDataUrl(dataUrl);
  };

  const onFileChange = async (file: File | null) => {
    const modelId = nanoid();
    flushSync(() => {
      setId(modelId);
    });

    setFile(file);

    if (file) {
      if (!carbon) {
        toast.error("Failed to initialize carbon client");
        return;
      } else {
        toast.info(`Uploading ${file.name}`);
      }
      const fileExtension = file.name.split(".").pop();
      const fileName = `${companyId}/models/${modelId}.${fileExtension}`;

      const modelUpload = await carbon.storage
        .from("private")
        .upload(fileName, file, {
          upsert: true,
        });

      if (modelUpload.error) {
        toast.error("Failed to upload file to storage");
      }

      const formData = new FormData();
      formData.append("name", file.name);
      formData.append("modelId", modelId);
      formData.append("modelPath", modelUpload.data!.path);
      formData.append("size", file.size.toString());
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
        if (metadata.salesOrderLineId) {
          formData.append("salesOrderLineId", metadata.salesOrderLineId);
        }
        if (metadata.jobId) {
          formData.append("jobId", metadata.jobId);
        }
      }

      fetcher.submit(formData, {
        method: "post",
        action: path.to.api.modelUpload,
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
        return file || modelPath ? (
          <ModelViewer
            file={file}
            url={modelPath ? getPrivateUrl(modelPath) : null}
            mode={mode}
            onDataUrl={onDataUrl}
          />
        ) : (
          <CadModelUpload
            className={uploadClassName}
            file={file}
            title={title}
            onFileChange={onFileChange}
          />
        );
      }}
    </ClientOnly>
  );
};

export default CadModel;

type CadModelUploadProps = {
  title?: string;
  file: File | null;
  className?: string;
  onFileChange: (file: File | null) => void;
};

const CadModelUpload = ({
  title,
  file,
  onFileChange,
  className,
}: CadModelUploadProps) => {
  const hasFile = !!file;

  const { getRootProps, getInputProps } = useDropzone({
    disabled: hasFile,
    multiple: false,
    maxSize: fileSizeLimitMb * 1024 * 1024, // 50 MB
    onDropAccepted: (acceptedFiles) => {
      const file = acceptedFiles[0];
      const fileSizeLimit = fileSizeLimitMb * 1024 * 1024;

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedModelTypes.includes(fileExtension)) {
        toast.error("File type not supported");

        return;
      }

      if (file.size > fileSizeLimit) {
        toast.error(`File size too big (max. ${fileSizeLimitMb} MB)`);
        return;
      }

      onFileChange(file);
    },
    onDropRejected: (fileRejections) => {
      const { errors } = fileRejections[0];
      let message;
      if (errors[0].code === "file-too-large") {
        message = `File size too big (max. ${fileSizeLimitMb} MB)`;
      } else if (errors[0].code === "file-invalid-type") {
        message = "File type not supported";
      } else {
        message = errors[0].message;
      }
      toast.error(message);
    },
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "group flex flex-col flex-grow rounded-lg border border-border bg-gradient-to-tr from-background to-card text-card-foreground shadow-sm w-full",
        !hasFile &&
          "cursor-pointer hover:border-primary/30 hover:border-dashed hover:to-primary/10 hover:via-card border-2 border-dashed",
        className
      )}
    >
      <input {...getInputProps()} name="file" className="sr-only" />
      <div className="flex flex-col h-full w-full p-4">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>

        <div className="flex flex-col flex-grow items-center justify-center gap-2 p-6">
          {file && <Spinner className={cn("h-16 w-16", title && "-mt-16")} />}
          {file && (
            <>
              <p className="text-lg text-card-foreground mt-8">{file.name}</p>
              <p className="text-muted-foreground group-hover:text-foreground">
                {convertKbToString(Math.ceil(file.size / 1024))}
              </p>
            </>
          )}
          {!file && (
            <>
              <div
                className={cn(
                  "p-4 bg-accent rounded-full group-hover:bg-primary",
                  title ? "-mt-16" : "-mt-6"
                )}
              >
                <LuUploadCloud className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
              </div>
              <p className="text-lg text-muted-foreground group-hover:text-foreground mt-8">
                Choose file to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground group-hover:text-foreground">
                Supports {supportedModelTypes.join(", ")} files
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
