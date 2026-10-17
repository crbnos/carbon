// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { storage, TEMP_STAGING_BUCKET } from "@carbon/files";
import { modelPathOptimizeFormat } from "@carbon/files/cad";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  ASSEMBLER_CONCURRENCY,
  assemblerEnabled,
  internalizeStorageUrl,
  requireModelSourceBucket,
  runAssemblerJob,
  signSourceUrl
} from "./assembler-client";
import {
  compactTarget,
  relocateRaw,
  settleCompactedRaw
} from "./model-compact";
import {
  getModelUpload,
  type ModelUploadRow,
  updateModelUpload
} from "./model-rows";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_OPTIMIZE_WAIT_MS = 15 * 60 * 1000;

type IngestOutputs = {
  glb?: { bytes?: number };
  raw?: { bytes?: number };
  thumbnail?: { bytes?: number };
};

/**
 * Model ingest on upload: one assembler job reads the raw once and writes the
 * optimised GLB (`optimizedModelPath`, the preview), the raw's compact form
 * (STEP → BinXCAF `.xbf.zst`, mesh → `.zst`), and the preview thumbnail. Before
 * this they were three jobs, each downloading and parsing the raw again.
 * Separate from assembly-convert, which produces the lossless GLB and graph
 * the assembly viewer needs, and only on demand.
 *
 * Compaction is asked for only while the raw is still in `temp-staging`; a
 * raw already in the company bucket (or already `.zst`) is final. A failed
 * compaction copies the raw as it is instead, so the raw always leaves staging.
 */
export const modelOptimizeFunction = inngest.createFunction(
  {
    id: "model-optimize",
    retries: 2,
    concurrency: ASSEMBLER_CONCURRENCY,
    // Collapse the viewer's per-view auto-fire: while one optimise for a model is
    // in flight, duplicate triggers (repeated views, drag re-attach) are skipped
    // rather than spawning redundant runs. A later Retry after it settles still
    // runs (nothing in flight). The `alreadyOptimized` guard covers re-fires on an
    // already-optimised model; this covers the in-flight duplicates.
    singleton: { key: "event.data.modelUploadId", mode: "skip" },
    onFailure: async ({ event }) => {
      const { modelUploadId, companyId } = event.data.event.data;
      await updateModelUpload(companyId, modelUploadId, {
        optimizeStatus: "Failed",
        optimizeError: event.data.error.message
      });
      // A failed optimise must not strand the raw in staging — compact is
      // cheaper than optimise (no simplify ladder) and often still succeeds.
      await inngest.send({
        name: "carbon/model-compact",
        data: { modelUploadId, companyId }
      });
    }
  },
  { event: "carbon/model-optimize" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId } = event.data;
    const force = event.data.force === true;

    // Feature-gated: no assembler configured -> skip before touching the row,
    // so the viewer just serves the raw model tier (optimizeStatus stays Idle).
    // model-compact still copies the raw out of staging (no assembler needed).
    if (!assemblerEnabled()) {
      await step.sendEvent("compact", {
        name: "carbon/model-compact",
        data: { modelUploadId, companyId }
      });
      logger.info("model optimise skipped — assembler is not configured", {
        modelUploadId
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    const queued = await step.run("queue", async () => {
      const model = await getModelUpload(companyId, modelUploadId);
      if (!model?.modelPath) {
        throw new NonRetriableError(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }
      // Already optimised → reuse it, never redo. An optimise is deterministic,
      // so a successful one is final; only a Failed row is worth re-firing
      // (that's what the viewer's Retry does).
      if (
        !force &&
        model.optimizeStatus === "Success" &&
        model.optimizedModelPath
      ) {
        return { kind: "alreadyOptimized" as const };
      }
      // Derive the source format from the stored file, not the caller, so
      // every attach point triggers with just the id. Strips a `.zst` suffix,
      // so a re-optimise of a compacted raw resolves too.
      const format = modelPathOptimizeFormat(model.modelPath);
      if (!format) return { kind: "notOptimizable" as const };

      const sourceBucket = await requireModelSourceBucket(
        companyId,
        model.modelPath
      );
      await updateModelUpload(companyId, modelUploadId, {
        optimizeStatus: "Processing",
        optimizeError: null
      });
      return {
        kind: "optimize" as const,
        model,
        format,
        sourceBucket,
        compact:
          sourceBucket === TEMP_STAGING_BUCKET
            ? compactTarget(companyId, model)
            : null
      };
    });

    if (queued.kind !== "optimize") {
      // Still compact: a row optimised before ingest, or a format the
      // optimiser does not read, may still hold its raw in staging.
      await step.sendEvent("compact", {
        name: "carbon/model-compact",
        data: { modelUploadId, companyId }
      });
      logger.info(`model optimise skipped — ${queued.kind}`, {
        modelUploadId
      });
      return {
        modelUploadId,
        status:
          queued.kind === "alreadyOptimized"
            ? ("AlreadyOptimized" as const)
            : ("Skipped" as const)
      };
    }
    const { format, sourceBucket, compact } = queued;
    const model = queued.model as ModelUploadRow;

    const optimizedPath = `${companyId}/models/${modelUploadId}/optimized.glb`;
    // Unique per triggering event: the preview is served from a STABLE proxy
    // URL, so reusing a path would keep showing the browser-cached image.
    const run = event.id ?? event.ts ?? "run";
    const thumbnailPath = `${companyId}/thumbnails/${modelUploadId}/${modelUploadId}-${run}.png`;
    // Idempotent per model — a re-run attaches to the in-flight optimise. A
    // FORCED regen must not: the assembler's job store keeps completed results
    // (24h TTL), so the stable id would attach to the previous run's result.
    const jobId = force
      ? `optimize-${modelUploadId}-${run}`
      : `optimize-${modelUploadId}`;

    const optimize = await runAssemblerJob(step, {
      idPrefix: "optimize",
      action: "optimize",
      jobId,
      maxWaitMs: MAX_OPTIMIZE_WAIT_MS,
      logger,
      buildBody: async () => {
        const signedUrl = await signSourceUrl(
          getCarbonServiceRole(),
          sourceBucket,
          model.modelPath,
          SIGNED_URL_EXPIRY
        );
        return {
          source: { url: internalizeStorageUrl(signedUrl), format },
          output: { path: optimizedPath },
          ...(compact ? { compact: { path: compact.path } } : {}),
          thumbnail: { path: thumbnailPath }
          // quality omitted → the service applies its size-adaptive policy.
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const [glb, thumbnail, raw] = await Promise.all([
          storage(client)
            .company(companyId)
            .createSignedUploadUrl(optimizedPath, { upsert: true }),
          storage(client)
            .company(companyId)
            .createSignedUploadUrl(thumbnailPath, { upsert: true }),
          compact
            ? client.storage
                .from(TEMP_STAGING_BUCKET)
                .createSignedUploadUrl(compact.path, { upsert: true })
            : null
        ]);
        const urls: Record<string, string> = {};
        if (glb.data) urls.glb = internalizeStorageUrl(glb.data.signedUrl);
        if (thumbnail.data) {
          urls.thumbnail = internalizeStorageUrl(thumbnail.data.signedUrl);
        }
        if (raw?.data) urls.raw = internalizeStorageUrl(raw.data.signedUrl);
        return urls;
      }
    });
    const outputs =
      ((optimize.result ?? {}) as { outputs?: IngestOutputs }).outputs ?? {};
    const stats: Json = optimize.stats;

    await step.run("persist", async () => {
      // Read the thumbnail now, not at queue time: an Onshape sync can attach
      // its own while the job runs, and that one is superseded too.
      const superseded = outputs.thumbnail
        ? (await getModelUpload(companyId, modelUploadId))?.thumbnailPath
        : null;
      await updateModelUpload(companyId, modelUploadId, {
        optimizeStatus: "Success",
        optimizeError: null,
        optimizedModelPath: optimizedPath,
        optimizedSize: outputs.glb?.bytes ?? null,
        optimizedAt: datetime.timestamp(),
        ...(outputs.thumbnail ? { thumbnailPath } : {})
      });
      // Drop the superseded thumbnail (best-effort — never fail the run over it).
      if (superseded && superseded !== thumbnailPath) {
        const removed = await storage(getCarbonServiceRole())
          .company(companyId)
          .remove([superseded]);
        if (removed.error) {
          logger.warn("failed to remove the superseded thumbnail", {
            modelUploadId,
            path: superseded,
            error: removed.error
          });
        }
      }
    });

    if (compact) {
      // The preview now exists, which is what lets an oversized raw be pruned.
      const settled = {
        ...model,
        optimizeStatus: "Success" as const,
        optimizedModelPath: optimizedPath
      };
      await step.run("keep-raw", () =>
        outputs.raw
          ? settleCompactedRaw(
              settled,
              compact,
              outputs.raw.bytes ?? null,
              logger
            )
          : relocateRaw(settled, logger)
      );
    }

    logger.info("model optimise finalized", { modelUploadId, stats });
    return { modelUploadId, status: "Success" as const };
  }
);
