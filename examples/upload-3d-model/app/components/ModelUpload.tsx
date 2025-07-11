import { cn, Spinner, toast } from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";

type ModelUploadProps = {
  url?: string;
  file: File | null;
  className?: string;
  onFileChange: (file: File | null) => void;
};

const fileSizeLimitMb = 50;
const supportedModelTypes = ["stp", "step"];

export const ModelUpload = ({
  url,
  file,
  onFileChange,
  className,
}: ModelUploadProps) => {
  const hasFile = !!file || !!url;

  const { isDragActive, getRootProps, getInputProps } = useDropzone({
    accept: {
      "application/step": [".stp", ".step"],
    },
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
        <div className="flex flex-col flex-grow items-center justify-center gap-2 p-6">
          {file && (
            <>
              <p className="text-base font-medium text-card-foreground">
                {file.name}
              </p>
              <p className="text-muted-foreground text-xs group-hover:text-foreground">
                {convertKbToString(Math.ceil(file.size / 1024))}
              </p>
              <Spinner className="size-12" />
            </>
          )}
          {!file && (
            <>
              <div
                className={cn(
                  "p-4 bg-accent rounded-full group-hover:bg-primary"
                )}
              >
                <LuCloudUpload className="mx-auto size-12 text-muted-foreground group-hover:text-primary-foreground" />
              </div>
              {isDragActive ? (
                <p className="text-lg text-muted-foreground group-hover:text-foreground mt-8">
                  Drop file here
                </p>
              ) : (
                <>
                  <p className="text-base font-medium text-muted-foreground group-hover:text-foreground mt-8">
                    Choose file to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground group-hover:text-foreground">
                    Supports {supportedModelTypes.join(", ")} files
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
