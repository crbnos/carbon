import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { z } from "zod";
import { inngest } from "../../client";
import { syncOnshapeElementAssetsToItem } from "./onshape-sync-element";

/**
 * Panel push asset sync: the push route has already created/linked the Carbon
 * item and its Onshape mapping; this job does the slow part — GLTF export,
 * poll, download, thumbnail — with the same pipeline the release sync uses,
 * then hands the raw model to the assembler. Workspace-scoped exports are the
 * norm here (a push usually happens from the live workspace, not a version).
 *
 * Quota note: every execution spends live Onshape calls (translate + polls +
 * download + thumbnail), so retries are kept low and concurrency per item is 1.
 */
const OnshapePanelSyncPayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  itemId: z.string(),
  documentId: z.string(),
  wvm: z.enum(["w", "v"]),
  wvmId: z.string(),
  elementId: z.string(),
  elementKind: z.enum(["partstudio", "assembly"]),
  partId: z.string().optional(),
  assetBaseName: z.string().optional()
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

    const result = await step.run("sync-element-assets", () =>
      syncOnshapeElementAssetsToItem(carbon, {
        companyId: payload.companyId,
        userId: payload.userId,
        itemId: payload.itemId,
        sourceDocument: "Part",
        documentId: payload.documentId,
        versionId: payload.wvmId,
        sourceWvm: payload.wvm,
        partIds: payload.partId,
        modelElementId: payload.elementId,
        modelElementKind: payload.elementKind,
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
