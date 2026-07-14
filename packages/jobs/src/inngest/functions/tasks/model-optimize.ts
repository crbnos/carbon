import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { optimizableModelFormat } from "@carbon/utils";
import { inngest } from "../../client";
import {
  POLL_GAP,
  pollAssemblerJobOnce,
  submitAssemblerJob
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
    // The assembler is CPU-bound; keep per-company fan-out from starving tenants.
    concurrency: [{ limit: 4 }, { key: "event.data.companyId", limit: 2 }],
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

    const model = await step.run("queue", async () => {
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
      // Derive the source format from the stored file, not the caller — every
      // attach point (part/quote/rfq create, generic upload) then triggers with
      // just the id, and non-mesh inputs (stl/obj/iges/…) skip cleanly.
      const ext = upload.data.modelPath.split(".").pop() ?? "";
      const format = optimizableModelFormat(ext);
      if (format) {
        await client
          .from("modelUpload")
          .update({ optimizeStatus: "Processing", optimizeError: null })
          .eq("id", modelUploadId);
      }
      return { modelPath: upload.data.modelPath, format };
    });

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

    await step.run("submit", async () => {
      const client = getCarbonServiceRole();
      const source = await client.storage
        .from("private")
        .createSignedUrl(model.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }
      await submitAssemblerJob({
        action: "optimize",
        jobId,
        logger,
        body: {
          source: { url: source.data.signedUrl, format },
          output: { path: optimizedPath }
          // quality omitted → the service defaults apply (codec meshopt, merge on,
          // normal quant on, auto simplify tolerance, aggressive ladder to fit the
          // size + render-weight gates).
        }
      });
      logger.info("model optimise submitted", { modelUploadId, format });
    });

    let stats: Json = null;
    let finished = false;
    const startedAt = await step.run("optimize-poll-start", () => Date.now());
    let i = 0;
    while (Date.now() - startedAt < MAX_OPTIMIZE_WAIT_MS) {
      const poll = await step.run(`poll-${i}`, () =>
        pollAssemblerJobOnce({
          jobId,
          mintUploadUrls: async () => {
            const client = getCarbonServiceRole();
            const upload = await client.storage
              .from("private")
              .createSignedUploadUrl(optimizedPath, { upsert: true });
            const urls: Record<string, string> = {};
            if (upload.data) urls.glb = upload.data.signedUrl;
            return urls;
          }
        })
      );
      if (poll.status === "done") {
        stats = poll.stats;
        finished = true;
        break;
      }
      if (poll.status === "error") {
        throw new Error(poll.error);
      }
      await step.sleep(`gap-${i}`, POLL_GAP);
      i++;
    }

    if (!finished) {
      throw new Error("Model optimise did not finish in the expected time");
    }

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

    logger.info("model optimise finalized", { modelUploadId, stats });
    return { modelUploadId, status: "Success" as const };
  }
);
