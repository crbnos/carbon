import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  MODEL_RAW_KEEP_MAX_BYTES,
  modelPathOptimizeFormat
} from "@carbon/utils";
import { inngest } from "../../client";
import {
  ASSEMBLER_CONCURRENCY,
  assemblerEnabled,
  internalizeStorageUrl,
  moveRawToDurable,
  RAW_STAGING_BUCKET,
  resolveModelSourceBucket,
  runAssemblerJob
} from "./assembler-client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_COMPACT_WAIT_MS = 15 * 60 * 1000;

/**
 * Persist a model's retained raw to DURABLE storage. Uploads and compaction stage
 * in the EPHEMERAL `temp-staging` bucket; the retained raw (the source for the WASM
 * fallback, re-optimise, lazy assembly-plan, and mesh download) must not live there
 * or it is lost when staging is cleared. This function:
 *
 *  - When the assembler is available and the source is a compactable mesh: compacts
 *    it (STEP → OCCT BinXCAF `{id}.xbf.zst`; mesh → `{id}.{ext}.zst`), then
 *    relocates the compacted `.zst` to `private` if it fits the 50 MB served cap.
 *  - Otherwise (assembler off, non-mesh, or already `.zst`): relocates the raw
 *    as-is to `private` if it fits.
 *  - When it can't fit `private` (> 50 MB): PRUNE the raw if an optimised GLB
 *    preview already exists (the preview is enough); else leave it in staging (a
 *    big model with no GLB can't render anyway, and it's the only copy).
 *
 * Fired after model-optimize settles (success, failure, or assembler-off skip), so
 * a failed/skipped optimise still gets its raw persisted. Own retries.
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

    const model = await step.run("resolve", async () => {
      const client = getCarbonServiceRole();
      const upload = await client
        .from("modelUpload")
        .select(
          "id, modelPath, size, originalSize, optimizeStatus, optimizedModelPath, glbPath"
        )
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .single();
      if (upload.error || !upload.data?.modelPath) {
        throw new Error(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }
      const sourceBucket = await resolveModelSourceBucket(
        client,
        upload.data.modelPath
      );
      return {
        modelPath: upload.data.modelPath,
        size: upload.data.size as number | null,
        originalSize: upload.data.originalSize as number | null,
        optimizeStatus: upload.data.optimizeStatus,
        optimizedModelPath: upload.data.optimizedModelPath,
        glbPath: upload.data.glbPath,
        format: modelPathOptimizeFormat(upload.data.modelPath),
        sourceBucket
      };
    });

    // Already durable (in `private`) or gone — nothing to relocate. `private`
    // rows also cover legacy pre-assembler uploads that already live there.
    if (model.sourceBucket !== RAW_STAGING_BUCKET) {
      logger.info("model compact skipped — raw not in staging", {
        modelUploadId,
        sourceBucket: model.sourceBucket
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    // The optimised GLB preview is the fallback that makes pruning an oversized
    // raw safe — without it, the raw is the model's only copy.
    const hasGlb =
      (model.optimizeStatus === "Success" &&
        Boolean(model.optimizedModelPath)) ||
      Boolean(model.glbPath);
    const isZst = model.modelPath.toLowerCase().endsWith(".zst");
    const canCompact = assemblerEnabled() && Boolean(model.format) && !isZst;

    // Freeze the as-uploaded bytes into originalSize once (rows from before the
    // column exist with null); the viewer's reduction badge compares the ORIGINAL.
    const originalSizeUpdate =
      model.originalSize == null && model.size != null
        ? { originalSize: model.size }
        : {};

    if (!canCompact) {
      // No compaction possible — relocate the raw AS-IS to durable storage. Same
      // key, so `modelPath` (path-only) is unchanged; the artifacts route resolves
      // the bucket by probing.
      return await step.run("relocate", async () => {
        const client = getCarbonServiceRole();
        const rawSize = model.size;
        if (rawSize != null && rawSize <= MODEL_RAW_KEEP_MAX_BYTES) {
          const err = await moveRawToDurable(client, model.modelPath);
          if (err) throw new Error(`relocate raw to durable: ${err}`);
          logger.info("raw relocated to durable", {
            modelUploadId,
            modelPath: model.modelPath
          });
          return { modelUploadId, status: "Relocated" as const };
        }
        if (hasGlb) {
          // Too big for `private`, but the GLB preview survives → prune the raw.
          await client.storage
            .from(RAW_STAGING_BUCKET)
            .remove([model.modelPath]);
          logger.info("oversized raw pruned (GLB preview exists)", {
            modelUploadId,
            modelPath: model.modelPath
          });
          return { modelUploadId, status: "Pruned" as const };
        }
        // Too big AND no GLB — it's the only copy and can't fit durable storage.
        // Leave it in staging (a > 50 MB raw with no GLB can't render anyway).
        logger.warn("oversized raw with no GLB left in staging", {
          modelUploadId,
          modelPath: model.modelPath,
          rawSize
        });
        return { modelUploadId, status: "KeptInStaging" as const };
      });
    }

    const format = model.format as NonNullable<typeof model.format>;
    const mode = format === "step" ? "xbf" : "zstd";
    const compactExt = mode === "xbf" ? "xbf" : format;
    // Flat path mirroring the raw so the id stays recoverable (modelIdFromPath).
    const compactPath = `${companyId}/models/${modelUploadId}.${compactExt}.zst`;
    const jobId = `compact-${modelUploadId}`;

    const compact = await runAssemblerJob(step, {
      idPrefix: "compact",
      action: "compact",
      jobId,
      maxWaitMs: MAX_COMPACT_WAIT_MS,
      logger,
      buildBody: async () => {
        const client = getCarbonServiceRole();
        const source = await client.storage
          .from(RAW_STAGING_BUCKET)
          .createSignedUrl(model.modelPath, SIGNED_URL_EXPIRY);
        if (source.error) {
          throw new Error(`sign source: ${source.error.message}`);
        }
        return {
          source: { url: internalizeStorageUrl(source.data.signedUrl) },
          mode,
          // The assembler writes the compacted output to staging first; we
          // relocate it to durable storage (or prune) once we know its size.
          output: { path: compactPath }
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const upload = await client.storage
          .from(RAW_STAGING_BUCKET)
          .createSignedUploadUrl(compactPath, { upsert: true });
        const urls: Record<string, string> = {};
        if (upload.data)
          urls.raw = internalizeStorageUrl(upload.data.signedUrl);
        return urls;
      }
    });
    const compactedSize =
      (compact.stats as { outputBytes?: number } | null)?.outputBytes ?? null;

    return await step.run("persist", async () => {
      const client = getCarbonServiceRole();
      const fits =
        compactedSize != null && compactedSize <= MODEL_RAW_KEEP_MAX_BYTES;

      if (fits) {
        // Relocate the compacted raw to durable storage, repoint `modelPath` at
        // it, then drop the fat original from staging.
        const err = await moveRawToDurable(client, compactPath);
        if (err) throw new Error(`relocate compacted raw to durable: ${err}`);
        await client
          .from("modelUpload")
          .update({
            modelPath: compactPath,
            ...originalSizeUpdate,
            size: compactedSize
          })
          .eq("id", modelUploadId);
        await client.storage.from(RAW_STAGING_BUCKET).remove([model.modelPath]);
        logger.info("raw compacted and relocated to durable", {
          modelUploadId,
          compactPath,
          mode
        });
        return { modelUploadId, status: "Success" as const };
      }

      if (hasGlb) {
        // Compacted raw still exceeds the durable cap, but the GLB preview
        // survives → prune both the compacted output and the original.
        await client.storage
          .from(RAW_STAGING_BUCKET)
          .remove([compactPath, model.modelPath]);
        logger.info("oversized compacted raw pruned (GLB preview exists)", {
          modelUploadId,
          compactPath
        });
        return { modelUploadId, status: "Pruned" as const };
      }

      // Too big for durable AND no GLB — keep the compacted `.zst` in staging
      // (best available), repoint, drop the fat original.
      await client
        .from("modelUpload")
        .update({
          modelPath: compactPath,
          ...originalSizeUpdate,
          ...(compactedSize != null ? { size: compactedSize } : {})
        })
        .eq("id", modelUploadId);
      await client.storage.from(RAW_STAGING_BUCKET).remove([model.modelPath]);
      logger.warn("oversized compacted raw with no GLB kept in staging", {
        modelUploadId,
        compactPath
      });
      return { modelUploadId, status: "KeptInStaging" as const };
    });
  }
);
