// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Manual inspections: a lot made by hand for tracked entities of one item,
// which holds them until it is decided, cancelled or deleted. Public through
// `./quality.ts`.
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { withTransaction } from "./client.ts";
import { RoundingMode, round } from "./precision.ts";
import {
  errResult,
  INSPECTION_CLOSED_STATUSES,
  isInspectionClosed,
  type Result
} from "./quality-core.ts";
import {
  insertLotSamplingPlans,
  insertPrefilledSamples,
  resolveLotSamplingPlans
} from "./quality-sampling.ts";
import { getNextSequence } from "./sequence.ts";

export type ManualInspectionInput = {
  trackedEntityIds: string[];
  inspectionDocumentId?: string | null;
  workCenterId?: string | null;
  assignee?: string | null;
  notes?: string | null;
  companyId: string;
  userId: string;
};

// -------------------------------------------------------------
// Manual inspection
// -------------------------------------------------------------
// A person inspects specific tracked entities of one item: a quality hold on
// stock already on hand, a re-check, a customer complaint. The entities go On
// Hold until a sample verdict or the disposition releases (Accept) or rejects
// them, exactly as a receipt lot's do. The lot has no source document of its
// own, so it is its own: sourceDocumentId is the lot's id.

const MANUAL_INSPECTION_ENTITY_STATUSES = ["Available", "On Hold"] as const;

export async function createManualInspection(
  db: Kysely<KyselyDatabase>,
  args: ManualInspectionInput
): Promise<Result<{ id: string; inspectionId: string }>> {
  const trackedEntityIds = [...new Set(args.trackedEntityIds.filter(Boolean))];
  if (trackedEntityIds.length === 0) {
    return errResult("Select at least one tracked entity");
  }

  try {
    const result = await withTransaction(db, async (trx) => {
      const entities = await trx
        .selectFrom("trackedEntity")
        .select([
          "id",
          "itemId",
          "status",
          "quantity",
          "readableId",
          "attributes"
        ])
        .where("id", "in", trackedEntityIds)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .execute();
      if (entities.length !== trackedEntityIds.length) {
        throw new Error("A tracked entity could not be found");
      }

      const itemIds = new Set(entities.map((e) => e.itemId));
      const itemId = entities[0]?.itemId;
      if (itemIds.size !== 1 || !itemId) {
        throw new Error("Every tracked entity must be of the same item");
      }

      const unavailable = entities.filter(
        (e) =>
          !(MANUAL_INSPECTION_ENTITY_STATUSES as readonly string[]).includes(
            e.status
          )
      );
      if (unavailable.length > 0) {
        throw new Error(
          `Only Available or On Hold entities can be inspected: ${unavailable
            .map((e) => e.readableId ?? e.id)
            .join(", ")}`
        );
      }

      // An entity is inspected by one open lot at a time: another lot's verdict
      // would release or reject it under this one.
      const inOpenManualLot = await trx
        .selectFrom("inspectionTrackedEntity as ite")
        .innerJoin("inspection", "inspection.id", "ite.inspectionId")
        .select(["ite.trackedEntityId", "inspection.inspectionId"])
        .where("ite.trackedEntityId", "in", trackedEntityIds)
        .where("ite.companyId", "=", args.companyId)
        .where("inspection.status", "not in", [...INSPECTION_CLOSED_STATUSES])
        .execute();
      const receiptLineIds = [
        ...new Set(
          entities
            .map(
              (e) =>
                (e.attributes as Record<string, unknown> | null)?.[
                  "Receipt Line"
                ]
            )
            .filter((id): id is string => typeof id === "string" && !!id)
        )
      ];
      const inOpenReceiptLot =
        receiptLineIds.length > 0
          ? await trx
              .selectFrom("inspection")
              .select(["inspectionId"])
              .where("sourceDocument", "=", "Receipt")
              .where("sourceDocumentLineId", "in", receiptLineIds)
              .where("companyId", "=", args.companyId)
              .where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
              .execute()
          : [];
      const openLots = [
        ...new Set([
          ...inOpenManualLot.map((row) => row.inspectionId),
          ...inOpenReceiptLot.map((row) => row.inspectionId)
        ])
      ];
      if (openLots.length > 0) {
        throw new Error(
          `These entities are already in an open inspection: ${openLots.join(", ")}`
        );
      }

      const item = await trx
        .selectFrom("item")
        .select(["readableIdWithRevision", "itemTrackingType"])
        .where("id", "=", itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!item) throw new Error("Item not found");

      if (args.inspectionDocumentId) {
        const document = await trx
          .selectFrom("inspectionDocument")
          .select(["id", "partId", "status"])
          .where("id", "=", args.inspectionDocumentId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        if (!document) throw new Error("Inspection plan not found");
        if (document.partId !== itemId) {
          throw new Error("This inspection plan is not for this item");
        }
        if (document.status !== "Active") {
          throw new Error("Only an active inspection plan can be used");
        }
      }

      if (args.assignee) {
        const member = await trx
          .selectFrom("userToCompany")
          .select(["userId"])
          .where("userId", "=", args.assignee)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        if (!member) throw new Error("Assignee not found");
      }

      // A serial lot is one unit per entity; a batch lot is the quantity the
      // batches hold, in whole units (the sampling tables take a count).
      const lotSize = Math.max(
        1,
        item.itemTrackingType === "Serial"
          ? entities.length
          : round(
              entities.reduce((sum, e) => sum + Number(e.quantity ?? 0), 0),
              0,
              RoundingMode.Down
            )
      );

      const { samplingStandard, plan, snapshot, featurePlans } =
        await resolveLotSamplingPlans(trx, {
          inspectionDocumentId: args.inspectionDocumentId ?? null,
          lotSize,
          companyId: args.companyId
        });

      const readableInspectionId = await getNextSequence(
        trx,
        "inspection",
        args.companyId
      );

      const { id } = await sql<{
        id: string;
      }>`SELECT id() AS id`
        .execute(trx)
        .then((r) => r.rows[0]!);

      await trx
        .insertInto("inspection")
        .values({
          id,
          inspectionId: readableInspectionId,
          sourceDocument: "Manual",
          sourceDocumentId: id,
          sourceDocumentLineId: null,
          sourceDocumentReadableId: null,
          itemId,
          itemReadableId: item.readableIdWithRevision ?? null,
          supplierId: null,
          workCenterId: args.workCenterId || null,
          assignee: args.assignee || null,
          notes: args.notes?.trim() || null,
          lotSize,
          samplingStandard,
          samplingPlanType: plan.type,
          sampleSize:
            featurePlans.length > 0
              ? Math.max(...featurePlans.map((p) => p.resolved.sampleSize))
              : snapshot.sampleSize,
          acceptanceNumber: snapshot.acceptance,
          rejectionNumber: snapshot.rejection,
          aql: plan.aql ?? null,
          inspectionLevel: plan.inspectionLevel ?? null,
          severity: plan.severity ?? null,
          codeLetter: snapshot.codeLetter,
          inspectionDocumentId: args.inspectionDocumentId || null,
          status: "Pending",
          companyId: args.companyId,
          createdBy: args.userId
        })
        .execute();

      // Each entity remembers its status, so a cancel or delete gives it back.
      await trx
        .insertInto("inspectionTrackedEntity")
        .values(
          entities.map((entity) => ({
            inspectionId: id,
            trackedEntityId: entity.id,
            previousStatus: entity.status,
            companyId: args.companyId,
            createdBy: args.userId
          }))
        )
        .execute();

      await trx
        .updateTable("trackedEntity")
        .set({ status: "On Hold" })
        .where("id", "in", trackedEntityIds)
        .where("companyId", "=", args.companyId)
        .where("status", "=", "Available")
        .execute();

      // The person picked the serials to inspect, so each is a sample from the
      // start (Pending, no verdict): the grid shows a column per serial and
      // nothing is scanned. Receipt and job operation lots scan theirs instead.
      // A batch lot keeps the grid's anonymous columns.
      if (item.itemTrackingType === "Serial") {
        await insertPrefilledSamples(trx, {
          inspectionId: id,
          units: entities,
          companyId: args.companyId,
          userId: args.userId
        });
      }

      await insertLotSamplingPlans(trx, featurePlans, {
        inspectionId: id,
        companyId: args.companyId,
        userId: args.userId
      });

      return { id, inspectionId: readableInspectionId };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to create inspection"
    );
  }
}

// What a manual lot recorded: a verdict on a sample, a reading, a gauge, a
// disposition or a linked issue. A serial lot's Pending samples are made with
// it, so they are not activity.
async function manualInspectionActivity(
  trx: Transaction<KyselyDatabase>,
  inspectionId: string,
  companyId: string
): Promise<boolean> {
  const { rows } = await sql<{ active: boolean }>`
    SELECT
      EXISTS (SELECT 1 FROM "inspectionMeasurement"
              WHERE "inspectionId" = ${inspectionId} AND "companyId" = ${companyId})
      OR EXISTS (SELECT 1 FROM "inspectionSample"
                 WHERE "inspectionId" = ${inspectionId} AND "companyId" = ${companyId}
                   AND status <> 'Pending')
      OR EXISTS (SELECT 1 FROM "inspectionSamplingPlan"
                 WHERE "inspectionId" = ${inspectionId} AND "companyId" = ${companyId}
                   AND "gaugeId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "inspectionHistory"
                 WHERE "inspectionId" = ${inspectionId} AND "companyId" = ${companyId})
      OR EXISTS (SELECT 1 FROM "nonConformanceInspection"
                 WHERE "inspectionId" = ${inspectionId} AND "companyId" = ${companyId})
      AS active
  `.execute(trx);
  return rows[0]?.active === true;
}

// Locks an open manual lot for a cancel or delete.
async function lockOpenManualInspection(
  trx: Transaction<KyselyDatabase>,
  inspectionId: string,
  companyId: string
) {
  const inspection = await trx
    .selectFrom("inspection")
    .select(["id", "sourceDocument", "status"])
    .where("id", "=", inspectionId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!inspection) throw new Error("Inspection not found");
  if (inspection.sourceDocument !== "Manual") {
    throw new Error("Only a manual inspection can be cancelled or deleted");
  }
  if (isInspectionClosed(inspection.status)) {
    throw new Error("Inspection is closed");
  }
  return inspection;
}

// Gives each entity the lot still holds the status it had before the lot.
// An entity a sample verdict already moved off On Hold keeps that status.
// A lot made before the status was recorded releases to Available.
async function releaseManualInspectionEntities(
  trx: Transaction<KyselyDatabase>,
  inspectionId: string,
  companyId: string
) {
  await sql`
    UPDATE "trackedEntity" te
    SET status = COALESCE(ite."previousStatus", 'Available')
    FROM "inspectionTrackedEntity" ite
    WHERE ite."inspectionId" = ${inspectionId}
      AND ite."companyId" = ${companyId}
      AND te.id = ite."trackedEntityId"
      AND te."companyId" = ${companyId}
      AND te.status = 'On Hold'
  `.execute(trx);
}

/**
 * Delete a manual inspection that recorded nothing. Its entities return to
 * the status they had before it.
 */
export async function deleteManualInspection(
  db: Kysely<KyselyDatabase>,
  args: { inspectionId: string; companyId: string }
): Promise<Result<{ id: string }>> {
  try {
    await withTransaction(db, async (trx) => {
      await lockOpenManualInspection(trx, args.inspectionId, args.companyId);
      if (
        await manualInspectionActivity(trx, args.inspectionId, args.companyId)
      ) {
        throw new Error(
          "This inspection has recorded results. Cancel it instead."
        );
      }
      await releaseManualInspectionEntities(
        trx,
        args.inspectionId,
        args.companyId
      );
      await trx
        .deleteFrom("inspection")
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .execute();
    });
    return { data: { id: args.inspectionId }, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to delete inspection"
    );
  }
}

/**
 * Cancel an open manual inspection: it leaves the queue with no verdict, keeps
 * what it recorded, and its held entities return to their earlier status.
 */
export async function cancelManualInspection(
  db: Kysely<KyselyDatabase>,
  args: { inspectionId: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  try {
    await withTransaction(db, async (trx) => {
      await lockOpenManualInspection(trx, args.inspectionId, args.companyId);
      await releaseManualInspectionEntities(
        trx,
        args.inspectionId,
        args.companyId
      );
      await trx
        .updateTable("inspection")
        .set({
          status: "Cancelled",
          updatedBy: args.userId,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .execute();
    });
    return { data: { id: args.inspectionId }, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to cancel inspection"
    );
  }
}
