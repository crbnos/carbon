import { useCarbon } from "@carbon/auth";
import {
  Button,
  CardHeader,
  CardTitle,
  ClientOnly,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ModelViewer,
  Spinner,
  toast,
  useDisclosure,
  useMode
} from "@carbon/react";
import {
  convertKbToString,
  getFileSizeLimit,
  supportedModelTypes
} from "@carbon/utils";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";

const SIZE_LIMIT = getFileSizeLimit("CAD_MODEL_UPLOAD");

type CadModelProps = {
  modelPath: string | null;
  metadata?: {
    itemId?: string;
    salesRfqLineId?: string;
    purchasingRfqLineId?: string;
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
  viewerClassName
}: CadModelProps) => {
  const {
    company: { id: companyId }
  } = useUser();
  const mode = useMode();
  const { carbon } = useCarbon();
  const revalidator = useRevalidator();

  const fetcher = useFetcher<{}>();
  const [file, setFile] = useState<File | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteModal = useDisclosure();

  const onDelete = async () => {
    if (!carbon) {
      toast.error("Failed to initialize carbon client");
      return;
    }

    setIsDeleting(true);

    let result;
    if (metadata?.itemId) {
      result = await carbon
        .from("item")
        .update({ modelUploadId: null })
        .eq("id", metadata.itemId);
    } else if (metadata?.salesRfqLineId) {
      result = await carbon
        .from("salesRfqLine")
        .update({ modelUploadId: null })
        .eq("id", metadata.salesRfqLineId);
    } else if (metadata?.quoteLineId) {
      result = await carbon
        .from("quoteLine")
        .update({ modelUploadId: null })
        .eq("id", metadata.quoteLineId);
    } else if (metadata?.salesOrderLineId) {
      result = await carbon
        .from("salesOrderLine")
        .update({ modelUploadId: null })
        .eq("id", metadata.salesOrderLineId);
    } else if (metadata?.jobId) {
      result = await carbon
        .from("job")
        .update({ modelUploadId: null })
        .eq("id", metadata.jobId);
    }

    setIsDeleting(false);

    if (result?.error) {
      toast.error("Failed to delete model");
      return;
    }

    setFile(null);
    deleteModal.onClose();
    toast.success("Model deleted");
    revalidator.revalidate();
  };

  const canDelete =
    !isReadOnly &&
    !!(
      metadata?.itemId ||
      metadata?.salesRfqLineId ||
      metadata?.quoteLineId ||
      metadata?.salesOrderLineId ||
      metadata?.jobId
    );

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
          upsert: true
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
        action: path.to.api.modelUpload
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
          <>
            <ModelViewer
              key={modelPath}
              file={file}
              url={modelPath ? getPrivateUrl(modelPath) : null}
              mode={mode}
              className={viewerClassName}
              onDelete={canDelete ? deleteModal.onOpen : undefined}
            />
            {deleteModal.isOpen && (
              <Modal
                open
                onOpenChange={(open) => {
                  if (!open) deleteModal.onClose();
                }}
              >
                <ModalOverlay />
                <ModalContent>
                  <ModalHeader>
                    <ModalTitle>Delete 3D model</ModalTitle>
                  </ModalHeader>
                  <ModalBody>
                    <p className="text-sm text-muted-foreground">
                      Are you sure you want to delete this 3D file and image?
                      Continuing will remove both the preview image and the 3D
                      file from this record. This action cannot be undone.
                    </p>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      variant="secondary"
                      onClick={deleteModal.onClose}
                      isDisabled={isDeleting}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={onDelete}
                      isLoading={isDeleting}
                      isDisabled={isDeleting}
                    >
                      Delete
                    </Button>
                  </ModalFooter>
                </ModalContent>
              </Modal>
            )}
          </>
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
  onFileChange
}: CadModelUploadProps) => {
  const hasFile = !!file;

  const { getRootProps, getInputProps } = useDropzone({
    disabled: hasFile,
    multiple: false,
    maxSize: SIZE_LIMIT.bytes,
    onDropAccepted: (acceptedFiles) => {
      const file = acceptedFiles[0];

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedModelTypes.includes(fileExtension)) {
        toast.error("File type not supported");

        return;
      }

      if (file.size > SIZE_LIMIT.bytes) {
        toast.error(`File size too big (max. ${SIZE_LIMIT.format()})`);
        return;
      }

      onFileChange(file);
    },
    onDropRejected: (fileRejections) => {
      const { errors } = fileRejections[0];
      let message;
      if (errors[0].code === "file-too-large") {
        message = `File size too big (max. ${SIZE_LIMIT.format()})`;
      } else if (errors[0].code === "file-invalid-type") {
        message = "File type not supported";
      } else {
        message = errors[0].message;
      }
      toast.error(message);
    }
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
              <p className="text-base text-muted-foreground group-hover:text-foreground mt-8">
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
