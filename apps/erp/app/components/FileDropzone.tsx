import React from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";

interface FileDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onDrop }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div
      {...getRootProps()}
      className={`mt-4 border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 ${
        isDragActive ? "border-primary bg-primary/10" : "border-muted"
      }`}
    >
      <input {...getInputProps()} />
      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        Drag and drop some files here, or click to select files
      </p>
    </div>
  );
};

export default FileDropzone;
