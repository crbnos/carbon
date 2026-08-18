// Onshape v2 release handling.
//
// One job for the whole `onshape.revision.created` event on a v2 company: it
// attaches the released geometry and, when configured to, brings the release
// into Carbon's engineering data. The legacy pipeline splits these across two
// jobs, which races — for a NEW revision the target item does not exist until
// the import creates it, so a parallel asset job resolves "revision-missing"
// and the model never lands. Doing both here, in order, removes the race.
//
// What makes it v2 rather than a copy of the legacy job: the Carbon part is
// resolved through the ELEMENT MAPPING, never by matching Onshape's part number
// against readableId. The mapping answers "which Carbon part family is this CAD
// thing"; the released revision letter then picks the member.
//
// The webhook cannot carry a partId (its payload has no such field), and one
// Part Studio holds many bodies behind ONE element id — so a Part Studio
// release is fanned out over every body whose revision matches, rather than
// assumed to be a single item.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getOnshapeClient,
  getOnshapeV2Settings,
  readItemIdsForElement,
  resolveBomRow
} from "@carbon/ee/onshape";
import { z } from "zod";
import { inngest } from "../../client";
import { withRateLimitRetry } from "./onshape-backfill";
import { runOnshapeReleaseImport } from "./onshape-release-import";
import { pullOnshapeAssetsForElement } from "./onshape-v2-assets";

const PayloadSchema = z.object({
  companyId: z.string(),
  userId: z.string(),
  messageId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  elementId: z.string(),
  elementType: z.number(),
  partNumber: z.string(),
  revisionId: z.string().optional(),
  releaseId: z.string().optional(),
  releaseName: z.string().optional(),
  revision: z.string().optional()
});

const ELEMENT_TYPE_DRAWING = 2;

export const onshapeReleaseV2Function = inngest.createFunction(
  {
    id: "onshape-release-v2",
    // Every 429 reschedule consumes a retry, and this job both exports and
    // imports.
    retries: 10,
    idempotency: "event.data.messageId",
    // One in-flight run per released element; different elements run freely.
    concurrency: { key: "event.data.elementId", limit: 1 }
  },
  { event: "carbon/onshape-release-v2" },
  async ({ event, step }) => {
    const payload = PayloadSchema.parse(event.data);
    const carbon = getCarbonServiceRole();

    const settings = await getOnshapeV2Settings(carbon, payload.companyId);
    if (settings.readFailed) {
      throw new Error(
        "Could not read the Onshape integration settings; retrying."
      );
    }
    if (!settings.isV2) {
      return { skipped: true as const, reason: "pipeline-not-v2" };
    }

    // A released DRAWING is its own element sharing the number of the model it
    // documents; it is never its own Carbon item. v1 attaches its PDF by
    // stripping the number to a shared suffix, which is disproved on real data
    // (RD-410, DRW-410 and PK-410 all reduce to "-410", matching five items
    // across two parts). Until a mapping-based mechanism exists, refuse rather
    // than guess which item the PDF belongs to.
    if (payload.elementType === ELEMENT_TYPE_DRAWING) {
      return { skipped: true as const, reason: "drawing-element" };
    }

    return await step.run("handle-release", async () => {
      const releasedRevision = payload.revision ?? "";

      const connection = await getOnshapeClient(
        carbon,
        payload.companyId,
        payload.userId
      );
      if (!connection.client) {
        throw new Error(connection.error ?? "Onshape is not connected");
      }
      const client = connection.client;

      // Recover the partId(s) the webhook cannot carry. A Part Studio release
      // fans out: N bodies behind one element id are N Carbon items.
      let onshapeCompanyId = settings.onshapeCompanyId;
      if (!onshapeCompanyId) {
        const companies = await client.getCompanies();
        onshapeCompanyId = Array.isArray(companies)
          ? (companies[0]?.id ?? null)
          : null;
      }

      const partIds: Array<string | null> = [];
      if (onshapeCompanyId) {
        const revisions = await withRateLimitRetry(
          () =>
            client.getRevisions(
              onshapeCompanyId as string,
              payload.partNumber,
              payload.elementType
            ),
          `revisions for ${payload.partNumber}`
        );
        for (const item of revisions.items ?? []) {
          if (item.elementId !== payload.elementId) continue;
          if (item.revision !== releasedRevision) continue;
          partIds.push(item.partId ?? null);
        }
      }
      if (partIds.length === 0) partIds.push(null);

      const attached: string[] = [];
      const imported: string[] = [];
      const skipped: Array<{ partId: string | null; reason: string }> = [];

      for (const partId of partIds) {
        const ref = {
          documentId: payload.documentId,
          elementId: payload.elementId,
          partId
        };

        const claimants = await readItemIdsForElement(carbon, {
          companyId: payload.companyId,
          ref
        });

        if (claimants.length === 0) {
          // v2 never mints a part from a release. Creating items is the BOM
          // import's and the create flow's job, where a human chose the
          // replenishment and tracking a release cannot tell us.
          skipped.push({
            partId,
            reason:
              "No Carbon item is linked to this Onshape part. Link it, or import its assembly, first."
          });
          continue;
        }

        const items = await carbon
          .from("item")
          .select("id, readableId, revision")
          .in("id", claimants)
          .eq("companyId", payload.companyId);
        if (items.error) {
          throw new Error(
            `Failed to read linked items: ${items.error.message}`
          );
        }

        // Existence-checked: entityId has no FK to item, so a deleted item
        // leaves its mapping behind and would otherwise read as revision null.
        const live = items.data ?? [];
        if (live.length === 0) {
          skipped.push({
            partId,
            reason:
              "The Carbon item this Onshape part was linked to no longer exists."
          });
          continue;
        }

        const resolution = resolveBomRow(
          releasedRevision,
          live.map((i) => ({ itemId: i.id, revision: i.revision }))
        );

        let targetItemId: string | null =
          resolution.kind === "matched" ? resolution.itemId : null;

        if (!targetItemId && settings.releaseImportV2 !== "off") {
          // The release is NEW to Carbon. The family is known from the
          // mapping, so the importer is given that family's own readableId
          // rather than Onshape's part number — the join stays id-derived even
          // though the proven import path takes a number.
          const familyReadableId = live[0]?.readableId;
          if (familyReadableId && payload.releaseId) {
            const result = await runOnshapeReleaseImport(carbon, {
              companyId: payload.companyId,
              userId: payload.userId,
              messageId: payload.messageId,
              releaseId: payload.releaseId,
              partNumber: familyReadableId,
              documentId: payload.documentId,
              versionId: payload.versionId,
              elementId: payload.elementId,
              elementType: payload.elementType,
              revisionId: payload.revisionId,
              revision: releasedRevision,
              releaseName: payload.releaseName,
              onshapeCompanyId: onshapeCompanyId ?? undefined
            });
            if (result.imported) {
              imported.push(familyReadableId);
            } else if (result.skippedReason) {
              skipped.push({ partId, reason: result.skippedReason });
            }
          } else if (!payload.releaseId) {
            skipped.push({
              partId,
              reason:
                "The release event carried no releaseId, so its elements cannot be grouped into one change notice."
            });
          }
        }

        // Attach geometry to whichever item now represents this revision. A
        // still-missing target means the import was off or refused — reported,
        // not silently dropped.
        if (!targetItemId && settings.releaseImportV2 === "off") {
          skipped.push({
            partId,
            reason: `Carbon has this part but not at revision ${releasedRevision || "(initial)"}, and release import is off.`
          });
        }

        if (targetItemId && settings.attachAssetsOnRelease) {
          const pulled = await withRateLimitRetry(
            () =>
              pullOnshapeAssetsForElement(carbon, client, {
                companyId: payload.companyId,
                userId: payload.userId,
                documentId: payload.documentId,
                versionId: payload.versionId,
                elementId: payload.elementId,
                targets: [
                  {
                    itemId: targetItemId as string,
                    partId,
                    assetBaseName: releasedRevision
                      ? `${payload.partNumber}.${releasedRevision}`
                      : payload.partNumber
                  }
                ]
              }),
            `assets for ${payload.partNumber}`
          );
          for (const ok of pulled.attached) attached.push(ok.itemId);
          for (const bad of pulled.skipped) {
            skipped.push({ partId, reason: bad.reason });
          }
        }
      }

      return {
        skipped: false as const,
        attachedCount: attached.length,
        importedCount: imported.length,
        skippedDetails: skipped
      };
    });
  }
);
