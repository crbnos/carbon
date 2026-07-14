import { cn } from "@carbon/react";
import type React from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";

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
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    multiple,
    disabled
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-md p-6 text-center transition-colors",
        disabled
          ? "cursor-not-allowed border-border opacity-60"
          : "cursor-pointer hover:border-primary hover:bg-primary/10",
        !disabled && isDragActive
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
