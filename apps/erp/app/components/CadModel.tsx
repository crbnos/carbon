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
import { ModelPreview, WASM_RAW_ENABLED } from "@carbon/viewer/model-preview";
import { nanoid } from "nanoid";
import { useEffect, useId, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload, LuZap } from "react-icons/lu";
import { useFetcher, useRevalidator } from "react-router";
import { useModelUpload, useUser } from "~/hooks";
import { getPrivateUrl, getRawModelUrl, path } from "~/utils/path";
import { ModelOptimizeProgress } from "./ModelOptimizeProgress";
import { ModelUploadProgress } from "./ModelUploadProgress";

const SIZE_LIMIT = getFileSizeLimit("CAD_MODEL_UPLOAD");

type ModelArtifacts = {
  optimizedModelPath: string | null;
  lodPath: string | null;
  glbPath: string | null;
  thumbnailPath: string | null;
  /** Raw upload (non-`.zst`) for the viewer's WASM fallback tier, with its
   *  resolved bucket (temp-staging for current uploads, private for old rows). */
  rawPath: string | null;
  rawBucket: string;
  optimizeStatus:
    | "Idle"
    | "Queued"
    | "Processing"
    | "Success"
    | "Failed"
    | null;
  /** As-uploaded raw bytes (originalSize; older rows fall back to the stored
   *  size) — the loader resolves this so the reduction badge never compares
   *  against the compacted `.zst`. */
  size: number | null;
  /** Optimized GLB bytes — surfaced next to `size` to show the reduction. */
  optimizedSize: number | null;
};

/**
 * modelUpload.id is the model's filename (`${company}/models/${id}.ext`), so the
 * id — and thus its artifact paths — is recoverable from `modelPath` alone.
 */
function modelIdFromPath(modelPath: string | null): string | null {
  if (!modelPath) return null;
  let base = modelPath.split("/").pop() ?? "";
  // Retained raws are compacted in place (`${id}.step` → `${id}.step.zst`); peel
  // the `.zst` wrapper before the source extension so the id resolves either way.
  if (base.toLowerCase().endsWith(".zst")) base = base.slice(0, -4);
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
   *  flight). */
  pending: boolean;
  /** Restart polling (after a re-optimise is fired) even if it had settled. */
  retry: () => void;
} {
  const uid = useId();
  const modelUploadId = modelIdFromPath(modelPath);
  // Scope the fetcher per model id: a delete or swap gives a DIFFERENT fetcher
  // whose `data` is undefined until its own load resolves — so a previous
  // model's artifacts can never leak into the new one's viewer (the old model
  // flashing before the spinner). The `none:<uid>` key keeps model-less
  // instances from colliding on a shared fetcher.
  const fetcher = useFetcher<ModelArtifacts>({
    key: `model-artifacts:${modelUploadId ?? `none:${uid}`}`
  });
  const load = fetcher.load;
  const dataRef = useRef<ModelArtifacts | undefined>(undefined);
  dataRef.current = fetcher.data;
  const [pending, setPending] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // `pending` must mean "a GLB is genuinely on its way", not "still checking":
  // the viewer renders it as an optimise-in-progress spinner, so a settled
  // model must not wear it for a grace window. Settle on the first response
  // unless the status is actually in flight; the background polling below
  // still catches a later transition (fresh upload flipping to Processing)
  // and re-raises pending then.
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    const inFlight =
      data.optimizeStatus === "Queued" || data.optimizeStatus === "Processing";
    setPending(inFlight && !(data.optimizedModelPath || data.glbPath));
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey re-runs the effect on retry without being read inside it
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
      // upload that never optimises) — keep polling quietly for a grace period
      // (pending is driven by the data effect above, not this loop).
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
  }, [modelUploadId, load, reloadKey]);

  return {
    artifacts: fetcher.data,
    pending,
    retry: () => setReloadKey((k) => k + 1)
  };
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
  const { upload, runUpload } = useModelUpload();

  const fetcher = useFetcher<{}>();
  const [file, setFile] = useState<File | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteModal = useDisclosure();

  const { artifacts, pending, retry } = useModelArtifacts(modelPath);
  const reoptimizeFetcher = useFetcher<{ success: boolean }>();
  // A server GLB may still be on its way while a fresh file uploads or the
  // optimise job runs. Raws <= MODEL_RAW_KEEP_MAX_BYTES render in-browser (WASM
  // tier) in the meantime; bigger ones show a staged optimise progress overlay
  // until the GLB lands, then "preview unavailable" if it never does.
  const awaitingModel = pending || Boolean(file);

  const hasInteractive = Boolean(
    artifacts?.optimizedModelPath || artifacts?.glbPath
  );
  const rawRenderable =
    WASM_RAW_ENABLED &&
    Boolean(
      (artifacts?.rawPath &&
        (artifacts.size ?? 0) <= MODEL_RAW_KEEP_MAX_BYTES) ||
        (file && file.size <= MODEL_RAW_KEEP_MAX_BYTES)
    );
  // Staged progress overlay: an optimise is running and nothing else can
  // render (no artifact yet, raw too big / absent). When the raw tier renders,
  // the optimise runs silently behind it and the GLB swaps in on success.
  const optimizeInFlight =
    artifacts?.optimizeStatus === "Queued" ||
    artifacts?.optimizeStatus === "Processing";
  // Bridges the click -> job-visible gap: the row status takes a couple of
  // polls to flip after Load Preview / Retry, and without this the overlay
  // wouldn't appear until then. Cleared on handover (or a 15s safety timeout
  // if the trigger silently failed).
  const [optimisticOptimize, setOptimisticOptimize] = useState(false);
  useEffect(() => {
    if (!optimisticOptimize) return;
    if (optimizeInFlight || hasInteractive) {
      setOptimisticOptimize(false);
      return;
    }
    const timeout = setTimeout(() => setOptimisticOptimize(false), 15000);
    return () => clearTimeout(timeout);
  }, [optimisticOptimize, optimizeInFlight, hasInteractive]);
  const showOptimizeProgress =
    (optimizeInFlight || optimisticOptimize) &&
    !hasInteractive &&
    !rawRenderable &&
    upload === null;

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

  // Re-fire the optimise for an existing model (raw still in temp-staging) and
  // restart artifact polling so the GLB swaps in without a reload.
  const onRetry = () => {
    const modelUploadId = modelIdFromPath(modelPath);
    if (isReadOnly || !modelUploadId) return;
    setOptimisticOptimize(true);
    reoptimizeFetcher.submit(
      { modelUploadId },
      { method: "post", action: path.to.api.modelReoptimize }
    );
    retry();
  };

  // Cancel the in-flight optimise when the user dismisses the preparing
  // spinner: stamps the row Failed and cancels the assembler job, so the
  // waiting Inngest run fails fast instead of leaving a stuck Processing row.
  const onCancelWait = () => {
    const modelUploadId = modelIdFromPath(modelPath);
    if (!modelUploadId) return;
    reoptimizeFetcher.submit(
      { modelUploadId },
      { method: "post", action: path.to.api.modelOptimizeCancel }
    );
  };

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
                onRetry={!isReadOnly && modelPath ? onRetry : undefined}
                retryLabel={
                  artifacts?.optimizeStatus === "Failed"
                    ? "Retry"
                    : "Load Preview"
                }
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
                  <ModelOptimizeProgress
                    key={`${modelPath}:${artifacts?.optimizeStatus}`}
                    modelUploadId={modelIdFromPath(modelPath) ?? ""}
                    queued={artifacts?.optimizeStatus !== "Processing"}
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
