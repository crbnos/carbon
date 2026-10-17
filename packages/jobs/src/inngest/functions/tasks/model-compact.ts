// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { modelPathOptimizeFormat } from "@carbon/files/cad";
import { MODEL_RAW_KEEP_MAX_BYTES } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  ASSEMBLER_CONCURRENCY,
  assemblerEnabled,
  copyRawToDurable,
  internalizeStorageUrl,
  resolveModelSourceBucket,
  runAssemblerJob,
  signSourceUrl
} from "./assembler-client";
import {
  getModelUpload,
  type ModelUploadRow,
  updateModelUpload
} from "./model-rows";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_COMPACT_WAIT_MS = 15 * 60 * 1000;

type Logger = {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
};

/**
 * Where a raw's compact form goes, and which form it is: a STEP becomes
 * BinXCAF (`.xbf.zst`), any other mesh is zstd'd as it is. Null when the raw
 * cannot be compacted (an unsupported format, or already `.zst`). The path is
 * flat, mirroring the raw, so the id stays recoverable (`modelIdFromPath`).
 */
export function compactTarget(
  companyId: string,
  model: Pick<ModelUploadRow, "id" | "modelPath">
): { mode: "xbf" | "zstd"; path: string } | null {
  const format = modelPathOptimizeFormat(model.modelPath);
  if (!format || model.modelPath.toLowerCase().endsWith(".zst")) return null;
  const mode = format === "step" ? "xbf" : "zstd";
  const ext = mode === "xbf" ? "xbf" : format;
  return { mode, path: `${companyId}/models/${model.id}.${ext}.zst` };
}

/** The optimised or converted GLB that makes pruning an oversized raw safe. */
function hasPreviewGlb(model: ModelUploadRow) {
  return (
    (model.optimizeStatus === "Success" && Boolean(model.optimizedModelPath)) ||
    Boolean(model.glbPath)
  );
}

/**
 * The raw as-is to durable storage, when compaction is not possible. Same
 * key, so `modelPath` is unchanged. The staged copy is left for the cleanup
 * sweep: deleting it here races jobs that resolved `temp-staging` already.
 */
export async function relocateRaw(model: ModelUploadRow, logger: Logger) {
  const rawSize = model.size;
  if (rawSize != null && rawSize <= MODEL_RAW_KEEP_MAX_BYTES) {
    const err = await copyRawToDurable(getCarbonServiceRole(), model.modelPath);
    if (err) throw new Error(`relocate raw to durable: ${err}`);
    logger.info("raw copied to durable", {
      modelUploadId: model.id,
      modelPath: model.modelPath
    });
    return "Relocated" as const;
  }
  // Too big for the company bucket — never prune: this object is the only
  // copy of the customer's file (raw original, or a mesh `.zst` that
  // decompresses to it), and downloads must always serve the original bytes.
  // It stays in staging, still referenced by `modelPath`, so the staged-raw
  // sweep won't touch it.
  logger.warn("oversized raw left in staging", {
    modelUploadId: model.id,
    modelPath: model.modelPath,
    rawSize,
    hasGlb: hasPreviewGlb(model)
  });
  return "KeptInStaging" as const;
}

/**
 * Keep a compacted raw that is in staging at `target.path`. xbf compaction is
 * a FORMAT CONVERSION (no CAD tool opens `.xbf`), so the original STEP is kept
 * alongside it; zstd compaction is pure compression (the `.zst` decompresses
 * byte-identical), so it REPLACES the original. NOTHING is deleted from
 * staging: an instant delete races concurrent jobs; the cleanup sweep prunes
 * stale staged copies instead. `size` stays the AS-UPLOADED bytes — it feeds
 * every "modelSize" view and the file lists.
 */
export async function settleCompactedRaw(
  model: ModelUploadRow,
  target: { mode: "xbf" | "zstd"; path: string },
  compactedSize: number | null,
  logger: Logger
) {
  const client = getCarbonServiceRole();
  const isXbf = target.mode === "xbf";
  // Freeze the as-uploaded bytes into originalSize once (rows from before the
  // column exist with null); the viewer's reduction badge compares the ORIGINAL.
  const originalSizeUpdate =
    model.originalSize == null && model.size != null
      ? { originalSize: model.size }
      : {};
  const fits =
    compactedSize != null && compactedSize <= MODEL_RAW_KEEP_MAX_BYTES;

  if (fits) {
    const err = await copyRawToDurable(client, target.path);
    if (err) throw new Error(`copy compacted raw to durable: ${err}`);
    if (isXbf) {
      // The original STEP: copied to the company bucket when it fits, else
      // staging only — referenced via `originalPath` either way, so the
      // staged-raw sweep won't prune the only copy.
      const rawSize = model.originalSize ?? model.size;
      if (rawSize != null && rawSize <= MODEL_RAW_KEEP_MAX_BYTES) {
        const kept = await copyRawToDurable(client, model.modelPath);
        if (kept) {
          logger.warn("original raw not copied to durable — staging only", {
            modelUploadId: model.id,
            originalPath: model.modelPath,
            error: kept
          });
        }
      }
    }
    await updateModelUpload(model.companyId, model.id, {
      modelPath: target.path,
      originalPath: isXbf ? model.modelPath : null,
      ...originalSizeUpdate
    });
    logger.info("raw compacted and copied to durable", {
      modelUploadId: model.id,
      compactPath: target.path,
      mode: target.mode
    });
    return "Success" as const;
  }

  if (hasPreviewGlb(model)) {
    // The compacted artifact still exceeds the durable cap, but the GLB
    // preview survives → drop the derived artifact (regenerable). It is left
    // unreferenced in staging for the sweep. The ORIGINAL stays in staging,
    // still referenced by `modelPath`.
    logger.info(
      "oversized compacted artifact left for the sweep (original kept)",
      { modelUploadId: model.id, compactPath: target.path }
    );
    return "KeptInStaging" as const;
  }

  // Too big for durable AND no GLB — keep the compacted `.zst` in staging
  // (best available for the viewer/plan) and repoint. xbf: the original also
  // stays in staging (tracked by `originalPath`); zstd: the fat original goes
  // unreferenced and the sweep prunes it (the `.zst` has the bytes).
  await updateModelUpload(model.companyId, model.id, {
    modelPath: target.path,
    originalPath: isXbf ? model.modelPath : null,
    ...originalSizeUpdate
  });
  logger.warn("oversized compacted raw with no GLB kept in staging", {
    modelUploadId: model.id,
    compactPath: target.path
  });
  return "KeptInStaging" as const;
}

/**
 * Persist a model's retained raw to durable storage when model-optimize did
 * not: the assembler is off, the optimise failed, or the row was optimised
 * before ingest compacted in the same job. Uploads stage in the ephemeral
 * `temp-staging` bucket; the retained raw (the source for the WASM fallback,
 * re-optimise, lazy assembly-plan, and download) must leave it or it is lost
 * when staging is cleared.
 *
 *  - The assembler is on and the raw is a compactable mesh: compact it
 *    (`compactTarget`), then keep it (`settleCompactedRaw`).
 *  - Otherwise: copy the raw as it is (`relocateRaw`).
 *
 * This function DELETES NOTHING from staging: an instant move/remove races any
 * concurrent optimize/convert/plan that resolved `temp-staging` as its source
 * bucket moments earlier ("Object not found" → Failed run, zombie viewer). The
 * scheduled cleanup sweep owns staging deletion: stale objects with a durable
 * copy, or referenced by no modelUpload, are pruned after the TTL.
 */
export const modelCompactFunction = inngest.createFunction(
  {
    id: "model-compact",
    retries: 3,
    concurrency: ASSEMBLER_CONCURRENCY,
    singleton: { key: "event.data.modelUploadId", mode: "skip" }
  },
  { event: "carbon/model-compact" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId } = event.data;

    const resolved = await step.run("resolve", async () => {
      const model = await getModelUpload(companyId, modelUploadId);
      if (!model?.modelPath) {
        throw new NonRetriableError(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }
      return {
        model,
        sourceBucket: await resolveModelSourceBucket(companyId, model.modelPath)
      };
    });
    const model = resolved.model as ModelUploadRow;

    // Already durable (in the company bucket) or gone — nothing to relocate.
    if (resolved.sourceBucket !== TEMP_STAGING_BUCKET) {
      logger.info("model compact skipped — raw not in staging", {
        modelUploadId,
        sourceBucket: resolved.sourceBucket
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    const target = assemblerEnabled() ? compactTarget(companyId, model) : null;
    if (!target) {
      const status = await step.run("relocate", () =>
        relocateRaw(model, logger)
      );
      return { modelUploadId, status };
    }

    const compact = await runAssemblerJob(step, {
      idPrefix: "compact",
      action: "compact",
      jobId: `compact-${modelUploadId}`,
      maxWaitMs: MAX_COMPACT_WAIT_MS,
      logger,
      buildBody: async () => {
        const signedUrl = await signSourceUrl(
          getCarbonServiceRole(),
          TEMP_STAGING_BUCKET,
          model.modelPath,
          SIGNED_URL_EXPIRY
        );
        return {
          source: { url: internalizeStorageUrl(signedUrl) },
          mode: target.mode,
          // Written to staging first; the persist step copies it to durable
          // storage once its size is known.
          output: { path: target.path }
        };
      },
      mintUploadUrls: async () => {
        const upload = await getCarbonServiceRole()
          .storage.from(TEMP_STAGING_BUCKET)
          .createSignedUploadUrl(target.path, { upsert: true });
        const urls: Record<string, string> = {};
        if (upload.data)
          urls.raw = internalizeStorageUrl(upload.data.signedUrl);
        return urls;
      }
    });
    const compactedSize =
      (compact.stats as { outputBytes?: number } | null)?.outputBytes ?? null;

    const status = await step.run("persist", () =>
      settleCompactedRaw(model, target, compactedSize, logger)
    );
    return { modelUploadId, status };
  }
);
