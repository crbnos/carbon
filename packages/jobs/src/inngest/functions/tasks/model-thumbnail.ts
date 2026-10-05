// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { storage } from "@carbon/files";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import {
  ASSEMBLER_CONCURRENCY,
  assemblerEnabled,
  internalizeStorageUrl,
  runAssemblerJob
} from "./assembler-client";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
const MAX_THUMBNAIL_WAIT_MS = 5 * 60 * 1000;

/**
 * Renders a model's preview thumbnail. The assembler draws the model's GLB
 * (the optimised one, else the lossless assembly GLB) to a PNG and uploads it
 * through a late-minted signed URL; this function then points
 * `modelUpload.thumbnailPath` at it.
 */
export const modelThumbnailFunction = inngest.createFunction(
  {
    id: "model-thumbnail",
    retries: 3,
    concurrency: ASSEMBLER_CONCURRENCY,
    // One render per model at a time — overlapping runs (regenerate + the
    // optimise-chained event, or rapid clicks) would race the "delete previous
    // thumbnail" step and can strand a just-published object. (This event's
    // payload key is `modelId`, not `modelUploadId`.)
    singleton: { key: "event.data.modelId", mode: "skip" }
  },
  { event: "carbon/model-thumbnail" },
  async ({ event, step, logger }) => {
    const { modelId, companyId, direction } = event.data;

    if (!assemblerEnabled()) {
      logger.info("model thumbnail skipped — assembler not configured", {
        modelId
      });
      return { modelId, status: "Skipped" as const };
    }

    const model = await step.run("resolve", async () => {
      const client = getCarbonServiceRole();
      const upload = await client
        .from("modelUpload")
        .select("glbPath, optimizedModelPath, thumbnailPath")
        .eq("id", modelId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (upload.error) {
        throw new Error(`Failed to read model upload: ${upload.error.message}`);
      }
      return {
        glbPath:
          upload.data?.optimizedModelPath ?? upload.data?.glbPath ?? null,
        // Deleted after the new one lands, so a regeneration leaves no orphan.
        previousPath: upload.data?.thumbnailPath ?? null
      };
    });

    // The assembler writes the GLB; model-optimize sends this event again once
    // it has.
    if (!model.glbPath) {
      logger.info("model thumbnail skipped — no GLB yet", { modelId });
      return { modelId, status: "Skipped" as const };
    }
    const glbPath = model.glbPath;

    // Unique per triggering event: the preview is served from a STABLE proxy
    // URL (`/file/preview/...`), so reusing `{modelId}.png` would leave a
    // regenerated thumbnail showing the browser-cached old image, and the
    // assembler's job store would answer a repeat job id with the last result.
    const run = event.id ?? event.ts ?? "run";
    const thumbnailPath = `${companyId}/thumbnails/${modelId}/${modelId}-${run}.png`;

    await runAssemblerJob(step, {
      idPrefix: "thumbnail",
      action: "thumbnail",
      jobId: `thumbnail-${modelId}-${run}`,
      maxWaitMs: MAX_THUMBNAIL_WAIT_MS,
      logger,
      buildBody: async () => {
        const client = getCarbonServiceRole();
        const signed = await storage(client)
          .company(companyId)
          .createSignedUrl(glbPath, SIGNED_URL_EXPIRY);
        if (signed.error) {
          if (/not.?found/i.test(signed.error.message)) {
            throw new NonRetriableError(
              `Model GLB no longer exists in storage: ${glbPath}`
            );
          }
          throw new Error(`Failed to sign GLB URL: ${signed.error.message}`);
        }
        return {
          source: { url: internalizeStorageUrl(signed.data.signedUrl) },
          output: { path: thumbnailPath, ...(direction && { direction }) }
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const upload = await storage(client)
          .company(companyId)
          .createSignedUploadUrl(thumbnailPath, { upsert: true });
        if (upload.error) {
          throw new Error(
            `Failed to sign thumbnail upload URL: ${upload.error.message}`
          );
        }
        return { thumbnail: internalizeStorageUrl(upload.data.signedUrl) };
      }
    });

    await step.run("persist", async () => {
      const client = getCarbonServiceRole();
      // The upload goes through a late-minted URL: confirm it landed before repointing.
      const uploaded = await storage(client)
        .company(companyId)
        .info(thumbnailPath);
      if (uploaded.error) {
        throw new Error(
          `Thumbnail was not uploaded to ${thumbnailPath}: ${uploaded.error.message}`
        );
      }
      const result = await client
        .from("modelUpload")
        .update({ thumbnailPath })
        .eq("id", modelId)
        .eq("companyId", companyId);
      if (result.error) {
        throw new Error(
          `Failed to update thumbnail path: ${result.error.message}`
        );
      }

      // Drop the superseded thumbnail (best-effort — never fail the run over it).
      if (model.previousPath && model.previousPath !== thumbnailPath) {
        const removed = await storage(client)
          .company(companyId)
          .remove([model.previousPath])
          .catch((error: unknown) => ({ error }));
        if (removed.error) {
          logger.warn("failed to remove the superseded thumbnail", {
            modelId,
            path: model.previousPath,
            error: removed.error
          });
        }
      }
    });

    return { modelId, status: "Success" as const };
  }
);
