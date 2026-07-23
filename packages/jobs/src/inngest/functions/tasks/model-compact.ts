import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { modelPathOptimizeFormat } from "@carbon/utils";
import { inngest } from "../../client";
import {
  assemblerEnabled,
  internalizeStorageUrl,
  resolveModelSourceBucket,
  runAssemblerJob
} from "./assembler-client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_COMPACT_WAIT_MS = 15 * 60 * 1000;

/**
 * Compact the retained raw so it never lingers as the fat upload. STEP sources
 * become OCCT BinXCAF (`{id}.xbf.zst` — lossless B-rep + assembly tree, far
 * smaller than zstd'd ASCII STEP, same nodeIds when converted); mesh sources
 * are zstd'd in their original format (`{id}.{ext}.zst`, decompresses back to
 * the openable source file). On success `modelPath` is repointed at the
 * compacted raw and the fat original is deleted.
 *
 * Decoupled from model-optimize: fired after optimize settles regardless of
 * outcome, so a failed or skipped optimize can't strand a fat raw for the
 * scheduled prune. Own retries — compaction is cheap relative to optimize
 * (zstd only, or a tessellation-free OCCT parse for xbf), so it can succeed
 * where optimize can't.
 */
export const modelCompactFunction = inngest.createFunction(
  { id: "model-compact", retries: 3 },
  { event: "carbon/model-compact" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId } = event.data;

    if (!assemblerEnabled()) {
      logger.info("model compact skipped — assembler is not configured", {
        modelUploadId
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    const model = await step.run("resolve", async () => {
      const client = getCarbonServiceRole();
      const upload = await client
        .from("modelUpload")
        .select("id, modelPath")
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
        format: modelPathOptimizeFormat(upload.data.modelPath),
        sourceBucket
      };
    });

    // Only temp-staging sources compact: the flow writes the .zst there,
    // deletes the fat original there, and the prune covers strays there.
    // Legacy `private` raws predate the pipeline — leave them where they are.
    if (
      model.modelPath.toLowerCase().endsWith(".zst") ||
      model.sourceBucket !== "temp-staging" ||
      !model.format
    ) {
      logger.info("model compact skipped", {
        modelUploadId,
        modelPath: model.modelPath,
        sourceBucket: model.sourceBucket
      });
      return { modelUploadId, status: "Skipped" as const };
    }

    // STEP → BinXCAF; everything else → plain zstd of the raw. Flat path
    // mirroring the original raw so the model id stays recoverable from the
    // path (CadModel's `modelIdFromPath`) and the download route resolves the
    // underlying format from the extension.
    const mode = model.format === "step" ? "xbf" : "zstd";
    const compactExt = mode === "xbf" ? "xbf" : model.format;
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
          .from("temp-staging")
          .createSignedUrl(model.modelPath, SIGNED_URL_EXPIRY);
        if (source.error) {
          throw new Error(`sign source: ${source.error.message}`);
        }
        return {
          source: { url: internalizeStorageUrl(source.data.signedUrl) },
          mode,
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
      (compact.stats as { outputBytes?: number } | null)?.outputBytes ?? null;

    await step.run("persist", async () => {
      const client = getCarbonServiceRole();
      // Repoint modelPath at the compacted raw and record its (compressed)
      // stored size so the files list reflects what's actually on disk, then
      // drop the fat original. Freeze the as-uploaded bytes into originalSize
      // first (rows from before the column exist with null) — the viewer's
      // reduction badge compares the ORIGINAL, not the .zst.
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

    logger.info("raw compacted", { modelUploadId, compactPath, mode });
    return { modelUploadId, status: "Success" as const };
  }
);
