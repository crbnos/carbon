// Pull the CAD model for ONE Carbon item already linked to an Onshape element.
//
// The create and link flows need this: the spec has both pulling the item's
// assets immediately, and neither could — the routes write the mapping rows and
// stop, so an item created from a released revision arrives with no geometry
// while the same part imported through a BOM arrives with it. Same pipeline,
// two different results, decided by which button the user pressed.
//
// It is a JOB rather than inline work in the request because an export is a
// translate-poll-download round trip against Onshape: minutes in the worst
// case, and rate-limitable, which is exactly what a request must not be.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeClient, getOnshapeV2Settings } from "@carbon/ee/onshape";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { z } from "zod";
import { inngest } from "../../client";
import { withRateLimitRetry } from "./onshape-backfill";
import { pullOnshapeDrawingsForDocument } from "./onshape-drawings";
import { pullOnshapeAssetsForElement } from "./onshape-v2-assets";

const PayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  itemId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  partId: z.string().nullable().optional(),
  configuration: z.string().nullable().optional(),
  assetBaseName: z.string(),
  /** The released revision, so a drawing lands on the right family member. */
  revision: z.string().nullable().optional()
});

/** How many refusals to name in one notification before it stops reading. */
const MAX_REPORTED_SKIPS = 5;

export const onshapeV2ItemAssetsFunction = inngest.createFunction(
  {
    id: "onshape-v2-item-assets",
    // Every 429 reschedule consumes one retry.
    retries: 10,
    // One pull at a time per item: two would export the same geometry twice
    // and race on the modelUpload row.
    concurrency: { key: "event.data.itemId", limit: 1 }
  },
  { event: "carbon/onshape-v2-item-assets" },
  async ({ event, step }) => {
    const payload = PayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Re-read every execution, so switching a company back to legacy also
    // kills an in-flight retry.
    const settings = await getOnshapeV2Settings(carbon, payload.companyId);
    if (settings.readFailed) {
      throw new Error(
        "Could not read the Onshape integration settings; retrying."
      );
    }
    if (!settings.isV2) {
      return { skipped: true as const, reason: "pipeline-not-v2" };
    }

    return await step.run("pull-assets", async () => {
      const connection = await getOnshapeClient(
        carbon,
        payload.companyId,
        payload.userId
      );
      if (!connection.client) {
        throw new Error(connection.error ?? "Onshape is not connected");
      }

      const pulled = await withRateLimitRetry(
        () =>
          pullOnshapeAssetsForElement(carbon, connection.client, {
            companyId: payload.companyId,
            userId: payload.userId,
            documentId: payload.documentId,
            versionId: payload.versionId,
            elementId: payload.elementId,
            targets: [
              {
                itemId: payload.itemId,
                partId: payload.partId ?? null,
                configuration: payload.configuration ?? null,
                assetBaseName: payload.assetBaseName
              }
            ]
          }),
        `assets for item ${payload.itemId}`
      );

      for (const ok of pulled.attached) {
        await trigger("model-optimize", {
          companyId: payload.companyId,
          modelUploadId: ok.modelUploadId,
          userId: payload.userId
        });
      }

      // The drawing, in the same run — same reasoning as the model above: an
      // item created from Onshape should arrive complete rather than needing a
      // second journey through a different surface.
      const drawings = await withRateLimitRetry(
        () =>
          pullOnshapeDrawingsForDocument(carbon, connection.client, {
            companyId: payload.companyId,
            userId: payload.userId,
            documentId: payload.documentId,
            versionId: payload.versionId,
            targets: [
              {
                elementId: payload.elementId,
                itemId: payload.itemId,
                revision: payload.revision ?? undefined,
                assetBaseName: payload.assetBaseName
              }
            ]
          }),
        `drawings for item ${payload.itemId}`
      );

      // This job had NO reporting channel: it returned skippedTargets and
      // nobody read them, so a refusal here died in the Inngest log. Create and
      // link are user-initiated, so there is a real person to tell.
      const reasons = [
        ...pulled.skipped.map((entry) => entry.reason),
        ...drawings.skipped.map((entry) => entry.reason)
      ];
      if (reasons.length > 0 && payload.userId && payload.userId !== "system") {
        try {
          await trigger("notify", {
            event: NotificationEvent.IntegrationSync,
            companyId: payload.companyId,
            documentId: "onshape",
            title: `Onshape sync for ${payload.assetBaseName} needs attention`,
            body: reasons.slice(0, MAX_REPORTED_SKIPS).join("; "),
            recipient: { type: "user", userId: payload.userId }
          });
        } catch (error) {
          console.error(
            `[ONSHAPE V2 ITEM ASSETS] ${payload.companyId}: could not notify ${payload.userId}`,
            error
          );
        }
      }

      return {
        skipped: false as const,
        attached: pulled.attached.length,
        drawingsAttached: drawings.attached.length,
        skippedTargets: pulled.skipped,
        skippedDrawings: drawings.skipped
      };
    });
  }
);
