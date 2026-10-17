// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { toJson } from "@carbon/database/json";
import { storage } from "@carbon/files";
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
  getModelUpload,
  insertPlanJob,
  updateModelUpload,
  updatePlanJobs
} from "./model-rows";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// How long a convert may run once the service starts it.
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
    concurrency: ASSEMBLER_CONCURRENCY,
    onFailure: async ({ event }) => {
      const { modelUploadId, companyId } = event.data.event.data;
      const error = event.data.error.message;
      await updateModelUpload(companyId, modelUploadId, {
        processingStatus: "Failed",
        processingError: error
      });
      await updatePlanJobs(
        companyId,
        { modelUploadId, kind: "convert", statuses: ["Processing"] },
        { status: "Failed", error }
      );
    }
  },
  { event: "carbon/assembly-convert" },
  async ({ event, step, logger }) => {
    const { modelUploadId, companyId, userId } = event.data;

    // Feature-gated: no assembler configured -> skip before creating the plan
    // job row or flipping processingStatus, so the UI never shows a stuck
    // "Processing" and the viewer serves the unconverted model.
    if (!assemblerEnabled()) {
      logger.info("assembly convert skipped — assembler is not configured", {
        modelUploadId
      });
      return;
    }

    const job = await step.run("queue", async () => {
      const modelUpload = await getModelUpload(companyId, modelUploadId);
      if (!modelUpload?.modelPath) {
        throw new NonRetriableError(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }
      const id = await insertPlanJob({
        companyId,
        modelUploadId,
        kind: "convert",
        createdBy: userId
      });
      await updateModelUpload(companyId, modelUploadId, {
        processingStatus: "Processing",
        processingError: null
      });
      return { id, modelPath: modelUpload.modelPath };
    });

    // Job-scoped artifact paths. The service late-mint uploads to these via
    // signed URLs minted fresh on each poll (below); we record the paths.
    const glbPath = `${companyId}/models/${modelUploadId}/${job.id}/model.glb`;
    const graphPath = `${companyId}/models/${modelUploadId}/${job.id}/graph.json`;

    // Router: sync inline on Lambda (default when enabled) or async submit->poll
    // on the standing service / dev container. Sync off => today's async path.
    // Each attempt mints a fresh signed source URL (retries never reuse an
    // expired one) and fresh signed upload URLs for both artifacts (late-mint).
    const convert = await runAssemblerJob(step, {
      idPrefix: "convert",
      action: "convert",
      jobId: job.id,
      maxWaitMs: MAX_CONVERT_WAIT_MS,
      logger,
      buildBody: async () => {
        const client = getCarbonServiceRole();
        const sourceBucket = await requireModelSourceBucket(
          companyId,
          job.modelPath
        );
        const signedUrl = await signSourceUrl(
          client,
          sourceBucket,
          job.modelPath,
          SIGNED_URL_EXPIRY
        );

        // Content identity for the service's result cache: with a contentHash a
        // repeat convert of unchanged bytes is served without re-downloading the
        // source. etag is content-derived; size disambiguates multipart etags.
        // Best-effort — omitted on any failure.
        let contentHash: string | undefined;
        try {
          const info = await client.storage
            .from(sourceBucket)
            .info(job.modelPath);
          const etag = info.data?.etag?.replaceAll('"', "");
          if (!info.error && etag) {
            contentHash = `${etag}-${info.data?.size ?? 0}`;
          }
        } catch {
          // optimization only
        }

        return {
          source: {
            url: internalizeStorageUrl(signedUrl),
            format: "step",
            ...(contentHash ? { contentHash } : {})
          },
          // Storage paths (not URLs) — recorded in the completion pointer; the
          // signed PUT URLs are late-minted, keyed glb/graph.
          outputs: {
            glb: { path: glbPath },
            graph: { path: graphPath }
          }
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const [glbUpload, graphUpload] = await Promise.all([
          storage(client)
            .company(companyId)
            .createSignedUploadUrl(glbPath, { upsert: true }),
          storage(client)
            .company(companyId)
            .createSignedUploadUrl(graphPath, { upsert: true })
        ]);
        const urls: Record<string, string> = {};
        if (glbUpload.data)
          urls.glb = internalizeStorageUrl(glbUpload.data.signedUrl);
        if (graphUpload.data)
          urls.graph = internalizeStorageUrl(graphUpload.data.signedUrl);
        return urls;
      }
    });
    const componentCount =
      ((convert.result ?? {}) as { componentCount?: number }).componentCount ??
      null;
    const stats: Json = convert.stats;

    await step.run("persist", async () => {
      await updateModelUpload(companyId, modelUploadId, {
        processingStatus: "Success",
        processingError: null,
        glbPath,
        graphPath,
        componentCount,
        processedAt: datetime.timestamp()
      });
      await updatePlanJobs(
        companyId,
        { id: job.id },
        { status: "Success", stats: toJson(stats) }
      );
    });

    // Planning is NOT chained here — it's expensive (minutes) and the user may
    // author steps manually. It runs lazily on the first "Generate Steps" click
    // (or an explicit re-plan), which then auto-creates the steps.
  }
);
