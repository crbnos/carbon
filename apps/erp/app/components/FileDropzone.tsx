import { useCarbon } from "@carbon/auth";
import { getCompanyPrivateBucket } from "@carbon/files";
import {
  DuplicateFileNameError,
  isHeic,
  MediaUploader
} from "@carbon/files/media";
import { cn, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useUser } from "~/hooks";

interface FileDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
  accept?: Record<string, string[]>;
  multiple?: boolean;
  /** Disable dropping/clicking (e.g. while a file is being processed). */
  disabled?: boolean;
  /** Override the wrapper classes (e.g. drop the default top margin). */
  className?: string;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({
  onDrop,
  accept,
  multiple = true,
  disabled = false,
  className = "mt-4"
}) => {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [isConverting, setIsConverting] = useState(false);

  // HEIC is never stored — convert to JPEG before handing files to the caller.
  const onDropWithConversion = async (acceptedFiles: File[]) => {
    let files = acceptedFiles;
    if (carbon && files.some((file) => isHeic(file.name, file.type))) {
      const uploader = new MediaUploader(carbon, {
        bucket: getCompanyPrivateBucket(company.id),
        directory: `${company.id}/tmp`
      });
      setIsConverting(true);
      try {
        files = await uploader.prepareForUpload(files);
      } catch (error) {
        toast.error(
          error instanceof DuplicateFileNameError
            ? t`Duplicate file names after image conversion`
            : t`Failed to convert image`
        );
        return;
      } finally {
        setIsConverting(false);
      }
    }
    onDrop(files);
  };

  const isDisabled = disabled || isConverting;
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropWithConversion,
    accept,
    multiple,
    disabled: isDisabled
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-md p-6 text-center transition-colors",
        isDisabled
          ? "cursor-not-allowed border-border opacity-60"
          : "cursor-pointer hover:border-primary hover:bg-primary/10",
        !isDisabled && isDragActive
          ? "border-primary bg-primary/10"
          : "border-border",
        className
      )}
    >
      <input {...getInputProps()} />
      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        {multiple
          ? "Drag and drop some files here, or click to select files"
          : "Drag and drop a file here, or click to select a file"}
      </p>
    </div>
  );
};

export default FileDropzone;
