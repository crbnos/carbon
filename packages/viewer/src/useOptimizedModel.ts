import {
  MODEL_RAW_KEEP_MAX_BYTES,
  modelPathOptimizeFormat
} from "@carbon/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { WASM_RAW_ENABLED } from "./ModelPreview";

export type ModelArtifacts = {
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
  /** As-uploaded raw bytes (originalSize; older rows fall back to size). */
  size: number | null;
  optimizedSize: number | null;
};

/**
 * modelUpload.id is the model's filename (`${company}/models/${id}.ext`), so the
 * id — and thus its artifact paths — is recoverable from `modelPath` alone.
 * Retained raws are compacted in place (`${id}.step` → `${id}.step.zst`); the
 * `.zst` wrapper is peeled before the source extension.
 */
export function modelIdFromPath(modelPath: string | null): string | null {
  if (!modelPath) return null;
  let base = modelPath.split("/").pop() ?? "";
  if (base.toLowerCase().endsWith(".zst")) base = base.slice(0, -4);
  return base.replace(/\.[^.]+$/, "") || null;
}

const POLL_MS = 3000;
// `Idle`/null is the brief window before a just-triggered job starts (or a
// non-mesh upload that never optimises) — poll it only for a short grace
// window before settling.
const GRACE_POLLS = 8;

// Same routes in ERP and MES — overridable if a host ever diverges.
const DEFAULT_PATHS = {
  artifacts: (modelUploadId: string) => `/api/model/artifacts/${modelUploadId}`,
  reoptimize: "/api/model/reoptimize",
  cancel: "/api/model/optimize-cancel"
};

async function postModelAction(action: string, modelUploadId: string) {
  const body = new FormData();
  body.append("modelUploadId", modelUploadId);
  await fetch(action, { method: "POST", body }).catch(() => {
    // Best-effort — polling reflects whatever actually happened server-side.
  });
}

/**
 * The full optimise lifecycle for a model preview, shared by ERP CadModel and
 * the MES model tab so behavior is identical (hosts differ only in chrome —
 * upload/delete exist in ERP only):
 *
 * - TanStack Query polls the artifacts route while an optimise is genuinely in
 *   flight (and through a short grace window otherwise); results are cached and
 *   deduped across viewers of the same model.
 * - Viewing IS the intent: a model with no artifact and no optimise in flight
 *   auto-fires the optimise on mount. A Failed status never auto-refires (that
 *   would loop a deterministic failure and override an explicit cancel) — the
 *   settled card's Retry covers it.
 * - retry() re-fires the optimise and resumes polling via invalidation.
 * - cancel() stamps the row Failed and cancels the assembler job.
 */
export function useOptimizedModel({
  modelPath,
  companyId,
  /** A just-dropped local File (ERP upload flow) — counts toward the raw tier. */
  file = null,
  /** Disables the auto-fire (and retry/cancel posts) — e.g. no session. */
  enabled = true,
  paths = DEFAULT_PATHS
}: {
  modelPath: string | null;
  companyId: string;
  file?: File | null;
  enabled?: boolean;
  paths?: typeof DEFAULT_PATHS;
}) {
  const queryClient = useQueryClient();
  const modelUploadId = modelIdFromPath(modelPath);
  const gracePolls = useRef(0);

  const query = useQuery<ModelArtifacts>({
    queryKey: ["model-artifacts", companyId, modelUploadId],
    enabled: Boolean(modelUploadId),
    queryFn: async () => {
      const res = await fetch(paths.artifacts(modelUploadId as string));
      if (!res.ok) throw new Error(`artifacts ${res.status}`);
      return res.json();
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return POLL_MS;
      if (d.optimizedModelPath || d.glbPath) return false;
      const inFlight =
        d.optimizeStatus === "Queued" || d.optimizeStatus === "Processing";
      if (inFlight) {
        gracePolls.current = 0;
        return POLL_MS;
      }
      // Terminal/idle: keep a short grace window so a just-fired trigger (row
      // not yet flipped, possibly still showing a STALE Failed from the last
      // attempt) is picked up instead of polling stopping dead — the
      // "click Load Preview twice" bug in the hand-rolled version.
      if (gracePolls.current < GRACE_POLLS) {
        gracePolls.current += 1;
        return POLL_MS;
      }
      return false;
    }
  });

  const artifacts = query.data;
  const hasInteractive = Boolean(
    artifacts?.optimizedModelPath || artifacts?.glbPath
  );
  const optimizeInFlight =
    artifacts?.optimizeStatus === "Queued" ||
    artifacts?.optimizeStatus === "Processing";
  const rawRenderable =
    WASM_RAW_ENABLED &&
    Boolean(
      (artifacts?.rawPath &&
        (artifacts.size ?? 0) <= MODEL_RAW_KEEP_MAX_BYTES) ||
        (file && file.size <= MODEL_RAW_KEEP_MAX_BYTES)
    );

  // Bridges the fire -> job-visible gap: the row status takes a couple of
  // polls to flip, and without this the progress overlay wouldn't appear
  // until then. Cleared on handover (or a 15s safety timeout).
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

  const [actionBusy, setActionBusy] = useState(false);

  const fireOptimize = useCallback(
    async (id: string) => {
      gracePolls.current = 0;
      setOptimisticOptimize(true);
      setActionBusy(true);
      await postModelAction(paths.reoptimize, id);
      setActionBusy(false);
      await queryClient.invalidateQueries({
        queryKey: ["model-artifacts", companyId, id]
      });
    },
    [companyId, paths.reoptimize, queryClient]
  );

  // Auto-fire: fires once per model per mount, on the first artifacts response
  // showing nothing to render and nothing in flight.
  const autoFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !artifacts || !modelUploadId || !modelPath) return;
    if (autoFiredRef.current === modelUploadId) return;
    if (
      hasInteractive ||
      optimizeInFlight ||
      artifacts.optimizeStatus === "Failed"
    )
      return;
    if (!modelPathOptimizeFormat(modelPath)) return;
    autoFiredRef.current = modelUploadId;
    void fireOptimize(modelUploadId);
  }, [
    enabled,
    artifacts,
    modelUploadId,
    modelPath,
    hasInteractive,
    optimizeInFlight,
    fireOptimize
  ]);

  const retry = useCallback(() => {
    if (!enabled || !modelUploadId) return;
    void fireOptimize(modelUploadId);
  }, [enabled, modelUploadId, fireOptimize]);

  const cancel = useCallback(async () => {
    if (!enabled || !modelUploadId) return;
    setActionBusy(true);
    await postModelAction(paths.cancel, modelUploadId);
    setActionBusy(false);
    await queryClient.invalidateQueries({
      queryKey: ["model-artifacts", companyId, modelUploadId]
    });
  }, [enabled, modelUploadId, companyId, paths.cancel, queryClient]);

  // "A GLB is genuinely on its way" — the viewer renders this as the
  // preparing state; a settled model must not wear it.
  const awaitingModel =
    (query.isLoading && Boolean(modelUploadId)) ||
    (optimizeInFlight && !hasInteractive) ||
    Boolean(file);

  // Staged progress overlay: an optimise is running and nothing else can
  // render. When the raw tier renders, the optimise runs silently behind it
  // and the GLB swaps in on success.
  const showOptimizeProgress =
    (optimizeInFlight || optimisticOptimize) &&
    !hasInteractive &&
    !rawRenderable;

  return {
    artifacts,
    modelUploadId,
    awaitingModel,
    hasInteractive,
    rawRenderable,
    optimizeInFlight,
    showOptimizeProgress,
    /** Overlay's first step reads as waiting until the job is picked up. */
    optimizeQueued: artifacts?.optimizeStatus !== "Processing",
    retry,
    retryLabel:
      artifacts?.optimizeStatus === "Failed" ? "Retry" : "Load Preview",
    cancel,
    actionBusy
  };
}
