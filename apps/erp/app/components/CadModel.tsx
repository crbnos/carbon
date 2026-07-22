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
  Spinner,
  toast,
  useDisclosure,
  useMode
} from "@carbon/react";
import {
  convertKbToString,
  getFileSizeLimit,
  MODEL_RAW_KEEP_MAX_BYTES,
  supportedModelTypes
} from "@carbon/utils";
import { ModelPreview } from "@carbon/viewer/model-preview";
import { OptimizeProgress } from "@carbon/viewer/optimize-progress";
import { useOptimizedModel } from "@carbon/viewer/use-optimized-model";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload, LuZap } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { useModelUpload, useUser } from "~/hooks";
import { getPrivateUrl, getRawModelUrl, path } from "~/utils/path";
import { ModelUploadProgress } from "./ModelUploadProgress";

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
  const { upload, runUpload } = useModelUpload();

  const fetcher = useFetcher<{}>();
  const [file, setFile] = useState<File | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteModal = useDisclosure();

  const {
    artifacts,
    awaitingModel,
    showOptimizeProgress: optimizeProgressActive,
    optimizeQueued,
    retry: onRetry,
    retryLabel,
    cancel: onCancelWait,
    actionBusy
  } = useOptimizedModel({ modelPath, companyId, file });
  // Never on top of the upload progress overlay.
  const showOptimizeProgress = optimizeProgressActive && upload === null;

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
      }
      const fileExtension = file.name.split(".").pop();
      const fileName = `${companyId}/models/${modelId}.${fileExtension}`;

      // Raw CAD lands in `temp-staging` (2.5 GB cap) via a resumable (TUS) upload
      // — a standard buffered upload times out on multi-GB files. The
      // optimise/assembly jobs read it from there and write the gated artifacts
      // (<=50 MB) to `private`.
      const toastId = toast.loading(`Uploading ${file.name}…`);
      const { error: uploadError } = await runUpload({
        bucket: "temp-staging",
        path: fileName,
        file
      });
      if (uploadError) {
        toast.error("Failed to upload file to storage", { id: toastId });
        setFile(null);
        return;
      }
      toast.success(`Uploaded ${file.name}`, { id: toastId });

      const formData = new FormData();
      formData.append("name", file.name);
      formData.append("modelId", modelId);
      formData.append("modelPath", fileName);
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
            <div className="relative h-full w-full">
              <ModelPreview
                key={modelPath}
                awaitingModel={awaitingModel}
                optimizedUrl={
                  artifacts?.optimizedModelPath
                    ? getPrivateUrl(artifacts.optimizedModelPath)
                    : null
                }
                glbUrl={
                  artifacts?.glbPath ? getPrivateUrl(artifacts.glbPath) : null
                }
                lodUrl={
                  artifacts?.lodPath ? getPrivateUrl(artifacts.lodPath) : null
                }
                rawUrl={
                  artifacts?.rawPath &&
                  (artifacts.size ?? 0) <= MODEL_RAW_KEEP_MAX_BYTES
                    ? getRawModelUrl(artifacts.rawBucket, artifacts.rawPath)
                    : null
                }
                rawFile={
                  file && file.size <= MODEL_RAW_KEEP_MAX_BYTES ? file : null
                }
                thumbnailUrl={
                  artifacts?.thumbnailPath
                    ? getPrivateUrl(artifacts.thumbnailPath)
                    : null
                }
                mode={mode}
                className={viewerClassName}
                onRetry={modelPath ? onRetry : undefined}
                retryLabel={retryLabel}
                onCancelWait={modelPath ? onCancelWait : undefined}
                onDelete={canDelete ? deleteModal.onOpen : undefined}
              />
              {upload !== null && (
                <div className="absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-background/95 p-6">
                  <ModelUploadProgress
                    percent={upload.percent}
                    uploaded={upload.uploaded}
                    total={upload.total}
                    className="max-w-sm"
                  />
                </div>
              )}
              {showOptimizeProgress && modelPath && (
                <div className="absolute inset-0 z-30 flex items-center justify-center rounded-lg bg-background/95 p-6">
                  <OptimizeProgress
                    key={`${modelPath}:${artifacts?.optimizeStatus}`}
                    queued={optimizeQueued}
                    onCancel={onCancelWait}
                    cancelling={actionBusy}
                  />
                </div>
              )}
              {artifacts?.size && artifacts?.optimizedSize ? (
                <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-sm">
                  <LuZap className="size-3 shrink-0 text-emerald-500" />
                  <span>Optimized GLB</span>
                  <span className="font-mono tabular-nums">
                    {convertKbToString(Math.round(artifacts.size / 1024))}
                    {" → "}
                    <span className="text-emerald-500">
                      {convertKbToString(
                        Math.round(artifacts.optimizedSize / 1024)
                      )}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
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
        "group flex h-full flex-col flex-grow rounded-lg border border-border bg-gradient-to-bl from-card from-50% via-card to-background dark:border-none dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] text-card-foreground shadow-sm w-full min-h-[400px] ",
        !hasFile &&
          "cursor-pointer hover:border-primary/30 hover:border-dashed hover:to-primary/10 hover:via-card border-2 border-dashed",
        className
      )}
    >
      <input {...getInputProps()} name="file" className="sr-only" />
      <div className="relative flex flex-col flex-1 min-h-0 w-full p-4">
        {title && (
          <CardHeader className="absolute top-0 left-0 z-10">
            <CardTitle>{title}</CardTitle>
          </CardHeader>
        )}

        <div className="flex flex-col flex-grow items-center justify-center gap-2 p-6">
          {file && <Spinner className="h-16 w-16" />}
          {file && (
            <>
              <p className="text-lg text-card-foreground">{file.name}</p>
              <p className="text-muted-foreground group-hover:text-foreground">
                {convertKbToString(Math.ceil(file.size / 1024))}
              </p>
            </>
          )}
          {!file && (
            <>
              <div className="p-4 bg-accent rounded-full group-hover:bg-primary">
                <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
              </div>
              <p className="text-base text-muted-foreground group-hover:text-foreground">
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
