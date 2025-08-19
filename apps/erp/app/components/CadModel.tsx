import { useCarbon } from "@carbon/auth";
import {
  CardHeader,
  CardTitle,
  ClientOnly,
  cn,
  ModelViewer,
  Spinner,
  toast,
} from "@carbon/react";
import { useMode } from "@carbon/remix";
import { convertKbToString, supportedModelTypes } from "@carbon/utils";
import { useFetcher } from "@remix-run/react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useUser } from "~/hooks";
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

  const onFileChange = async (file: File | null) => {
    const modelId = nanoid();

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
        <div className="flex w-full h-full rounded bg-gradient-to-bl from-card from-50% via-card to-background dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] items-center justify-center">
          <Spinner className="h-10 w-10" />
        </div>
      }
    >
      {() => {
        return file || modelPath ? (
          <ModelViewer
            key={modelPath}
            file={file}
            url={modelPath ? getPrivateUrl(modelPath) : null}
            mode={mode}
            className={viewerClassName}
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
  isReadOnly?: boolean;
  onFileChange: (file: File | null) => void;
};

const CadModelUpload = ({
  title,
  file,
  isReadOnly,
  className,
  onFileChange,
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

  if (isReadOnly) {
    return null;
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "group flex flex-col flex-grow rounded-lg border border-border bg-gradient-to-bl from-card from-50% via-card to-background dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] text-card-foreground shadow-sm w-full min-h-[400px] ",
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
                <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
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
