import { CardHeader, CardTitle, Spinner, cn, toast } from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { useDropzone } from "react-dropzone";
import { HiArrowUpTray } from "react-icons/hi2";

const fileSizeLimitMb = 50;

type CadModelUploadProps = {
  file: File | null;
  onFileChange: (file: File | null) => void;
};

const CadModelUpload = ({ file, onFileChange }: CadModelUploadProps) => {
  const hasFile = !!file;
  const { getRootProps, getInputProps } = useDropzone({
    disabled: hasFile,
    multiple: false,
    maxSize: fileSizeLimitMb * 1024 * 1024, // 50 MB
    onDropAccepted: (acceptedFiles) => {
      const file = acceptedFiles[0];
      const fileSizeLimit = fileSizeLimitMb * 1024 * 1024;

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (
        !fileExtension ||
        ![
          "step",
          "stp",
          "stl",
          "obj",
          "fbx",
          "amf",
          "iges",
          "ipt",
          "prt",
        ].includes(fileExtension)
      ) {
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
        "group flex flex-col flex-grow rounded-lg border border-border bg-gradient-to-bl from-card to-background text-card-foreground shadow-sm w-full",
        !hasFile &&
          "cursor-pointer hover:border-primary/30 hover:border-dashed hover:to-primary/10 hover:via-card"
      )}
    >
      <input {...getInputProps()} name="file" className="sr-only" />
      <div className="flex flex-col h-full w-full">
        <CardHeader>
          <CardTitle>CAD Model</CardTitle>
        </CardHeader>

        <div className="flex flex-col flex-grow items-center justify-center gap-2 p-2">
          {file ? (
            <>
              <Spinner className="h-16 w-16 -mt-16" />

              <p className="text-lg text-card-foreground mt-8">{file.name}</p>
              <p className="text-muted-foreground group-hover:text-foreground">
                {convertKbToString(Math.ceil(file.size / 1024))}
              </p>
            </>
          ) : (
            <>
              <div className="p-4 bg-accent rounded-full group-hover:bg-primary -mt-16">
                <HiArrowUpTray
                  className="h-10 w-10 text-foreground group-hover:text-primary-foreground"
                  aria-hidden="true"
                />
              </div>
              <p className="text-lg text-muted-foreground group-hover:text-foreground mt-8">
                Choose file to upload or drag and drop
              </p>
              <p className="text-xs text-muted-foreground group-hover:text-foreground">
                Supports *.stp, *.step, *.stl, *.obj, *.fbx, *.amf, *.iges,
                *.ipt, *.prt files
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CadModelUpload;
