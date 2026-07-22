import type { KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { z } from "zod";

import { getDatabaseClient } from "~/services/database.server";
import type {
  inspectionDispositionValidator,
  inspectionMeasurementValidator,
  inspectionSampleValidator
} from "./quality.models";
import type { SamplingStandard } from "./samplingStandards";
import { resolveFeatureSamplingPlan } from "./samplingStandards";

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

// Entity-level side effects of a sample verdict (serial parts only): flip the
// tracked entity's status and record the Inspect activity. Shared by the
// pass/fail sample path and the derived-status measurement path.
async function applySampleEntityStatus(
  trx: Transaction<KyselyDatabase>,
  args: {
    trackedEntityId: string;
    status: "Passed" | "Failed";
    inspectionId: string;
    // Receipt-sourced lots pass the receipt id for the activity's Receipt
    // attribute; other sources pass null.
    receiptId: string | null;
    notes: string | null;
    userId: string;
    companyId: string;
  }
) {
  const trackedEntityStatus =
    args.status === "Passed" ? "Available" : "Rejected";
  await trx
    .updateTable("trackedEntity")
    .set({ status: trackedEntityStatus })
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .execute();

  const activity = await trx
    .insertInto("trackedActivity")
    .values({
      type: "Inspect",
      sourceDocument: "Inbound Inspection",
      sourceDocumentId: args.inspectionId,
      attributes: {
        Result: args.status,
        ...(args.receiptId ? { Receipt: args.receiptId } : {}),
        Inspector: args.userId,
        ...(args.notes ? { Notes: args.notes } : {})
      },
      companyId: args.companyId,
      createdBy: args.userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("trackedActivityInput")
    .values({
      trackedActivityId: activity.id,
      trackedEntityId: args.trackedEntityId,
      quantity: 0,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
  await trx
    .insertInto("trackedActivityOutput")
    .values({
      trackedActivityId: activity.id,
      trackedEntityId: args.trackedEntityId,
      quantity: 0,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .execute();
}

// -------------------------------------------------------------
// 1. upsertInspectionSample
// -------------------------------------------------------------
// Writes that must stay consistent:
//   - inspectionSample (insert or update)
//   - trackedEntity.status (flip to Available or Rejected)
//   - trackedActivity + trackedActivityInput + trackedActivityOutput
//   - inspection.status (recompute if non-terminal)

export async function upsertInspectionSample(
  sample: z.infer<typeof inspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
): Promise<Result<{ id: string }>> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select(["id", "status", "sourceDocument", "sourceDocumentId"])
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
            .selectFrom("inspectionSample")
            .select(["id"])
            .where("trackedEntityId", "=", trackedEntityId)
            .executeTakeFirst()
        : undefined;

      const samplePayload = {
        inspectionId: sample.inspectionId,
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
          .updateTable("inspectionSample")
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
          .insertInto("inspectionSample")
          .values({ ...samplePayload, createdBy: sample.inspectedBy })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        sampleId = inserted.id;
      }

      // Entity-level side effects only apply when a tracked entity is present
      // (serial parts) and a verdict was recorded. Identify-only scans
      // (status "Pending") leave the entity On Hold until measurements derive
      // a verdict; anonymous samples are handled by the lot's disposition.
      if (trackedEntityId && sample.status !== "Pending") {
        await applySampleEntityStatus(trx, {
          trackedEntityId,
          status: sample.status,
          inspectionId: sample.inspectionId,
          receiptId:
            inspection.sourceDocument === "Receipt"
              ? inspection.sourceDocumentId
              : null,
          notes: sample.notes ?? null,
          userId: sample.inspectedBy,
          companyId: sample.companyId
        });
      }

      const isTerminal =
        inspection.status === "Passed" ||
        inspection.status === "Failed" ||
        inspection.status === "Partial";
      if (!isTerminal) {
        const samples = await trx
          .selectFrom("inspectionSample")
          .select(["status"])
          .where("inspectionId", "=", sample.inspectionId)
          .execute();
        const nextStatus = computeLotStatus(samples);
        if (nextStatus !== inspection.status) {
          await trx
            .updateTable("inspection")
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
// 2. dispositionInspection
// -------------------------------------------------------------
// Writes:
//   - trackedEntity.status (bulk flip for Accept/Reject; nothing for Partial)
//   - inspection (status, dispositionedBy/At, notes)
//   - inspectionHistory (1 row for future plan auto-switching)

export async function dispositionInspection(
  args: z.infer<typeof inspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  }
): Promise<Result<{ id: string; status: string }>> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
          "sourceDocument",
          "sourceDocumentId",
          "sourceDocumentLineId",
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
      const isReceiptSource = inspection.sourceDocument === "Receipt";

      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", inspection.itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      // Receipt-sourced lots: the received tracked entities and the receiving
      // location hang off the receipt line. Other sources have no lot entities
      // to flip (e.g. Job Operation inspections act on WIP, not received stock).
      const receiptLine =
        isReceiptSource && inspection.sourceDocumentLineId
          ? await trx
              .selectFrom("receiptLine")
              .select(["locationId"])
              .where("id", "=", inspection.sourceDocumentLineId)
              .where("companyId", "=", args.companyId)
              .executeTakeFirst()
          : undefined;

      const lotEntities =
        isReceiptSource && inspection.sourceDocumentLineId
          ? await trx
              .selectFrom("trackedEntity")
              .select(["id"])
              .where(
                sql<string>`attributes ->> 'Receipt Line'`,
                "=",
                inspection.sourceDocumentLineId
              )
              .where("companyId", "=", args.companyId)
              .execute()
          : [];

      const existingSamples = await trx
        .selectFrom("inspectionSample")
        .select(["trackedEntityId", "status"])
        .where("inspectionId", "=", args.id)
        .execute();

      const sampledIds = new Set(existingSamples.map((s) => s.trackedEntityId));
      const allLotIds = lotEntities.map((e) => e.id);
      const unsampledIds = allLotIds.filter((id) => !sampledIds.has(id));
      const failures = existingSamples.filter(
        (s) => s.status === "Failed"
      ).length;

      // Per-feature gating (document-driven lots). Each feature must meet its
      // own resolved sample size and acceptance number before Accept; Reject
      // requires a feature past its rejection number or a failed sample. Lots
      // without features keep the caller-side lot-level gating untouched.
      const lotFeatures = await trx
        .selectFrom("inspectionSamplingPlan")
        .select([
          "inspectionFeatureId",
          "sampleSize",
          "acceptanceNumber",
          "rejectionNumber"
        ])
        .where("inspectionId", "=", args.id)
        .execute();

      if (lotFeatures.length > 0) {
        const measurements = await trx
          .selectFrom("inspectionMeasurement")
          .select(["inspectionFeatureId", "status"])
          .where("inspectionId", "=", args.id)
          .execute();
        const countsByFeature = new Map<
          string,
          { recorded: number; failed: number }
        >();
        for (const m of measurements) {
          const counts = countsByFeature.get(m.inspectionFeatureId) ?? {
            recorded: 0,
            failed: 0
          };
          if (m.status !== "Pending") counts.recorded += 1;
          if (m.status === "Failed") counts.failed += 1;
          countsByFeature.set(m.inspectionFeatureId, counts);
        }

        if (args.decision === "Accept") {
          const blocking = lotFeatures.filter((f) => {
            const counts = countsByFeature.get(f.inspectionFeatureId) ?? {
              recorded: 0,
              failed: 0
            };
            return (
              counts.recorded < f.sampleSize ||
              counts.failed > f.acceptanceNumber
            );
          });
          if (blocking.length > 0) {
            throw new Error(
              "Cannot accept: sampling incomplete or acceptance number exceeded for one or more characteristics"
            );
          }
        }

        if (args.decision === "Reject") {
          const rejectable =
            lotFeatures.some((f) => {
              const counts = countsByFeature.get(f.inspectionFeatureId);
              return counts != null && counts.failed >= f.rejectionNumber;
            }) || existingSamples.some((s) => s.status === "Failed");
          if (!rejectable) {
            throw new Error(
              "Cannot reject: no characteristic has reached its rejection number and no sample has failed"
            );
          }
        }
      }

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
        isReceiptSource &&
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
        .updateTable("inspection")
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
        .insertInto("inspectionHistory")
        .values({
          inspectionId: args.id,
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
// 3. Measurements (document-driven lots)
// -------------------------------------------------------------

function parseSpecNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

// Pure valuation of one reading against the live feature spec. Measurement
// features with a parseable nominal are judged numerically inside
// [nominal - |tol-|, nominal + |tol+|]; everything else (attribute features,
// GD&T strings that don't parse) is a pass/fail toggle.
export function valuateMeasurement(
  feature: {
    type: string;
    nominalValue: string | null;
    tolerancePlus: string | null;
    toleranceMinus: string | null;
  },
  value: number | null,
  passed?: boolean | null
): "Pending" | "Passed" | "Failed" {
  const nominal =
    feature.type === "Measurement"
      ? parseSpecNumber(feature.nominalValue)
      : null;

  if (feature.type === "Measurement" && nominal !== null) {
    if (value == null) return "Pending";
    const tolPlus = Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
    const tolMinus = Math.abs(parseSpecNumber(feature.toleranceMinus) ?? 0);
    return value >= nominal - tolMinus && value <= nominal + tolPlus
      ? "Passed"
      : "Failed";
  }

  if (passed == null) return "Pending";
  return passed ? "Passed" : "Failed";
}

// Records one cell of the features x samples grid. Valuates the reading,
// upserts the measurement, derives the sample's status from its required
// measurements (strict: no override), applies serial-entity side effects on
// status transitions, and recomputes the non-terminal lot status.
export async function upsertInspectionMeasurement(
  args: z.infer<typeof inspectionMeasurementValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<
  Result<{
    sampleId: string;
    measurementId: string;
    measurementStatus: string;
    sampleStatus: string;
  }>
> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select(["id", "status", "sourceDocument", "sourceDocumentId"])
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      if (inspection.status === "Passed" || inspection.status === "Failed") {
        throw new Error("Inspection is closed");
      }

      const feature = await trx
        .selectFrom("inspectionFeature")
        .select([
          "id",
          "type",
          "nominalValue",
          "tolerancePlus",
          "toleranceMinus"
        ])
        .where("id", "=", args.inspectionFeatureId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!feature) throw new Error("Inspection feature not found");

      // Resolve or create the sample (anonymous columns are created on the
      // first measurement recorded against them).
      let sample: {
        id: string;
        trackedEntityId: string | null;
        status: string;
      };
      if (args.sampleId) {
        const existing = await trx
          .selectFrom("inspectionSample")
          .select(["id", "trackedEntityId", "status", "inspectionId"])
          .where("id", "=", args.sampleId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        if (!existing || existing.inspectionId !== args.inspectionId) {
          throw new Error("Sample not found");
        }
        sample = existing;
      } else {
        const inserted = await trx
          .insertInto("inspectionSample")
          .values({
            inspectionId: args.inspectionId,
            trackedEntityId: null,
            status: "Pending",
            companyId: args.companyId,
            createdBy: args.userId
          })
          .returning(["id", "trackedEntityId", "status"])
          .executeTakeFirstOrThrow();
        sample = inserted;
      }

      const numericValue =
        args.value != null && args.value !== "" ? Number(args.value) : null;
      if (numericValue != null && Number.isNaN(numericValue)) {
        throw new Error("Value must be a number");
      }
      const passed = args.passed != null ? args.passed === "true" : null;

      const measurementStatus = valuateMeasurement(
        feature,
        numericValue,
        passed
      );

      const existingMeasurement = await trx
        .selectFrom("inspectionMeasurement")
        .select(["id"])
        .where("inspectionSampleId", "=", sample.id)
        .where("inspectionFeatureId", "=", feature.id)
        .executeTakeFirst();

      const measurementPayload = {
        value: numericValue,
        status: measurementStatus,
        notes: args.notes ?? null,
        inspectedBy: measurementStatus !== "Pending" ? args.userId : null,
        inspectedAt: measurementStatus !== "Pending" ? nowIso : null
      };

      let measurementId: string;
      if (existingMeasurement) {
        const updated = await trx
          .updateTable("inspectionMeasurement")
          .set({
            ...measurementPayload,
            updatedBy: args.userId,
            updatedAt: nowIso
          })
          .where("id", "=", existingMeasurement.id)
          .returning(["id"])
          .executeTakeFirstOrThrow();
        measurementId = updated.id;
      } else {
        const inserted = await trx
          .insertInto("inspectionMeasurement")
          .values({
            ...measurementPayload,
            inspectionId: args.inspectionId,
            inspectionSampleId: sample.id,
            inspectionFeatureId: feature.id,
            companyId: args.companyId,
            createdBy: args.userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        measurementId = inserted.id;
      }

      // Derive the sample's status. The sample's 1-based column index decides
      // which features are required for it (a feature with n=8 needs readings
      // on the first 8 samples only).
      const lotFeatures = await trx
        .selectFrom("inspectionSamplingPlan")
        .select(["inspectionFeatureId", "sampleSize"])
        .where("inspectionId", "=", args.inspectionId)
        .execute();
      const lotSamples = await trx
        .selectFrom("inspectionSample")
        .select(["id"])
        .where("inspectionId", "=", args.inspectionId)
        .orderBy("createdAt", "asc")
        .orderBy("id", "asc")
        .execute();
      const columnIndex = lotSamples.findIndex((s) => s.id === sample.id) + 1;
      const sampleMeasurements = await trx
        .selectFrom("inspectionMeasurement")
        .select(["inspectionFeatureId", "status"])
        .where("inspectionSampleId", "=", sample.id)
        .execute();

      const requiredFeatureIds = lotFeatures
        .filter((f) => f.sampleSize >= columnIndex)
        .map((f) => f.inspectionFeatureId);
      const anyFailed = sampleMeasurements.some((m) => m.status === "Failed");
      const allRequiredPassed =
        requiredFeatureIds.length > 0 &&
        requiredFeatureIds.every(
          (featureId) =>
            sampleMeasurements.find((m) => m.inspectionFeatureId === featureId)
              ?.status === "Passed"
        );
      const derivedStatus: "Pending" | "Passed" | "Failed" = anyFailed
        ? "Failed"
        : allRequiredPassed
          ? "Passed"
          : "Pending";

      if (derivedStatus !== sample.status) {
        await trx
          .updateTable("inspectionSample")
          .set({
            status: derivedStatus,
            inspectedBy: derivedStatus !== "Pending" ? args.userId : null,
            inspectedAt: derivedStatus !== "Pending" ? nowIso : null,
            updatedBy: args.userId,
            updatedAt: nowIso
          })
          .where("id", "=", sample.id)
          .execute();

        if (sample.trackedEntityId) {
          if (derivedStatus === "Pending") {
            // Revert (e.g. corrected typo): back On Hold, no activity row.
            await trx
              .updateTable("trackedEntity")
              .set({ status: "On Hold" })
              .where("id", "=", sample.trackedEntityId)
              .where("companyId", "=", args.companyId)
              .execute();
          } else {
            await applySampleEntityStatus(trx, {
              trackedEntityId: sample.trackedEntityId,
              status: derivedStatus,
              inspectionId: args.inspectionId,
              receiptId:
                inspection.sourceDocument === "Receipt"
                  ? inspection.sourceDocumentId
                  : null,
              notes: args.notes ?? null,
              userId: args.userId,
              companyId: args.companyId
            });
          }
        }
      }

      // Passed/Failed already threw above, so Partial is the only terminal
      // status left to guard against.
      const isTerminal = inspection.status === "Partial";
      if (!isTerminal) {
        const samples = await trx
          .selectFrom("inspectionSample")
          .select(["status"])
          .where("inspectionId", "=", args.inspectionId)
          .execute();
        const nextStatus = computeLotStatus(samples);
        if (nextStatus !== inspection.status) {
          await trx
            .updateTable("inspection")
            .set({
              status: nextStatus,
              updatedBy: args.userId,
              updatedAt: nowIso
            })
            .where("id", "=", args.inspectionId)
            .execute();
        }
      }

      return {
        sampleId: sample.id,
        measurementId,
        measurementStatus,
        sampleStatus: derivedStatus
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to save measurement"
    );
  }
}

// -------------------------------------------------------------
// 4. reconcileInspectionSamplingPlans
// -------------------------------------------------------------
// The lot references its inspection document live, so features added to the
// document after receipt need per-lot plan rows resolved lazily. Rows whose
// live feature was deleted are left in place (the grid ignores them).

export async function reconcileInspectionSamplingPlans(
  inspectionId: string,
  companyId: string
): Promise<Result<{ added: number }>> {
  const db = getDatabaseClient();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
          "inspectionDocumentId",
          "itemId",
          "lotSize",
          "samplingStandard",
          "createdBy"
        ])
        .where("id", "=", inspectionId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      if (!inspection.inspectionDocumentId) return { added: 0 };

      const documentFeatures = await trx
        .selectFrom("inspectionFeature")
        .select([
          "id",
          "samplingPlanType",
          "samplingSampleSize",
          "samplingPercentage",
          "samplingAql",
          "samplingInspectionLevel",
          "samplingSeverity"
        ])
        .where("inspectionDocumentId", "=", inspection.inspectionDocumentId)
        .where("companyId", "=", companyId)
        .execute();

      const existingRows = await trx
        .selectFrom("inspectionSamplingPlan")
        .select(["inspectionFeatureId"])
        .where("inspectionId", "=", inspectionId)
        .execute();
      const existingIds = new Set(
        existingRows.map((r) => r.inspectionFeatureId)
      );
      const missing = documentFeatures.filter((f) => !existingIds.has(f.id));
      if (missing.length === 0) return { added: 0 };

      const itemPlan = await trx
        .selectFrom("itemSamplingPlan")
        .select([
          "type",
          "sampleSize",
          "percentage",
          "aql",
          "inspectionLevel",
          "severity"
        ])
        .where("itemId", "=", inspection.itemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();

      const inserts = missing.map((feature) => {
        const resolved = resolveFeatureSamplingPlan(
          feature,
          itemPlan ?? null,
          Number(inspection.lotSize),
          inspection.samplingStandard as SamplingStandard
        );
        return {
          inspectionId,
          inspectionFeatureId: feature.id,
          sampleSize: resolved.sampleSize,
          acceptanceNumber: resolved.acceptance,
          rejectionNumber: resolved.rejection,
          codeLetter: resolved.codeLetter,
          companyId,
          // Never NULL into a NOT NULL audit column: fall back to the lot's
          // creator (post-receipt's userId).
          createdBy: inspection.createdBy
        };
      });

      await trx.insertInto("inspectionSamplingPlan").values(inserts).execute();
      return { added: inserts.length };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to reconcile features"
    );
  }
}

// -------------------------------------------------------------
// 5. changeInspectionDocument
// -------------------------------------------------------------
// Swaps (or clears) the document assigned to an open lot. Only allowed while
// the lot is non-terminal and no measurements have been recorded — recorded
// readings belong to the old document's features. The per-lot plan rows are
// wiped; the next loader pass reconciles rows for the new document.

export async function changeInspectionDocument(args: {
  inspectionId: string;
  inspectionDocumentId: string | null;
  companyId: string;
  userId: string;
}): Promise<Result<{ id: string }>> {
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select(["id", "status"])
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      if (inspection.status === "Passed" || inspection.status === "Failed") {
        throw new Error("Inspection is closed");
      }

      const measurement = await trx
        .selectFrom("inspectionMeasurement")
        .select(["id"])
        .where("inspectionId", "=", args.inspectionId)
        .limit(1)
        .executeTakeFirst();
      if (measurement) {
        throw new Error(
          "Cannot change document after measurements are recorded"
        );
      }

      await trx
        .updateTable("inspection")
        .set({
          inspectionDocumentId: args.inspectionDocumentId,
          updatedBy: args.userId,
          updatedAt: nowIso
        })
        .where("id", "=", args.inspectionId)
        .execute();

      await trx
        .deleteFrom("inspectionSamplingPlan")
        .where("inspectionId", "=", args.inspectionId)
        .execute();

      return { id: inspection.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to change document"
    );
  }
}
