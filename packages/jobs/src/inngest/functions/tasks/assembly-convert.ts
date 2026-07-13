import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { inngest } from "../../client";
import {
  POLL_GAP,
  pollAssemblerJobOnce,
  submitAssemblerJob
} from "./assembler-client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// Total wall-clock budget before giving up, bounded by time (not a poll count)
// so it holds whether the service long-polls or returns immediately. Convert is
// far faster than plan, but the job model long-polls the same way.
const MAX_CONVERT_WAIT_MS = 10 * 60 * 1000;

/**
 * Converts an uploaded CAD model (STEP) into web artifacts via the assembler
 * service: a meshopt-optimised GLB and an assembly graph JSON. Async job model:
 * create → long-poll GET /v1/jobs/{id} → the service late-mint uploads both
 * artifacts to signed URLs handed over on each poll. See
 * .ai/specs/2026-07-04-animated-work-instructions-contracts.md.
 */
export const assemblyConvertFunction = inngest.createFunction(
  {
    id: "assembly-convert",
    retries: 2,
    // This function holds its run for the whole convert (it long-polls to
    // completion); keep per-company fan-out from starving other tenants.
    concurrency: [{ limit: 4 }, { key: "event.data.companyId", limit: 2 }],
    onFailure: async ({ event }) => {
      const { modelUploadId } = event.data.event.data;
      const client = getCarbonServiceRole();

      await client
        .from("modelUpload")
        .update({
          processingStatus: "Failed",
          processingError: event.data.error.message
        })
        .eq("id", modelUploadId);

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Failed",
          error: event.data.error.message,
          updatedAt: new Date().toISOString()
        })
        .eq("modelUploadId", modelUploadId)
        .eq("kind", "convert")
        .eq("status", "Processing");
    }
  },
  { event: "carbon/assembly-convert" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId, userId } = event.data;

    const job = await step.run("queue", async () => {
      const client = getCarbonServiceRole();

      const modelUpload = await client
        .from("modelUpload")
        .select("id, modelPath, companyId")
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .single();

      if (modelUpload.error || !modelUpload.data?.modelPath) {
        throw new Error(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }

      const planJob = await client
        .from("assemblyPlanJob")
        .insert({
          modelUploadId,
          kind: "convert",
          status: "Processing",
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();

      if (planJob.error) {
        throw new Error(
          `Failed to create assembly plan job: ${planJob.error.message}`
        );
      }

      await client
        .from("modelUpload")
        .update({ processingStatus: "Processing", processingError: null })
        .eq("id", modelUploadId);

      return { id: planJob.data.id, modelPath: modelUpload.data.modelPath };
    });

    // Job-scoped artifact paths. The service late-mint uploads to these via
    // signed URLs minted fresh on each poll (below); we record the paths.
    const glbPath = `${companyId}/models/${modelUploadId}/${job.id}/model.glb`;
    const graphPath = `${companyId}/models/${modelUploadId}/${job.id}/graph.json`;

    // Create the convert job (idempotent on job.id). A fresh signed source URL
    // is minted here so retries don't reuse an expired one.
    await step.run("submit", async () => {
      const client = getCarbonServiceRole();

      const source = await client.storage
        .from("private")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }

      // Content identity for the service's result cache: with a contentHash a
      // repeat convert of unchanged bytes is served without re-downloading the
      // source. etag is content-derived; size disambiguates multipart etags.
      // Best-effort — omitted on any failure.
      let contentHash: string | undefined;
      try {
        const info = await client.storage.from("private").info(job.modelPath);
        const etag = info.data?.etag?.replaceAll('"', "");
        if (!info.error && etag) {
          contentHash = `${etag}-${info.data?.size ?? 0}`;
        }
      } catch {
        // optimization only
      }

      await submitAssemblerJob({
        action: "convert",
        jobId: job.id,
        logger,
        body: {
          source: {
            url: source.data.signedUrl,
            format: "step",
            ...(contentHash ? { contentHash } : {})
          },
          // Storage paths (not URLs) — recorded in the completion pointer; the
          // signed PUT URLs are late-minted per poll, keyed glb/graph.
          outputs: {
            glb: { path: glbPath },
            graph: { path: graphPath }
          }
        }
      });
      logger.info("convert submitted to assembler service", { jobId: job.id });
    });

    // Long-poll to completion. Each poll mints fresh signed upload URLs for both
    // artifacts; the service PUTs them the instant the convert is done.
    let componentCount: number | null = null;
    let stats: Json = null;
    let finished = false;
    const startedAt = await step.run("convert-poll-start", () => Date.now());
    let i = 0;
    while (Date.now() - startedAt < MAX_CONVERT_WAIT_MS) {
      const poll = await step.run(`poll-${i}`, () =>
        pollAssemblerJobOnce({
          jobId: job.id,
          mintUploadUrls: async () => {
            const client = getCarbonServiceRole();
            const [glbUpload, graphUpload] = await Promise.all([
              client.storage
                .from("private")
                .createSignedUploadUrl(glbPath, { upsert: true }),
              client.storage
                .from("private")
                .createSignedUploadUrl(graphPath, { upsert: true })
            ]);
            const urls: Record<string, string> = {};
            if (glbUpload.data) urls.glb = glbUpload.data.signedUrl;
            if (graphUpload.data) urls.graph = graphUpload.data.signedUrl;
            return urls;
          }
        })
      );

      if (poll.status === "done") {
        const result = (poll.result ?? {}) as { componentCount?: number };
        componentCount = result.componentCount ?? null;
        stats = poll.stats;
        finished = true;
        break;
      }
      if (poll.status === "error") {
        // Fail fast: onFailure releases the model + job rows.
        throw new Error(poll.error);
      }
      await step.sleep(`gap-${i}`, POLL_GAP);
      i++;
    }

    if (!finished) {
      throw new Error("Convert did not finish in the expected time");
    }

    await step.run("persist", async () => {
      const client = getCarbonServiceRole();
      await client
        .from("modelUpload")
        .update({
          processingStatus: "Success",
          processingError: null,
          glbPath,
          graphPath,
          componentCount,
          processedAt: new Date().toISOString()
        })
        .eq("id", modelUploadId);

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          stats,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id);
    });

    // Planning is NOT chained here — it's expensive (minutes) and the user may
    // author steps manually. It runs lazily on the first "Generate Steps" click
    // (or an explicit re-plan), which then auto-creates the steps.
  }
);
