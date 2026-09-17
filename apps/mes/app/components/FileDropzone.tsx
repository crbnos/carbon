import { useCarbon } from "@carbon/auth";
import { isHeic, MediaUploader } from "@carbon/files/media";
import { cn, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useUser } from "~/hooks";

interface FileDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onDrop }) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [isConverting, setIsConverting] = useState(false);

  // HEIC is never stored — convert to JPEG before handing files to the caller.
  const onDropWithConversion = async (acceptedFiles: File[]) => {
    let files = acceptedFiles;
    if (carbon && files.some((file) => isHeic(file.name, file.type))) {
      const uploader = new MediaUploader(carbon, {
        bucket: "private",
        directory: `${company.id}/tmp`
      });
      setIsConverting(true);
      try {
        files = await uploader.prepareForUpload(files);
      } catch {
        toast.error(t`Failed to convert image`);
        return;
      } finally {
        setIsConverting(false);
      }
    }
    onDrop(files);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropWithConversion,
    maxFiles: 1,
    multiple: false,
    disabled: isConverting
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "mt-4 border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 w-full",
        isDragActive ? "border-primary bg-primary/10" : "border-muted",
        isConverting && "cursor-not-allowed opacity-60"
      )}
    >
      <input {...getInputProps()} />
      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        <Trans>Drag and drop a file here, or click to select a file</Trans>
      </p>
    </div>
  );
};

export default FileDropzone;
