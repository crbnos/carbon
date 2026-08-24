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
import {
  getOnshapeClient,
  getOnshapeSettings,
  patchElementMappingMetadata
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { z } from "zod";
import { inngest } from "../../client";
import { pullOnshapeAssetsForElement } from "./onshape-assets";
import { pullOnshapeDrawingsForDocument } from "./onshape-drawings";
import { withRateLimitRetry } from "./onshape-shared";

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

export const onshapeItemAssetsFunction = inngest.createFunction(
  {
    id: "onshape-item-assets",
    // Every 429 reschedule consumes one retry.
    retries: 10,
    // One pull at a time per item: two would export the same geometry twice
    // and race on the modelUpload row.
    concurrency: { key: "event.data.itemId", limit: 1 },
    /**
     * Close the progress marker when every retry is spent — see the same
     * handler on `onshape-bom-import`. A part created from a Part Studio body
     * has no bill of materials, so THIS job is the only thing the create modal
     * has to wait on, and a run that dies without an ending leaves it spinning
     * until the staleness cap.
     */
    onFailure: async ({ event }) => {
      const failed = event.data.event.data as {
        companyId?: string;
        itemId?: string;
      };
      if (!failed?.companyId || !failed?.itemId) return;

      try {
        await patchElementMappingMetadata(getCarbonServiceRole(), {
          companyId: failed.companyId,
          itemId: failed.itemId,
          patch: {
            progress: {
              stage: undefined,
              done: undefined,
              total: undefined,
              failedAt: new Date().toISOString(),
              error: event.data.error.message
            }
          }
        });
      } catch (error) {
        console.error(
          `[ONSHAPE ITEM ASSETS] ${failed.companyId}: could not stamp the failure`,
          error
        );
      }
    }
  },
  { event: "carbon/onshape-item-assets" },
  async ({ event, step }) => {
    const payload = PayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    // Re-read every execution, so disconnecting Onshape also kills an
    // in-flight retry.
    const settings = await getOnshapeSettings(carbon, payload.companyId);
    if (settings.readFailed) {
      throw new Error(
        "Could not read the Onshape integration settings; retrying."
      );
    }
    // The `onshape` record itself is the opt-in: an absent or inactive one
    // means this company never connected Onshape.
    if (!settings.active) {
      return { skipped: true as const, reason: "integration-not-installed" };
    }

    /**
     * Move the progress marker on, for whoever is waiting on this item.
     *
     * Best-effort: a failed stamp costs the progress display, and throwing
     * would retry the whole export to fix a label.
     */
    const stage = async (name: "assets" | "drawings") => {
      try {
        await patchElementMappingMetadata(carbon, {
          companyId: payload.companyId,
          itemId: payload.itemId,
          patch: { progress: { stage: name } }
        });
      } catch (error) {
        console.error(
          `[ONSHAPE ITEM ASSETS] ${payload.companyId}: could not stamp stage ${name}`,
          error
        );
      }
    };

    const result = await step.run("pull-assets", async () => {
      await stage("assets");

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
      await stage("drawings");

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
            `[ONSHAPE ITEM ASSETS] ${payload.companyId}: could not notify ${payload.userId}`,
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

    // Close the marker so whoever is blocking on this item can stop. Its own
    // step, so a stamp that fails does not re-run the export it is reporting.
    await step.run("stamp-assets-finished", async () => {
      try {
        await patchElementMappingMetadata(carbon, {
          companyId: payload.companyId,
          itemId: payload.itemId,
          patch: {
            // No `startedAt`: this merges into the marker the dispatching route
            // opened rather than replacing it.
            progress: {
              stage: undefined,
              done: undefined,
              total: undefined,
              finishedAt: new Date().toISOString(),
              attentionCount:
                result.skipped === false
                  ? result.skippedTargets.length + result.skippedDrawings.length
                  : 0
            }
          }
        });
      } catch (error) {
        console.error(
          `[ONSHAPE ITEM ASSETS] ${payload.companyId}: could not stamp the marker`,
          error
        );
      }
      return null;
    });

    return result;
  }
);
