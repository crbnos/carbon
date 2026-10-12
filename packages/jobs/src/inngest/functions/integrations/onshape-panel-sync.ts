// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { z } from "zod";
import { inngest } from "../../client";
import {
  syncOnshapeDrawingAssetsToItem,
  syncOnshapeElementAssetsToItem
} from "./onshape-sync-element";

/**
 * Exports a pushed element's model, or a release drawing's PDF, onto the item
 * the push route already linked. Every run spends live Onshape calls, so
 * retries stay at 1 and concurrency at 1 per item.
 */
const OnshapePanelSyncPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  itemId: z.string(),
  documentId: z.string(),
  wvm: z.enum(["w", "v"]),
  wvmId: z.string(),
  elementId: z.string(),
  elementKind: z.enum(["partstudio", "assembly", "drawing"]),
  partId: z.string().optional(),
  configuration: z.string().optional(),
  assetBaseName: z.string().optional(),
  microversionId: z.string().optional()
});

export const onshapePanelSyncFunction = inngest.createFunction(
  {
    id: "onshape-panel-sync",
    retries: 1,
    concurrency: { key: "event.data.itemId", limit: 1 }
  },
  { event: "carbon/onshape-panel-sync" },
  async ({ event, step }) => {
    const payload = OnshapePanelSyncPayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();
    // Destructured so the narrowing below survives into the step closures.
    const { elementKind } = payload;

    if (elementKind === "drawing") {
      // Release pushes only; no model, so no optimize or thumbnail.
      return step.run("sync-drawing-assets", () =>
        syncOnshapeDrawingAssetsToItem(carbon, {
          companyId: payload.companyId,
          userId: payload.userId,
          // The panel pushes on its own connection.
          integrationId: ONSHAPE_V2_INTEGRATION_ID,
          itemId: payload.itemId,
          sourceDocument: "Part",
          documentId: payload.documentId,
          versionId: payload.wvmId,
          sourceWvm: payload.wvm,
          drawingElementId: payload.elementId,
          assetBaseName: payload.assetBaseName
        })
      );
    }

    const result = await step.run("sync-element-assets", () =>
      syncOnshapeElementAssetsToItem(carbon, {
        companyId: payload.companyId,
        userId: payload.userId,
        integrationId: ONSHAPE_V2_INTEGRATION_ID,
        itemId: payload.itemId,
        sourceDocument: "Part",
        documentId: payload.documentId,
        versionId: payload.wvmId,
        sourceWvm: payload.wvm,
        partId: payload.partId,
        configuration: payload.configuration,
        sourceMicroversionId: payload.microversionId,
        modelElementId: payload.elementId,
        modelElementKind: elementKind,
        assetBaseName: payload.assetBaseName
      })
    );

    if (result.modelUploadId) {
      await step.sendEvent("model-optimize", {
        name: "carbon/model-optimize" as const,
        data: {
          modelUploadId: result.modelUploadId,
          companyId: payload.companyId,
          userId: payload.userId
        }
      });
    }

    if (result.modelUploadId && !result.thumbnailAttached) {
      await step.sendEvent("model-thumbnail", {
        name: "carbon/model-thumbnail" as const,
        data: { companyId: payload.companyId, modelId: result.modelUploadId }
      });
    }

    return result;
  }
);
