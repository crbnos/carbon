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
  supportedModelTypes
} from "@carbon/utils";
import { ModelPreview } from "@carbon/viewer/model-preview";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";

const SIZE_LIMIT = getFileSizeLimit("CAD_MODEL_UPLOAD");

type ModelArtifacts = {
  optimizedModelPath: string | null;
  lodPath: string | null;
  glbPath: string | null;
  thumbnailPath: string | null;
  optimizeStatus:
    | "Idle"
    | "Queued"
    | "Processing"
    | "Success"
    | "Failed"
    | null;
  /** Raw source bytes (kept, never shrinks). */
  size: number | null;
  /** Optimised GLB bytes — surfaced next to `size` to show the reduction. */
  optimizedSize: number | null;
};

/**
 * modelUpload.id is the model's filename (`${company}/models/${id}.ext`), so the
 * id — and thus its artifact paths — is recoverable from `modelPath` alone.
 */
function modelIdFromPath(modelPath: string | null): string | null {
  if (!modelPath) return null;
  const base = modelPath.split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "") || null;
}

/**
 * Resolves a model's assembler artifact paths (optimised / LOD / assembly GLB /
 * thumbnail) via the `model.artifacts` API loader — keyed by the id derived from
 * `modelPath`, so no summary loader has to carry these columns. While optimise is
 * in flight it polls so the compact GLB swaps into the viewer without a reload;
 * it stops once an interactive artifact lands, optimise fails, or after a bounded
 * window (non-mesh uploads stay `Idle` and are only briefly checked).
 */
function useModelArtifacts(modelPath: string | null): {
  artifacts: ModelArtifacts | undefined;
  /** True while a server GLB might still arrive (fetch unresolved / optimise in
   *  flight). Gates the heavy WASM fallback so it never loads for nothing. */
  pending: boolean;
} {
  const fetcher = useFetcher<ModelArtifacts>();
  const load = fetcher.load;
  const dataRef = useRef<ModelArtifacts | undefined>(undefined);
  dataRef.current = fetcher.data;
  const [pending, setPending] = useState(true);

  const modelUploadId = modelIdFromPath(modelPath);

  useEffect(() => {
    if (!modelUploadId) {
      setPending(false);
      return;
    }
    setPending(true);
    const url = path.to.api.modelArtifacts(modelUploadId);
    load(url);

    let attempts = 0;
    const timer = setInterval(() => {
      const data = dataRef.current;
      const hasInteractive = Boolean(data?.optimizedModelPath || data?.glbPath);
      if (hasInteractive || data?.optimizeStatus === "Failed") {
        clearInterval(timer);
        setPending(false);
        return;
      }
      const inFlight =
        data?.optimizeStatus === "Queued" ||
        data?.optimizeStatus === "Processing";
      // `Idle`/undefined is the brief window before the job starts (or a non-mesh
      // upload that never optimises) — poll it only for a short grace period.
      const cap = inFlight ? 60 : 8; // ~3min in flight vs ~24s settling
      attempts += 1;
      if (attempts > cap) {
        clearInterval(timer);
        setPending(false);
        return;
      }
      load(url);
    }, 3000);

    return () => clearInterval(timer);
  }, [modelUploadId, load]);

  return { artifacts: fetcher.data, pending };
}

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

  const { artifacts, pending } = useModelArtifacts(modelPath);
  const hasServerArtifact = Boolean(
    artifacts?.optimizedModelPath || artifacts?.glbPath
  );
  // Only reach for the ~3 MB online-3d-viewer WASM tessellator when there's
  // genuinely no server model to show: a just-uploaded in-memory file, or an
  // existing model that has settled without a GLB (optimise failed / non-mesh).
  // Never while an artifact is still resolving — that pulls occt-import-js.wasm
  // for nothing when the optimised GLB is seconds away.
  const useWasmFallback = Boolean(file) || (!hasServerArtifact && !pending);

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
            <div className="relative h-full w-full">
              <ModelPreview
                key={modelPath}
                sourceFile={useWasmFallback ? file : null}
                sourceUrl={
                  useWasmFallback && modelPath ? getPrivateUrl(modelPath) : null
                }
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
                thumbnailUrl={
                  artifacts?.thumbnailPath
                    ? getPrivateUrl(artifacts.thumbnailPath)
                    : null
                }
                mode={mode}
                className={viewerClassName}
                onDelete={canDelete ? deleteModal.onOpen : undefined}
              />
              {artifacts?.size && artifacts?.optimizedSize ? (
                <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-border bg-popover px-2 py-1 font-mono text-xs text-muted-foreground shadow-sm tabular-nums">
                  {convertKbToString(Math.round(artifacts.size / 1024))}
                  {" → "}
                  <span className="text-emerald-500">
                    {convertKbToString(
                      Math.round(artifacts.optimizedSize / 1024)
                    )}
                  </span>{" "}
                  · {(artifacts.size / artifacts.optimizedSize).toFixed(1)}×
                  smaller
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
