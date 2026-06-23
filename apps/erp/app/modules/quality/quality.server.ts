import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";

import { getDatabaseClient } from "~/services/database.server";
import type {
  inboundInspectionDispositionValidator,
  inboundInspectionSampleValidator
} from "./quality.models";

type Ok<T> = { data: T; error: null };
type Err = { data: null; error: { message: string; blockers?: unknown } };
type Result<T> = Ok<T> | Err;

function errResult(message: string, blockers?: unknown): Err {
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

// -------------------------------------------------------------
// 3. assignEntitiesToIssueItem
// -------------------------------------------------------------
// Writes:
//   - nonConformanceItemTrackedEntity (delete moved links, re-insert against target)
//   - nonConformanceItem (decrement source qty, increment target qty)

export async function assignEntitiesToIssueItem(args: {
  nonConformanceItemId: string;
  targetItemId: string;
  assignments: { trackedEntityId: string; quantity: number }[];
  companyId: string;
  userId: string;
}): Promise<Result<{ moved: number }>> {
  const { nonConformanceItemId, targetItemId, assignments, companyId, userId } =
    args;

  if (assignments.length === 0) {
    return errResult("No assignments provided");
  }

  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();
  const entityIds = assignments.map((a) => a.trackedEntityId);

  try {
    const result = await db.transaction().execute(async (trx) => {
      const source = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!source) throw new Error("Source item association not found");

      const target = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!target) throw new Error("Target item association not found");

      if (source.nonConformanceId !== target.nonConformanceId) {
        throw new Error("Cannot move entities between different NCRs");
      }

      const existingLinks = await trx
        .selectFrom("nonConformanceItemTrackedEntity")
        .select(["quantity"])
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      const existingQty = existingLinks.reduce(
        (acc, l) => acc + Number(l.quantity ?? 0),
        0
      );
      const movingQty = assignments.reduce(
        (acc, a) => acc + Number(a.quantity),
        0
      );

      await trx
        .deleteFrom("nonConformanceItemTrackedEntity")
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .insertInto("nonConformanceItemTrackedEntity")
        .values(
          assignments.map((a) => ({
            nonConformanceItemId: targetItemId,
            nonConformanceId: target.nonConformanceId,
            trackedEntityId: a.trackedEntityId,
            quantity: Number(a.quantity),
            companyId,
            createdBy: userId
          }))
        )
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: Math.max(0, Number(source.quantity ?? 0) - existingQty),
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: Number(target.quantity ?? 0) + movingQty,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .execute();

      return { moved: assignments.length };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to move entities"
    );
  }
}

// -------------------------------------------------------------
// 4. closeIssue
// -------------------------------------------------------------
// Validates disposition plan (qty sums, no Pending rows, no Consumed entities),
// then for each row with linked entities:
//   - insert trackedActivity + trackedActivityInput
//   - flip trackedEntity status (Use As Is / Rework → Available;
//     Scrap / Return to Supplier → Rejected and write a Negative Adjmt. ledger)
// Finally sets nonConformance.status = Closed.

type DispositionLink = {
  id: string;
  trackedEntityId: string;
  quantity: number;
  trackedEntityStatus: string | null;
};

type DispositionRow = {
  id: string;
  itemId: string;
  disposition: string | null;
  quantity: number;
  links: DispositionLink[];
};

type IssueClosureBlocker = { nonConformanceItemId: string; reason: string };

export async function closeIssue(
  client: SupabaseClient<Database>,
  args: { nonConformanceId: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  const { nonConformanceId, companyId, userId } = args;
  const db = getDatabaseClient();

  // Preflight reads via Supabase (uses nested selects / RLS-aware service role)
  const planResult = await (client as any)
    .from("nonConformanceItem")
    .select(
      `
        id,
        itemId,
        disposition,
        quantity,
        links:nonConformanceItemTrackedEntity(
          id,
          quantity,
          trackedEntityId,
          trackedEntity(
            id,
            status
          )
        )
      `
    )
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });

  if (planResult.error || !planResult.data) {
    return errResult("Failed to load disposition plan");
  }

  const plan: DispositionRow[] = (planResult.data as any[]).map((row) => ({
    id: row.id,
    itemId: row.itemId,
    disposition: row.disposition,
    quantity: Number(row.quantity ?? 0),
    links: (row.links ?? []).map((link: any) => ({
      id: link.id,
      trackedEntityId: link.trackedEntityId,
      quantity: Number(link.quantity ?? 0),
      trackedEntityStatus: link.trackedEntity?.status ?? null
    }))
  }));

  const blockers: IssueClosureBlocker[] = [];
  for (const row of plan) {
    if (row.links.length === 0) continue;
    if (!row.disposition || row.disposition === "Pending") {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: "Disposition is still Pending"
      });
      continue;
    }
    const sum = row.links.reduce((acc, l) => acc + l.quantity, 0);
    if (Math.abs(sum - row.quantity) > 1e-6) {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: `Linked entity quantity (${sum}) does not match row quantity (${row.quantity})`
      });
    }
    for (const link of row.links) {
      if (!link.trackedEntityStatus) {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: "Linked tracked entity is missing"
        });
      } else if (link.trackedEntityStatus === "Consumed") {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: `Tracked entity ${link.trackedEntityId} is already Consumed`
        });
      }
    }
  }

  if (blockers.length > 0) {
    return errResult(
      `Cannot close: ${blockers.map((b) => b.reason).join("; ")}`,
      blockers
    );
  }

  try {
    const result = await db.transaction().execute(async (trx) => {
      const issue = await trx
        .selectFrom("nonConformance")
        .select(["id", "nonConformanceId", "status", "locationId"])
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!issue) throw new Error("Issue not found");
      if (issue.status === "Closed") return { id: issue.id };

      const nowIso = new Date().toISOString();
      const today = nowIso.slice(0, 10);
      const readableNc = issue.nonConformanceId ?? nonConformanceId;
      const locationId = issue.locationId;

      for (const row of plan) {
        if (row.links.length === 0) continue;

        const activity = await trx
          .insertInto("trackedActivity")
          .values({
            type: "Disposition",
            sourceDocument: "Non-Conformance",
            sourceDocumentId: nonConformanceId,
            sourceDocumentReadableId: readableNc,
            attributes: {
              "Non-Conformance": nonConformanceId,
              Disposition: row.disposition ?? "",
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("trackedActivityInput")
          .values(
            row.links.map((link) => ({
              trackedActivityId: activity.id,
              trackedEntityId: link.trackedEntityId,
              quantity: link.quantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();

        if (row.disposition === "Use As Is" || row.disposition === "Rework") {
          const idsToFlip = row.links
            .filter((l) => l.trackedEntityStatus !== "Available")
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Available" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
          continue;
        }

        if (
          row.disposition === "Scrap" ||
          row.disposition === "Return to Supplier"
        ) {
          const commentSuffix =
            row.disposition === "Scrap" ? "scrap" : "return to supplier";

          await trx
            .insertInto("itemLedger")
            .values(
              row.links.map((link) => ({
                itemId: row.itemId,
                locationId,
                entryType: "Negative Adjmt." as const,
                documentType: "Non-Conformance" as const,
                documentId: nonConformanceId,
                quantity: -link.quantity,
                trackedEntityId: link.trackedEntityId,
                companyId,
                createdBy: userId,
                comment: `NC ${readableNc} ${commentSuffix}`
              }))
            )
            .execute();

          const idsToFlip = row.links
            .filter((l) => l.trackedEntityStatus !== "Rejected")
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Rejected" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      }

      const updated = await trx
        .updateTable("nonConformance")
        .set({
          status: "Closed",
          closeDate: today,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return { id: updated.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to close NCR"
    );
  }
}
