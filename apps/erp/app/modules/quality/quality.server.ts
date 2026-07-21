import { sql } from "kysely";
import type { z } from "zod";

import { getDatabaseClient } from "~/services/database.server";
import type {
  inboundInspectionDispositionValidator,
  inboundInspectionSampleValidator
} from "./quality.models";

type Ok<T> = { data: T; error: null };
type Err = { data: null; error: { message: string; blockers?: unknown } };
export type Result<T> = Ok<T> | Err;

export function errResult(message: string, blockers?: unknown): Err {
  return { data: null, error: { message, ...(blockers ? { blockers } : {}) } };
}

// Mirrors the old in-service helper. Terminal states (Passed/Failed/Partial)
// are owned by the disposition path, so the per-sample recompute only flips
// between Pending and In Progress.
function computeLotStatus(
  samples: { status: string }[]
): "Pending" | "In Progress" {
  const inspected = samples.filter((s) => s.status !== "Pending").length;
  return inspected > 0 ? "In Progress" : "Pending";
}

// -------------------------------------------------------------
// 1. upsertInboundInspectionSample
// -------------------------------------------------------------
// Writes that must stay consistent:
//   - inboundInspectionSample (insert or update)
//   - trackedEntity.status (flip to Available or Rejected)
//   - trackedActivity + trackedActivityInput + trackedActivityOutput
//   - inboundInspection.status (recompute if non-terminal)

export async function upsertInboundInspectionSample(
  sample: z.infer<typeof inboundInspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
): Promise<Result<{ id: string }>> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inboundInspection")
        .select(["id", "status", "receiptId"])
        .where("id", "=", sample.inspectionId)
        .where("companyId", "=", sample.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");

      // Serial parts carry a tracked entity that may only be sampled once, so we
      // upsert by it. Batch / inventory / non-inventory parts have no entity —
      // each recorded result is a fresh anonymous sample.
      const trackedEntityId = sample.trackedEntityId || null;
      const existing = trackedEntityId
        ? await trx
            .selectFrom("inboundInspectionSample")
            .select(["id"])
            .where("trackedEntityId", "=", trackedEntityId)
            .executeTakeFirst()
        : undefined;

      const samplePayload = {
        inboundInspectionId: sample.inspectionId,
        trackedEntityId,
        status: sample.status,
        notes: sample.notes ?? null,
        inspectedBy: sample.inspectedBy,
        inspectedAt: nowIso,
        companyId: sample.companyId
      };

      let sampleId: string;
      if (existing) {
        const updated = await trx
          .updateTable("inboundInspectionSample")
          .set({
            ...samplePayload,
            updatedBy: sample.inspectedBy,
            updatedAt: nowIso
          })
          .where("id", "=", existing.id)
          .returning(["id"])
          .executeTakeFirstOrThrow();
        sampleId = updated.id;
      } else {
        const inserted = await trx
          .insertInto("inboundInspectionSample")
          .values({ ...samplePayload, createdBy: sample.inspectedBy })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        sampleId = inserted.id;
      }

      // Entity-level side effects only apply when a tracked entity is present
      // (serial parts). For anonymous samples the lot's disposition handles any
      // status changes.
      if (trackedEntityId) {
        const trackedEntityStatus =
          sample.status === "Passed" ? "Available" : "Rejected";
        await trx
          .updateTable("trackedEntity")
          .set({ status: trackedEntityStatus })
          .where("id", "=", trackedEntityId)
          .where("companyId", "=", sample.companyId)
          .execute();

        const activity = await trx
          .insertInto("trackedActivity")
          .values({
            type: "Inspect",
            sourceDocument: "Inbound Inspection",
            sourceDocumentId: sample.inspectionId,
            attributes: {
              Result: sample.status,
              Receipt: inspection.receiptId,
              Inspector: sample.inspectedBy,
              ...(sample.notes ? { Notes: sample.notes } : {})
            },
            companyId: sample.companyId,
            createdBy: sample.inspectedBy
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("trackedActivityInput")
          .values({
            trackedActivityId: activity.id,
            trackedEntityId,
            quantity: 0,
            companyId: sample.companyId,
            createdBy: sample.inspectedBy
          })
          .execute();
        await trx
          .insertInto("trackedActivityOutput")
          .values({
            trackedActivityId: activity.id,
            trackedEntityId,
            quantity: 0,
            companyId: sample.companyId,
            createdBy: sample.inspectedBy
          })
          .execute();
      }

      const isTerminal =
        inspection.status === "Passed" ||
        inspection.status === "Failed" ||
        inspection.status === "Partial";
      if (!isTerminal) {
        const samples = await trx
          .selectFrom("inboundInspectionSample")
          .select(["status"])
          .where("inboundInspectionId", "=", sample.inspectionId)
          .execute();
        const nextStatus = computeLotStatus(samples);
        if (nextStatus !== inspection.status) {
          await trx
            .updateTable("inboundInspection")
            .set({
              status: nextStatus,
              updatedBy: sample.inspectedBy,
              updatedAt: nowIso
            })
            .where("id", "=", sample.inspectionId)
            .execute();
        }
      }

      return { id: sampleId };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to save sample"
    );
  }
}

// -------------------------------------------------------------
// 2. dispositionInboundInspection
// -------------------------------------------------------------
// Writes:
//   - trackedEntity.status (bulk flip for Accept/Reject; nothing for Partial)
//   - inboundInspection (status, dispositionedBy/At, notes)
//   - inboundInspectionHistory (1 row for future plan auto-switching)

export async function dispositionInboundInspection(
  args: z.infer<typeof inboundInspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  }
): Promise<Result<{ id: string; status: string }>> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inboundInspection")
        .select([
          "id",
          "receiptLineId",
          "receiptId",
          "itemId",
          "status",
          "supplierId",
          "samplingStandard",
          "severity",
          "inspectionLevel",
          "aql",
          "lotSize",
          "sampleSize"
        ])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");

      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", inspection.itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      const receiptLine = await trx
        .selectFrom("receiptLine")
        .select(["locationId"])
        .where("id", "=", inspection.receiptLineId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      const lotEntities = await trx
        .selectFrom("trackedEntity")
        .select(["id"])
        .where(
          sql<string>`attributes ->> 'Receipt Line'`,
          "=",
          inspection.receiptLineId
        )
        .where("companyId", "=", args.companyId)
        .execute();

      const existingSamples = await trx
        .selectFrom("inboundInspectionSample")
        .select(["trackedEntityId", "status"])
        .where("inboundInspectionId", "=", args.id)
        .execute();

      const sampledIds = new Set(existingSamples.map((s) => s.trackedEntityId));
      const allLotIds = lotEntities.map((e) => e.id);
      const unsampledIds = allLotIds.filter((id) => !sampledIds.has(id));
      const failures = existingSamples.filter(
        (s) => s.status === "Failed"
      ).length;

      // Reject = entire lot non-conforming (ISO 9001:2015 §8.7). Accept only
      // releases un-sampled entities (sampled outcomes already flipped
      // per-sample). Partial leaves un-sampled entities On Hold.
      let lotStatus: "Passed" | "Failed" | "Partial";
      let idsToFlip: string[] = [];
      let flipStatus: "Available" | "Rejected" | null = null;
      switch (args.decision) {
        case "Accept":
          lotStatus = "Passed";
          idsToFlip = unsampledIds;
          flipStatus = "Available";
          break;
        case "Reject":
          lotStatus = "Failed";
          idsToFlip = allLotIds;
          flipStatus = "Rejected";
          break;
        case "Partial":
          lotStatus = "Partial";
          idsToFlip = [];
          flipStatus = null;
          break;
      }

      if (flipStatus && idsToFlip.length > 0) {
        await trx
          .updateTable("trackedEntity")
          .set({ status: flipStatus })
          .where("id", "in", idsToFlip)
          .where("companyId", "=", args.companyId)
          .execute();
      }

      // Non-tracked (Inventory) items have no tracked entities to flip, so the
      // received quantity sits in itemLedger with no per-row status to exclude
      // it from on-hand. Rejecting the lot must post a compensating
      // Negative Adjmt. to reverse the full received quantity. Tracked items
      // are already handled by the status flip above; Non-Inventory items never
      // posted a ledger entry at receipt, so neither needs this.
      if (
        args.decision === "Reject" &&
        inspection.status !== "Failed" &&
        item?.itemTrackingType === "Inventory" &&
        inspection.lotSize > 0
      ) {
        await trx
          .insertInto("itemLedger")
          .values({
            itemId: inspection.itemId,
            locationId: receiptLine?.locationId ?? null,
            entryType: "Negative Adjmt.",
            documentType: "Inbound Inspection",
            documentId: inspection.id,
            quantity: -inspection.lotSize,
            trackedEntityId: null,
            companyId: args.companyId,
            createdBy: args.dispositionedBy,
            comment: "Inbound inspection lot rejected"
          })
          .execute();
      }

      const updated = await trx
        .updateTable("inboundInspection")
        .set({
          status: lotStatus,
          notes: args.notes ?? null,
          dispositionedBy: args.dispositionedBy,
          dispositionedAt: nowIso,
          updatedBy: args.dispositionedBy,
          updatedAt: nowIso
        })
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .returning(["id", "status"])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("inboundInspectionHistory")
        .values({
          inboundInspectionId: args.id,
          itemId: inspection.itemId,
          supplierId: inspection.supplierId ?? null,
          samplingStandard: inspection.samplingStandard,
          severity: inspection.severity ?? "Normal",
          inspectionLevel: inspection.inspectionLevel ?? null,
          aql: inspection.aql ?? null,
          lotSize: inspection.lotSize,
          sampleSize: inspection.sampleSize,
          defectsFound: failures,
          outcome:
            args.decision === "Accept"
              ? "Accepted"
              : args.decision === "Reject"
                ? "Rejected"
                : "Partial",
          companyId: args.companyId,
          createdBy: args.dispositionedBy
        })
        .execute();

      return { id: updated.id, status: updated.status };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to disposition inspection"
    );
  }
}
