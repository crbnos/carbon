import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { modelPathOptimizeFormat } from "@carbon/utils";
import { inngest } from "../../client";
import {
  assemblerEnabled,
  internalizeStorageUrl,
  resolveModelSourceBucket,
  runAssemblerJob
} from "./assembler-client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_OPTIMIZE_WAIT_MS = 15 * 60 * 1000;

/**
 * Eager model optimisation on upload. Runs a mesh model (STEP / glTF / GLB)
 * through the assembler's POST /v1/optimize (merge same-material primitives,
 * simplify within the auto tolerance, meshopt-encode, gate on size) into a
 * compact optimised GLB stored at optimizedModelPath. Separate from
 * assembly-convert: that produces the lossless GLB the animated viewer needs;
 * this is the aggressively-optimised version for storage/preview.
 */
export const modelOptimizeFunction = inngest.createFunction(
  {
    id: "model-optimize",
    retries: 2,
    onFailure: async ({ event }) => {
      const { modelUploadId } = event.data.event.data;
      const client = getCarbonServiceRole();
      await client
        .from("modelUpload")
        .update({
          optimizeStatus: "Failed",
          optimizeError: event.data.error.message
        })
        .eq("id", modelUploadId);
    }
  },
  { event: "carbon/model-optimize" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId } = event.data;

    // Feature-gated: no assembler configured -> skip before touching the row,
    // so the viewer just serves the raw model tier (optimizeStatus stays null).
    if (!assemblerEnabled()) {
      logger.info("model optimise skipped — assembler is not configured", {
        modelUploadId
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    const model = await step.run("queue", async () => {
      const client = getCarbonServiceRole();
      const upload = await client
        .from("modelUpload")
        .select("id, modelPath, optimizeStatus, optimizedModelPath")
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .single();
      if (upload.error || !upload.data?.modelPath) {
        throw new Error(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }
      // Already optimised → reuse it, never redo. An optimise is deterministic,
      // so a successful one is final; only a Failed row is worth re-firing
      // (that's what the viewer's Retry does). Guards against any caller —
      // client auto-fire, an errant retry — re-running the assembler on a model
      // that already has its GLB.
      if (
        upload.data.optimizeStatus === "Success" &&
        upload.data.optimizedModelPath
      ) {
        return { alreadyOptimized: true as const };
      }
      // Derive the source format from the stored file, not the caller — every
      // attach point (part/quote/rfq create, generic upload) then triggers with
      // just the id, and non-mesh inputs (stl/obj/iges/…) skip cleanly. Strips a
      // `.zst` compaction suffix so reoptimise of a compacted raw resolves too.
      const format = modelPathOptimizeFormat(upload.data.modelPath);
      if (format) {
        await client
          .from("modelUpload")
          .update({ optimizeStatus: "Processing", optimizeError: null })
          .eq("id", modelUploadId);
      }
      // Legacy (pre-assembler) raws live in `private`, current ones in
      // `temp-staging` — signing the wrong bucket 404s.
      const sourceBucket = await resolveModelSourceBucket(
        client,
        upload.data.modelPath
      );
      return {
        modelPath: upload.data.modelPath,
        format,
        sourceBucket,
        alreadyOptimized: false as const
      };
    });

    if (model.alreadyOptimized) {
      logger.info("model optimise skipped — already optimised", {
        modelUploadId
      });
      return { modelUploadId, status: "AlreadyOptimized" as const };
    }

    if (!model.format) {
      logger.info("model optimise skipped — not an optimisable mesh format", {
        modelUploadId,
        modelPath: model.modelPath
      });
      return { modelUploadId, status: "Skipped" as const };
    }
    const format = model.format;

    // Where the optimised GLB lands. The service late-mint uploads to this via a
    // signed URL minted fresh on each poll (below).
    const optimizedPath = `${companyId}/models/${modelUploadId}/optimized.glb`;
    // Idempotent per model — a re-run attaches to the in-flight optimise.
    const jobId = `optimize-${modelUploadId}`;

    // Router: sync inline on Lambda (default when enabled) or async submit->poll
    // on the standing service / dev container. Sync off => today's async path.
    const optimize = await runAssemblerJob(step, {
      idPrefix: "optimize",
      action: "optimize",
      jobId,
      maxWaitMs: MAX_OPTIMIZE_WAIT_MS,
      logger,
      buildBody: async () => {
        const client = getCarbonServiceRole();
        // Optimised artifacts are written to `private` (50 MB served cap) below.
        const source = await client.storage
          .from(model.sourceBucket)
          .createSignedUrl(model.modelPath, SIGNED_URL_EXPIRY);
        if (source.error) {
          throw new Error(`Failed to sign source URL: ${source.error.message}`);
        }
        return {
          source: { url: internalizeStorageUrl(source.data.signedUrl), format },
          output: { path: optimizedPath }
          // quality omitted → the service defaults apply (codec meshopt, merge on,
          // normal quant on, auto simplify tolerance, aggressive ladder to fit the
          // size + render-weight gates).
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const upload = await client.storage
          .from("private")
          .createSignedUploadUrl(optimizedPath, { upsert: true });
        const urls: Record<string, string> = {};
        if (upload.data)
          urls.glb = internalizeStorageUrl(upload.data.signedUrl);
        return urls;
      }
    });
    const stats: Json = optimize.stats;

    await step.run("persist", async () => {
      const client = getCarbonServiceRole();
      // Read the optimised object's byte size from storage (the service uploads
      // it via the late-mint URL, so the job never holds the bytes) to surface
      // the reduction against the untouched source `size`.
      const dir = `${companyId}/models/${modelUploadId}`;
      const listed = await client.storage
        .from("private")
        .list(dir, { search: "optimized.glb" });
      const optimizedSize =
        listed.data?.find((o) => o.name === "optimized.glb")?.metadata?.size ??
        null;

      await client
        .from("modelUpload")
        .update({
          optimizeStatus: "Success",
          optimizeError: null,
          optimizedModelPath: optimizedPath,
          optimizedSize,
          optimizedAt: new Date().toISOString()
        })
        .eq("id", modelUploadId);
    });

    // Compact the retained raw so it never lingers as the fat upload. Every
    // optimisable source (any size) is zstd-compressed IN ITS ORIGINAL FORMAT —
    // `raw.<ext>.zst` stays a valid STEP/glTF/… that the download route
    // decompresses back to the source file, and the assembler reads it back
    // transparently (zstd-decoded on fetch), so plan/convert/reoptimise need no
    // change. Already-compacted (`.zst`) raws are skipped. Best-effort: a
    // compaction failure must not fail the already-succeeded optimise (the
    // scheduled big-raw TTL prune is the safety net).
    // Only temp-staging sources compact: the flow writes the .zst there, deletes
    // the fat original there, and the TTL prune covers strays there. Legacy
    // `private` raws predate the pipeline — leave them where they are.
    const alreadyCompacted = model.modelPath.toLowerCase().endsWith(".zst");
    if (!alreadyCompacted && model.sourceBucket === "temp-staging") {
      // Flat, mirroring the original raw (`${id}.step` → `${id}.step.zst`), so the
      // model id stays recoverable from the path (CadModel's `modelIdFromPath`)
      // and the download route resolves the underlying format from the extension.
      const compactPath = `${companyId}/models/${modelUploadId}.${format}.zst`;
      const compactJobId = `compact-${modelUploadId}`;
      try {
        const compact = await runAssemblerJob(step, {
          idPrefix: "compact",
          action: "compact",
          jobId: compactJobId,
          maxWaitMs: MAX_OPTIMIZE_WAIT_MS,
          logger,
          buildBody: async () => {
            const client = getCarbonServiceRole();
            const source = await client.storage
              .from("temp-staging")
              .createSignedUrl(model.modelPath, SIGNED_URL_EXPIRY);
            if (source.error) {
              throw new Error(`sign source: ${source.error.message}`);
            }
            return {
              source: { url: internalizeStorageUrl(source.data.signedUrl) },
              mode: "zstd",
              output: { path: compactPath }
            };
          },
          mintUploadUrls: async () => {
            const client = getCarbonServiceRole();
            const upload = await client.storage
              .from("temp-staging")
              .createSignedUploadUrl(compactPath, { upsert: true });
            const urls: Record<string, string> = {};
            if (upload.data)
              urls.raw = internalizeStorageUrl(upload.data.signedUrl);
            return urls;
          }
        });
        const compactedSize =
          (compact.stats as { outputBytes?: number } | null)?.outputBytes ??
          null;

        await step.run("compact-persist", async () => {
          const client = getCarbonServiceRole();
          // Repoint modelPath at the compacted raw and record its (compressed)
          // stored size so the files list reflects what's actually on disk, then
          // drop the fat original. Freeze the as-uploaded bytes into
          // originalSize first (rows from before the column exist with null) —
          // the viewer's reduction badge compares the ORIGINAL, not the .zst.
          const existing = await client
            .from("modelUpload")
            .select("size, originalSize")
            .eq("id", modelUploadId)
            .maybeSingle();
          await client
            .from("modelUpload")
            .update({
              modelPath: compactPath,
              ...(existing.data && existing.data.originalSize == null
                ? { originalSize: existing.data.size }
                : {}),
              ...(compactedSize != null ? { size: compactedSize } : {})
            })
            .eq("id", modelUploadId);
          await client.storage.from("temp-staging").remove([model.modelPath]);
        });
        logger.info("raw compacted", { modelUploadId, compactPath });
      } catch (err) {
        logger.warn("raw compaction skipped", {
          modelUploadId,
          error: (err as Error).message
        });
      }
    }

    logger.info("model optimise finalized", { modelUploadId, stats });
    return { modelUploadId, status: "Success" as const };
  }
);
