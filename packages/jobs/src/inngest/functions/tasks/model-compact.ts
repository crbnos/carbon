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
 * fallback, re-optimise, lazy assembly-plan, and download) must not live there
 * or it is lost when staging is cleared. This function:
 *
 *  - When the assembler is available and the source is a compactable mesh: compacts
 *    it (STEP → OCCT BinXCAF `{id}.xbf.zst`; mesh → `{id}.{ext}.zst`), then
 *    relocates the compacted `.zst` to `private` if it fits the 50 MB served cap.
 *  - The customer's ORIGINAL bytes always survive. xbf compaction is a format
 *    conversion (no CAD tool opens `.xbf`), so the original STEP is kept alongside
 *    it — relocated to `private` when ≤ 50 MB, else left in staging tracked by
 *    `modelUpload.originalPath` (the staged-raw sweep spares both columns). zstd
 *    compaction is pure compression (the `.zst` decompresses byte-identical), so
 *    the `.zst` replaces the original and `originalPath` is cleared.
 *  - Otherwise (assembler off, non-mesh, or already `.zst`): relocates the raw
 *    as-is to `private` if it fits; oversized raws stay in staging (never pruned —
 *    they may be the only copy of the customer's file).
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
          "id, modelPath, originalPath, size, originalSize, optimizeStatus, optimizedModelPath, glbPath"
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
        originalPath: upload.data.originalPath as string | null,
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
        // Too big for `private` — never prune: this object is the only copy of
        // the customer's file (raw original, or a mesh `.zst` that decompresses
        // to it), and downloads must always be able to serve the original bytes.
        // It stays in staging, still referenced by `modelPath`, so the staged-raw
        // sweep won't touch it.
        logger.warn("oversized raw left in staging", {
          modelUploadId,
          modelPath: model.modelPath,
          rawSize,
          hasGlb
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
      // xbf compaction is a FORMAT CONVERSION (STEP → OCCT BinXCAF) — the `.zst`
      // does not decompress back to the customer's STEP, so the original file
      // must survive alongside it (downloads always serve original bytes).
      // zstd compaction is pure compression — the `.zst` decompresses to the
      // byte-identical original, so it REPLACES the original (no duplication)
      // and `originalPath` is cleared.
      const isXbf = mode === "xbf";

      // Where the retained original ends up (xbf only): `private` when it fits
      // the served cap, else it stays in staging — referenced via `originalPath`
      // so the staged-raw sweep won't prune it.
      const retainOriginal = async () => {
        const rawSize = model.originalSize ?? model.size;
        if (rawSize != null && rawSize <= MODEL_RAW_KEEP_MAX_BYTES) {
          const err = await moveRawToDurable(client, model.modelPath);
          // Non-fatal: on failure the original stays in staging, still tracked
          // by `originalPath` (the download route probes both buckets).
          if (err) {
            logger.warn("original raw not relocated — staying in staging", {
              modelUploadId,
              originalPath: model.modelPath,
              error: err
            });
          }
        }
      };

      if (fits) {
        // Relocate the compacted raw to durable storage and repoint `modelPath`
        // at it. xbf: also retain the original; zstd: drop the fat original
        // (the `.zst` IS the original, compressed).
        const err = await moveRawToDurable(client, compactPath);
        if (err) throw new Error(`relocate compacted raw to durable: ${err}`);
        if (isXbf) await retainOriginal();
        await client
          .from("modelUpload")
          .update({
            modelPath: compactPath,
            originalPath: isXbf ? model.modelPath : null,
            ...originalSizeUpdate,
            size: compactedSize
          })
          .eq("id", modelUploadId);
        if (!isXbf) {
          await client.storage
            .from(RAW_STAGING_BUCKET)
            .remove([model.modelPath]);
        }
        logger.info("raw compacted and relocated to durable", {
          modelUploadId,
          compactPath,
          mode
        });
        return { modelUploadId, status: "Success" as const };
      }

      if (hasGlb) {
        // Compacted output still exceeds the durable cap, but the GLB preview
        // survives → prune the compacted artifact (it is derived and can be
        // regenerated). The ORIGINAL stays in staging, still referenced by
        // `modelPath` (never repointed on this branch), so downloads and a
        // later re-compact keep working.
        await client.storage.from(RAW_STAGING_BUCKET).remove([compactPath]);
        logger.info("oversized compacted artifact pruned (original kept)", {
          modelUploadId,
          compactPath
        });
        return { modelUploadId, status: "KeptInStaging" as const };
      }

      // Too big for durable AND no GLB — keep the compacted `.zst` in staging
      // (best available for the viewer/plan) and repoint. xbf: the original also
      // stays in staging (tracked by `originalPath` for the sweep + downloads);
      // zstd: drop the fat original (the `.zst` has the bytes).
      await client
        .from("modelUpload")
        .update({
          modelPath: compactPath,
          originalPath: isXbf ? model.modelPath : null,
          ...originalSizeUpdate,
          ...(compactedSize != null ? { size: compactedSize } : {})
        })
        .eq("id", modelUploadId);
      if (!isXbf) {
        await client.storage.from(RAW_STAGING_BUCKET).remove([model.modelPath]);
      }
      logger.warn("oversized compacted raw with no GLB kept in staging", {
        modelUploadId,
        compactPath
      });
      return { modelUploadId, status: "KeptInStaging" as const };
    });
  }
);
