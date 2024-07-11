import { CardHeader, CardTitle, Spinner, cn, toast } from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useDropzone } from "react-dropzone";
import { HiArrowUpTray } from "react-icons/hi2";

const fileSizeLimitMb = 50;

type CadModelUploadProps = {
  title?: string;
  file: File | null;
  loading: boolean;
  className?: string;
  onFileChange: (file: File | null) => void;
};

const supportedFileTypes = [
  "step",
  "stp",
  "stl",
  "obj",
  "fbx",
  "amf",
  "iges",
  "ipt",
  "prt",
  "sldprt",
  "sldasm",
  "asm",
  "iam",
  "3dm",
  "3ds",
];

const CadModelUpload = ({
  title,
  file,
  loading,
  onFileChange,
  className,
}: CadModelUploadProps) => {
  const hasFile = !!file;

  const { getRootProps, getInputProps } = useDropzone({
    disabled: loading || hasFile,
    multiple: false,
    maxSize: fileSizeLimitMb * 1024 * 1024, // 50 MB
    onDropAccepted: (acceptedFiles) => {
      const file = acceptedFiles[0];
      const fileSizeLimit = fileSizeLimitMb * 1024 * 1024;

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedFileTypes.includes(fileExtension)) {
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
          "cursor-pointer hover:border-primary/30 hover:border-dashed hover:to-primary/10 hover:via-card",
        className
      )}
    >
      <input {...getInputProps()} name="file" className="sr-only" />
      <div className="flex flex-col h-full w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>

        <div className="flex flex-col flex-grow items-center justify-center gap-2 p-6">
          {(file || loading) && (
            <Spinner className={cn("h-16 w-16", title && "-mt-16")} />
          )}
          {file && (
            <>
              <p className="text-lg text-card-foreground mt-8">{file.name}</p>
              <p className="text-muted-foreground group-hover:text-foreground">
                {convertKbToString(Math.ceil(file.size / 1024))}
              </p>
            </>
          )}
          {!file && !loading && (
            <>
              <div
                className={cn(
                  "p-4 bg-accent rounded-full group-hover:bg-primary",
                  title ? "-mt-16" : "-mt-6"
                )}
              >
                <HiArrowUpTray
                  className="h-10 w-10 text-foreground group-hover:text-primary-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-lg text-muted-foreground group-hover:text-foreground mt-8">
                Choose file to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground group-hover:text-foreground">
                Supports {supportedFileTypes.join(", ")} files
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CadModelUpload;
