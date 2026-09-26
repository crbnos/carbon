/**
 * Inspection execution engine — the transactional core of the quality
 * inspection system, shared by the ERP routes (`x+/inspection+/*`) and the MES
 * routes (`x+/inspection-lot.$id.*`). Moved here from
 * `apps/erp/app/modules/quality/quality.server.ts` so both apps run one engine.
 *
 * Every function takes a Kysely client as its first argument (each app passes
 * its own `getDatabaseClient()` singleton). Kysely bypasses RLS — the calling
 * route's `requirePermissions` is the auth gate.
 */
import type { Transaction } from "kysely";
import { sql } from "kysely";

import { getNextSequence } from "../supabase/functions/shared/get-next-sequence.ts";
import {
  computeLotStatus,
  deriveSampleStatus,
  type InspectionVerdict,
  valuateGeometricMeasurement,
  valuateMeasurement
} from "../supabase/functions/shared/inspection-verdict.ts";
import type { Kysely, KyselyDatabase } from "./client.ts";
import {
  type FirstArticleNeed,
  type FirstArticleNeedInput,
  firstArticleItemRevision,
  formatFirstArticlePartDescription,
  resolveFirstArticleNeeds
} from "./first-article.ts";
import type {
  FeatureSamplingRule,
  SamplingPlanInput,
  SamplingStandard
} from "./sampling.ts";
import { resolveFeatureSamplingPlan, resolveSamplingPlan } from "./sampling.ts";
import type { Database } from "./types.ts";

type Ok<T> = { data: T; error: null };
type Err = { data: null; error: { message: string; blockers?: unknown } };
export type Result<T> = Ok<T> | Err;

export { valuateGeometricMeasurement, valuateMeasurement };

export function errResult(message: string, blockers?: unknown): Err {
  return { data: null, error: { message, ...(blockers ? { blockers } : {}) } };
}

// Plain input shapes (structurally assignable from the apps' zod-inferred
// validator types — zod stays app-side, the engine takes data).
export type InspectionSampleInput = {
  inspectionId: string;
  // Optional: update an existing sample in place (the grid's "Overall result"
  // row re-toggles an anonymous non-serial column). Serial parts upsert by the
  // tracked entity instead, so they don't need it.
  sampleId?: string;
  // Optional: serial parts scan a discrete tracked entity; batch / inventory /
  // non-inventory parts record pass/fail without one.
  trackedEntityId?: string;
  // "Pending" registers a sample without a verdict (identify-only scan when an
  // inspection document drives per-feature measurements).
  status: "Pending" | "Passed" | "Failed";
  notes?: string;
  companyId: string;
  inspectedBy: string;
};

export type InspectionDispositionInput = {
  id: string;
  decision: "Accept" | "Reject" | "Partial";
  notes?: string;
  companyId: string;
  dispositionedBy: string;
  // One-shot mode: refuse to disposition a lot that is already terminal
  // (Passed/Failed/Partial). The MES disposition route passes this because its
  // dispositions drive physical postings (scrap/rework/complete) that must not
  // re-run; ERP receipt lots keep re-disposition (write-off retry semantics).
  requireOpen?: boolean;
  // Restrict the disposition to lots of this source. The ERP Accept/Reject/Partial
  // routes pass "Receipt" because their verdicts carry NO physical production
  // posting — accepting a Job Operation lot here would hard-terminate it with no
  // complete/scrap/rework and wedge the operation (whose outcome the MES
  // disposition route owns). The MES route omits this so it can disposition
  // Job Operation lots.
  // A First Article verdict carries no posting either, so the ERP routes also
  // accept "First Article" lots (one-shot, with requireOpen).
  requireSource?: "Receipt" | "Job Operation" | "First Article";
};

export type InspectionMeasurementInput = {
  inspectionId: string;
  // Absent = create an anonymous sample (non-serial grid columns).
  sampleId?: string;
  inspectionFeatureId: string;
  // Numeric string for Measurement features; empty clears the reading.
  value?: string;
  // Attribute (non-numeric) features toggle pass/fail instead of a value.
  passed?: "true" | "false";
  notes?: string;
  companyId: string;
  userId: string;
};

// The sampling hierarchy is: feature rule -> document default -> All. This
// maps an inspectionDocument row's default-rule columns into the engine's
// plan shape (NUMERIC columns come back from pg as strings — coerce).
function toSamplingPlanInput(
  row:
    | {
        samplingPlanType: SamplingPlanInput["type"] | null;
        samplingSampleSize: number | null;
        samplingPercentage: string | number | null;
        samplingAql: string | number | null;
        samplingInspectionLevel: SamplingPlanInput["inspectionLevel"];
        samplingSeverity: SamplingPlanInput["severity"];
      }
    | null
    | undefined
): SamplingPlanInput | null {
  if (!row?.samplingPlanType) return null;
  return {
    type: row.samplingPlanType,
    sampleSize: row.samplingSampleSize,
    percentage:
      row.samplingPercentage == null ? null : Number(row.samplingPercentage),
    aql: row.samplingAql == null ? null : Number(row.samplingAql),
    inspectionLevel: row.samplingInspectionLevel,
    severity: row.samplingSeverity
  };
}

type LotFeaturePlan = {
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
  codeLetter: string | null;
};

// The one per-feature plan builder for lot plan rows. A First Article lot is a
// single unit inspected on every characteristic (AS9102), so it ignores the
// feature/document sampling rules; every other source resolves feature rule ->
// document default -> All. post-receipt keeps its own copy (receipts are never
// First Article).
function resolveLotFeaturePlan(
  sourceDocument: Database["public"]["Enums"]["inspectionSourceDocument"],
  feature: FeatureSamplingRule,
  documentDefault: SamplingPlanInput | null,
  lotSize: number,
  standard: SamplingStandard
): LotFeaturePlan {
  if (sourceDocument === "First Article") {
    return {
      sampleSize: 1,
      acceptanceNumber: 0,
      rejectionNumber: 1,
      codeLetter: null
    };
  }
  const resolved = resolveFeatureSamplingPlan(
    feature,
    documentDefault,
    lotSize,
    standard
  );
  return {
    sampleSize: resolved.sampleSize,
    acceptanceNumber: resolved.acceptance,
    rejectionNumber: resolved.rejection,
    codeLetter: resolved.codeLetter
  };
}

// Terminal lot statuses. Passed/Failed/Partial are all hard-terminal: once
// dispositioned, samples and measurements are immutable (Partial is the mixed
// close — some units passed, some failed, each already routed to its outcome).
const INSPECTION_CLOSED_STATUSES = ["Passed", "Failed", "Partial"] as const;

function isInspectionClosed(status: string): boolean {
  return (INSPECTION_CLOSED_STATUSES as readonly string[]).includes(status);
}

// A sample whose verdict already drove a production posting (MES verdict-driven
// completion links productionQuantity.inspectionSampleId) is locked — changing
// it would desync the posted quantity. Deleting the productionQuantity row in
// the ERP unlocks it (the completion arithmetic self-heals from the links).
async function assertSampleNotLinked(
  trx: Transaction<KyselyDatabase>,
  sampleId: string
) {
  const linked = await trx
    .selectFrom("productionQuantity")
    .select(["id"])
    .where("inspectionSampleId", "=", sampleId)
    .executeTakeFirst();
  if (linked) {
    throw new Error(
      "Sample is locked: its unit was already completed from this verdict"
    );
  }
}

// Entity-level side effects of a sample verdict (serial parts only): flip the
// tracked entity's status and record the Inspect activity. Shared by the
// pass/fail sample path and the derived-status measurement path. Only invoked
// for Receipt-sourced lots — Job Operation inspections act on WIP entities
// whose lifecycle belongs to the job, so sampling never flips them.
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
//   - trackedEntity.status (flip to Available or Rejected; Receipt source only)
//   - trackedActivity + trackedActivityInput + trackedActivityOutput
//   - inspection.status (recompute if non-terminal)

export async function upsertInspectionSample(
  db: Kysely<KyselyDatabase>,
  sample: InspectionSampleInput
): Promise<Result<{ id: string }>> {
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
      if (isInspectionClosed(inspection.status)) {
        throw new Error("Inspection is closed");
      }

      // Serial parts carry a tracked entity that may only be sampled once, so we
      // upsert by it. Anonymous (batch / inventory / non-inventory) columns have
      // no entity: the caller passes the column's sampleId to update it in place
      // (idempotent re-toggle of the "Overall result" cell), otherwise each call
      // is a fresh anonymous sample.
      const trackedEntityId = sample.trackedEntityId || null;
      let existing: { id: string } | undefined;
      if (trackedEntityId) {
        existing = await trx
          .selectFrom("inspectionSample")
          .select(["id"])
          .where("trackedEntityId", "=", trackedEntityId)
          .where("inspectionId", "=", sample.inspectionId)
          .where("companyId", "=", sample.companyId)
          .executeTakeFirst();
      } else if (sample.sampleId) {
        existing = await trx
          .selectFrom("inspectionSample")
          .select(["id"])
          .where("id", "=", sample.sampleId)
          .where("inspectionId", "=", sample.inspectionId)
          .where("companyId", "=", sample.companyId)
          .executeTakeFirst();
        if (!existing) throw new Error("Sample not found");
      }

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
        await assertSampleNotLinked(trx, existing.id);
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
      // Job Operation lots sample WIP entities and never flip their status.
      if (
        inspection.sourceDocument === "Receipt" &&
        trackedEntityId &&
        sample.status !== "Pending"
      ) {
        await applySampleEntityStatus(trx, {
          trackedEntityId,
          status: sample.status,
          inspectionId: sample.inspectionId,
          receiptId: inspection.sourceDocumentId,
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
  db: Kysely<KyselyDatabase>,
  args: InspectionDispositionInput
): Promise<
  Result<{
    id: string;
    status: string;
    // Non-tracked Inventory reject: the inventory write-off the route must post
    // through post-nonconformance (itemLedger + cost relief + GL). Null when the
    // decision/tracking type needs no compensating ledger movement.
    writeOff: {
      itemId: string;
      quantity: number;
      locationId: string | null;
    } | null;
  }>
> {
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
      if (
        args.requireSource &&
        inspection.sourceDocument !== args.requireSource
      ) {
        throw new Error(
          `This disposition is only available for ${args.requireSource} inspections`
        );
      }
      if (args.requireOpen && isInspectionClosed(inspection.status)) {
        throw new Error("Inspection is already dispositioned");
      }
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

      const failedEntityIds = new Set(
        existingSamples
          .filter((s) => s.status === "Failed")
          .map((s) => s.trackedEntityId)
          .filter(Boolean)
      );
      const allLotIds = lotEntities.map((e) => e.id);
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
              "Cannot accept: sampling incomplete or acceptance number exceeded for one or more features"
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
              "Cannot reject: no feature has reached its rejection number and no sample has failed"
            );
          }
        }
      }

      // Reject = entire lot non-conforming (ISO 9001:2015 §8.7). Accept
      // releases every lot entity that didn't fail a sample — un-sampled and
      // partially-inspected (Pending) units included; failed units stay
      // Rejected. Partial leaves un-sampled entities On Hold.
      let lotStatus: "Passed" | "Failed" | "Partial";
      let idsToFlip: string[] = [];
      let flipStatus: "Available" | "Rejected" | null = null;
      switch (args.decision) {
        case "Accept":
          lotStatus = "Passed";
          idsToFlip = allLotIds.filter((id) => !failedEntityIds.has(id));
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
      // it from on-hand. Rejecting the lot posts a compensating write-off —
      // itemLedger Negative Adjmt. + cost relief + GL — through the
      // post-nonconformance edge function, which the route invokes AFTER this
      // transaction commits (cost/GL logic is Deno-only). The `inspection.status
      // !== "Failed"` guard is intentionally dropped: post-nonconformance is
      // idempotent per (documentType, documentId), so a re-reject / retry is
      // safe. Tracked items are handled by the status flip above; Non-Inventory
      // never posted a receipt ledger entry, so neither needs a write-off.
      const writeOff =
        args.decision === "Reject" &&
        isReceiptSource &&
        item?.itemTrackingType === "Inventory" &&
        inspection.lotSize > 0
          ? {
              itemId: inspection.itemId,
              quantity: -inspection.lotSize,
              locationId: receiptLine?.locationId ?? null
            }
          : null;

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
        // One-shot under concurrency: a second disposition blocks on the row
        // lock, re-evaluates this predicate against the committed terminal
        // status, matches zero rows, and throws below — the early read check
        // alone can't see an uncommitted concurrent disposition.
        .$if(args.requireOpen === true, (qb) =>
          qb.where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
        )
        .returning(["id", "status"])
        .executeTakeFirst();
      if (!updated) {
        throw new Error("Inspection is already dispositioned");
      }

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

      return { id: updated.id, status: updated.status, writeOff };
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

// Records one cell of the features x samples grid. Valuates the reading,
// upserts the measurement, derives the sample's status from its required
// measurements (strict: no override), applies serial-entity side effects on
// status transitions (Receipt source only), and recomputes the non-terminal
// lot status.
export async function upsertInspectionMeasurement(
  db: Kysely<KyselyDatabase>,
  args: InspectionMeasurementInput
): Promise<
  Result<{
    sampleId: string;
    measurementId: string;
    measurementStatus: string;
    sampleStatus: string;
    bonus: number | null;
    allowable: number | null;
  }>
> {
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
      if (isInspectionClosed(inspection.status)) {
        throw new Error("Inspection is closed");
      }

      const feature = await trx
        .selectFrom("inspectionFeature")
        .select([
          "id",
          "type",
          "nominalValue",
          "tolerancePlus",
          "toleranceMinus",
          "materialCondition",
          "featureOfSize",
          "sizeFeatureId"
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
        await assertSampleNotLinked(trx, existing.id);
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

      // A geometric tolerance at MMC/LMC earns bonus from its related size
      // feature's reading on the SAME sample (unit); everything else is a
      // plain tolerance-band or attribute valuation.
      let measurementStatus: InspectionVerdict;
      let bonus: number | null = null;
      let allowable: number | null = null;
      if (
        (feature.materialCondition === "MMC" ||
          feature.materialCondition === "LMC") &&
        feature.sizeFeatureId
      ) {
        const sizeFeature = await trx
          .selectFrom("inspectionFeature")
          .select([
            "id",
            "type",
            "nominalValue",
            "tolerancePlus",
            "toleranceMinus"
          ])
          .where("id", "=", feature.sizeFeatureId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        const sizeMeasurement = sizeFeature
          ? await trx
              .selectFrom("inspectionMeasurement")
              .select(["value", "status"])
              .where("inspectionSampleId", "=", sample.id)
              .where("inspectionFeatureId", "=", sizeFeature.id)
              .executeTakeFirst()
          : undefined;
        const valuation = valuateGeometricMeasurement(
          feature,
          numericValue,
          sizeFeature && sizeMeasurement
            ? {
                spec: sizeFeature,
                value:
                  sizeMeasurement.value == null
                    ? null
                    : Number(sizeMeasurement.value),
                status: sizeMeasurement.status
              }
            : null,
          passed
        );
        measurementStatus = valuation.status;
        bonus = valuation.bonus;
        allowable = valuation.allowable;
      } else {
        measurementStatus = valuateMeasurement(feature, numericValue, passed);
      }

      const existingMeasurement = await trx
        .selectFrom("inspectionMeasurement")
        .select(["id"])
        .where("inspectionSampleId", "=", sample.id)
        .where("inspectionFeatureId", "=", feature.id)
        .executeTakeFirst();

      const measurementPayload = {
        value: numericValue,
        status: measurementStatus,
        bonus,
        allowable,
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

      // This reading may be the size feature of MMC/LMC geometric features:
      // re-valuate their recorded readings on this sample against the new
      // size, before the sample status is derived from them.
      const dependentFeatures = await trx
        .selectFrom("inspectionFeature")
        .select([
          "id",
          "type",
          "nominalValue",
          "tolerancePlus",
          "toleranceMinus",
          "materialCondition",
          "featureOfSize"
        ])
        .where("sizeFeatureId", "=", feature.id)
        .where("companyId", "=", args.companyId)
        .execute();
      if (dependentFeatures.length > 0) {
        const dependentMeasurements = await trx
          .selectFrom("inspectionMeasurement")
          .select(["id", "inspectionFeatureId", "value"])
          .where("inspectionSampleId", "=", sample.id)
          .where(
            "inspectionFeatureId",
            "in",
            dependentFeatures.map((f) => f.id)
          )
          .where("value", "is not", null)
          .execute();
        const dependentById = new Map(dependentFeatures.map((f) => [f.id, f]));
        const sizeReading = {
          spec: feature,
          value: numericValue,
          status: measurementStatus
        };
        for (const dependent of dependentMeasurements) {
          const dependentFeature = dependentById.get(
            dependent.inspectionFeatureId
          );
          if (!dependentFeature || dependent.value == null) continue;
          const valuation = valuateGeometricMeasurement(
            dependentFeature,
            Number(dependent.value),
            sizeReading
          );
          await trx
            .updateTable("inspectionMeasurement")
            .set({
              status: valuation.status,
              bonus: valuation.bonus,
              allowable: valuation.allowable,
              updatedBy: args.userId,
              updatedAt: nowIso
            })
            .where("id", "=", dependent.id)
            .execute();
        }
      }

      const lotFeatures = await trx
        .selectFrom("inspectionSamplingPlan")
        .select(["inspectionFeatureId", "sampleSize"])
        .where("inspectionId", "=", args.inspectionId)
        .execute();
      const sampleMeasurements = await trx
        .selectFrom("inspectionMeasurement")
        .select(["inspectionFeatureId", "status"])
        .where("inspectionSampleId", "=", sample.id)
        .execute();

      const derivedStatus = deriveSampleStatus(
        lotFeatures.map((f) => f.inspectionFeatureId),
        sampleMeasurements
      );

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

        // WIP entities on Job Operation lots keep their job-owned status; only
        // Receipt-sourced entities ride the sample verdict.
        if (inspection.sourceDocument === "Receipt" && sample.trackedEntityId) {
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
              receiptId: inspection.sourceDocumentId,
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
        sampleStatus: derivedStatus,
        bonus,
        allowable
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
// document after lot creation need per-lot plan rows resolved lazily. Rows
// whose live feature was deleted are left in place (the grid ignores them).

export async function reconcileInspectionSamplingPlans(
  db: Kysely<KyselyDatabase>,
  inspectionId: string,
  companyId: string
): Promise<Result<{ added: number }>> {
  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
          "sourceDocument",
          "inspectionDocumentId",
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

      // The document's own default rule is the fallback for features without
      // a rule (feature rule -> document default -> All).
      const documentDefault = await trx
        .selectFrom("inspectionDocument")
        .select([
          "samplingPlanType",
          "samplingSampleSize",
          "samplingPercentage",
          "samplingAql",
          "samplingInspectionLevel",
          "samplingSeverity"
        ])
        .where("id", "=", inspection.inspectionDocumentId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const defaultPlan = toSamplingPlanInput(documentDefault);

      const inserts = missing.map((feature) => {
        const resolved = resolveLotFeaturePlan(
          inspection.sourceDocument,
          feature,
          defaultPlan,
          Number(inspection.lotSize),
          inspection.samplingStandard as SamplingStandard
        );
        return {
          inspectionId,
          inspectionFeatureId: feature.id,
          ...resolved,
          companyId,
          // Never NULL into a NOT NULL audit column: fall back to the lot's
          // creator (the creating flow's userId).
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

export async function changeInspectionDocument(
  db: Kysely<KyselyDatabase>,
  args: {
    inspectionId: string;
    inspectionDocumentId: string | null;
    companyId: string;
    userId: string;
  }
): Promise<Result<{ id: string }>> {
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
      if (isInspectionClosed(inspection.status)) {
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

// -------------------------------------------------------------
// 6. getOrCreateJobOperationInspection
// -------------------------------------------------------------
// Lazy find-or-create of the inspection lot for a jobOperation with
// operationType = 'Inspection', called by the MES inspection loader on first
// open. Mirrors the post-receipt lot creation: snapshots the resolved sampling
// plan (item plan -> "All"), resolves per-feature plans from the operation's
// explicit inspectionDocumentId FK, and allocates the human-readable id from
// the "inspection" sequence. Idempotent against the partial unique index on
// (sourceDocument, sourceDocumentLineId): a concurrent creation loses with a
// 23505, which we resolve by re-selecting the winner's lot.

export async function getOrCreateJobOperationInspection(
  db: Kysely<KyselyDatabase>,
  args: { jobOperationId: string; companyId: string; userId: string }
): Promise<Result<{ id: string; created: boolean }>> {
  const selectExisting = () =>
    db
      .selectFrom("inspection")
      .select(["id"])
      .where("sourceDocument", "=", "Job Operation")
      .where("sourceDocumentLineId", "=", args.jobOperationId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("inspection")
        .select(["id"])
        .where("sourceDocument", "=", "Job Operation")
        .where("sourceDocumentLineId", "=", args.jobOperationId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (existing) return { id: existing.id, created: false };

      const operation = await trx
        .selectFrom("jobOperation")
        .select([
          "id",
          "jobId",
          "jobMakeMethodId",
          "operationQuantity",
          "inspectionDocumentId"
        ])
        .where("id", "=", args.jobOperationId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!operation) throw new Error("Job operation not found");

      const job = await trx
        .selectFrom("job")
        .select(["id", "jobId", "itemId", "quantity"])
        .where("id", "=", operation.jobId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!job) throw new Error("Job not found");

      // The make method's item is the assembly actually produced at this level
      // of the job (subassembly operations inspect the subassembly, not the
      // top-level part).
      const makeMethod = operation.jobMakeMethodId
        ? await trx
            .selectFrom("jobMakeMethod")
            .select(["itemId"])
            .where("id", "=", operation.jobMakeMethodId)
            .where("companyId", "=", args.companyId)
            .executeTakeFirst()
        : undefined;
      const itemId = makeMethod?.itemId ?? job.itemId;
      if (!itemId) throw new Error("Job has no item to inspect");

      const item = await trx
        .selectFrom("item")
        .select(["readableIdWithRevision"])
        .where("id", "=", itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      const settings = await trx
        .selectFrom("companySettings")
        .select(["samplingStandard"])
        .where("id", "=", args.companyId)
        .executeTakeFirst();
      const samplingStandard = (settings?.samplingStandard ??
        "ANSI_Z1_4") as SamplingStandard;

      // The document's default sampling rule is both the lot-level plan base
      // and the fallback for features without their own rule. No document (or
      // no default set) means 100% inspection.
      const documentDefault = operation.inspectionDocumentId
        ? await trx
            .selectFrom("inspectionDocument")
            .select([
              "samplingPlanType",
              "samplingSampleSize",
              "samplingPercentage",
              "samplingAql",
              "samplingInspectionLevel",
              "samplingSeverity"
            ])
            .where("id", "=", operation.inspectionDocumentId)
            .where("companyId", "=", args.companyId)
            .executeTakeFirst()
        : undefined;
      const defaultPlan = toSamplingPlanInput(documentDefault);

      const plan: SamplingPlanInput = defaultPlan ?? {
        type: "All",
        sampleSize: null,
        percentage: null,
        aql: null,
        inspectionLevel: "II",
        severity: "Normal"
      };

      const lotSize = Math.max(
        1,
        Math.floor(Number(operation.operationQuantity ?? job.quantity ?? 1))
      );

      const snapshot = resolveSamplingPlan(plan, lotSize, samplingStandard);

      const documentFeatures = operation.inspectionDocumentId
        ? await trx
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
            .where("inspectionDocumentId", "=", operation.inspectionDocumentId)
            .where("companyId", "=", args.companyId)
            .execute()
        : [];
      const featurePlans = documentFeatures.map((feature) => ({
        inspectionFeatureId: feature.id,
        resolved: resolveLotFeaturePlan(
          "Job Operation",
          feature,
          defaultPlan,
          lotSize,
          samplingStandard
        )
      }));

      const readableInspectionId = await getNextSequence(
        trx,
        "inspection",
        args.companyId
      );

      const inserted = await trx
        .insertInto("inspection")
        .values({
          inspectionId: readableInspectionId,
          sourceDocument: "Job Operation",
          sourceDocumentId: operation.jobId,
          sourceDocumentLineId: operation.id,
          sourceDocumentReadableId: job.jobId,
          itemId,
          itemReadableId: item?.readableIdWithRevision ?? null,
          supplierId: null,
          lotSize,
          samplingStandard,
          samplingPlanType: plan.type,
          // With a document attached, the lot-level sample size is the max
          // across the per-feature plans (SAP-style); Ac/Re remain the
          // item-plan fallback numbers used by the no-document flow.
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
          // The operation FK is the explicit plan link ("the FK is the truth").
          // Unlike post-receipt's assignment slots, a drawing-only document
          // (zero features yet) still renders its PDF, and features added to it
          // later reconcile in lazily.
          inspectionDocumentId: operation.inspectionDocumentId ?? null,
          status: "Pending",
          companyId: args.companyId,
          createdBy: args.userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      if (featurePlans.length > 0) {
        await trx
          .insertInto("inspectionSamplingPlan")
          .values(
            featurePlans.map((p) => ({
              inspectionId: inserted.id,
              inspectionFeatureId: p.inspectionFeatureId,
              ...p.resolved,
              companyId: args.companyId,
              createdBy: args.userId
            }))
          )
          .execute();
      }

      return { id: inserted.id, created: true };
    });

    return { data: result, error: null };
  } catch (err) {
    // Concurrent first-open race: the partial unique index on
    // (sourceDocument, sourceDocumentLineId) rejects the second insert with a
    // unique violation. The winner's lot is the lot.
    if ((err as { code?: string })?.code === "23505") {
      const existing = await selectExisting();
      if (existing)
        return { data: { id: existing.id, created: false }, error: null };
    }
    return errResult(
      err instanceof Error ? err.message : "Failed to create inspection"
    );
  }
}

// -------------------------------------------------------------
// 7. First Article Inspection generation (AS9102)
// -------------------------------------------------------------
// One First Article lot per job make method that needs one — the lot's
// readable inspectionId is the FAIR identifier. Which make methods need one is
// decided by the pure `resolveFirstArticleNeeds` (shared with the release
// blocker, so the two can never disagree); this module only loads its input
// and writes the lot, its per-feature plan rows and the seeded Form 1 header.

type FirstArticleInspectionReason =
  Database["public"]["Enums"]["firstArticleInspectionReason"];
type FirstArticleInspectionScope =
  Database["public"]["Enums"]["firstArticleInspectionScope"];

/** A manual "New First Article" for one make method. */
export type FirstArticleManualRequest = {
  jobMakeMethodId: string;
  scope: FirstArticleInspectionScope;
  reason: FirstArticleInspectionReason;
  baselineFirstArticleInspectionId?: string;
  baselineReference?: string;
};

type FirstArticleItem = {
  readableId: string;
  readableIdWithRevision: string | null;
  revision: string | null;
  name: string;
};

type FirstArticleContext = {
  input: FirstArticleNeedInput;
  job: {
    id: string;
    jobId: string;
    customerId: string | null;
    salesOrderId: string | null;
  };
  companyName: string;
  samplingStandard: SamplingStandard;
  items: Map<string, FirstArticleItem>;
};

async function loadFirstArticleContext(
  db: Kysely<KyselyDatabase>,
  args: { jobId: string; companyId: string; today: string }
): Promise<FirstArticleContext> {
  const job = await db
    .selectFrom("job")
    .select(["id", "jobId", "customerId", "salesOrderId"])
    .where("id", "=", args.jobId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();
  if (!job) throw new Error("Job not found");

  const company = await db
    .selectFrom("company")
    .select(["name", "timezone"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  if (!company) throw new Error("Company not found");

  const settings = await db
    .selectFrom("companySettings")
    .select(["requireFirstArticle", "samplingStandard"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();

  const customerShipping = job.customerId
    ? await db
        .selectFrom("customerShipping")
        .select(["requiresFirstArticle"])
        .where("customerId", "=", job.customerId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst()
    : undefined;

  // Root and made sub-assemblies alike — AS9102 needs an FAI per item.
  const makeMethods = await db
    .selectFrom("jobMakeMethod")
    .innerJoin("item", "item.id", "jobMakeMethod.itemId")
    .select([
      "jobMakeMethod.id",
      "jobMakeMethod.itemId",
      "item.readableId",
      "item.readableIdWithRevision",
      "item.revision",
      "item.name"
    ])
    .where("jobMakeMethod.jobId", "=", job.id)
    .where("jobMakeMethod.companyId", "=", args.companyId)
    .orderBy("jobMakeMethod.createdAt")
    .orderBy("jobMakeMethod.id")
    .execute();

  const items = new Map<string, FirstArticleItem>();
  for (const makeMethod of makeMethods) {
    items.set(makeMethod.itemId, {
      readableId: makeMethod.readableId,
      readableIdWithRevision: makeMethod.readableIdWithRevision,
      revision: makeMethod.revision,
      name: makeMethod.name
    });
  }

  const context: Omit<FirstArticleContext, "input"> = {
    job,
    companyName: company.name,
    samplingStandard: (settings?.samplingStandard ??
      "ANSI_Z1_4") as SamplingStandard,
    items
  };
  const baseInput = {
    companyRequiresFirstArticle: settings?.requireFirstArticle ?? false,
    customerRequiresFirstArticle:
      customerShipping?.requiresFirstArticle ?? false,
    today: args.today
  };
  if (makeMethods.length === 0) {
    return { ...context, input: { ...baseInput, makeMethods: [] } };
  }

  const itemIds = [...items.keys()];
  const makeMethodIds = makeMethods.map((makeMethod) => makeMethod.id);

  const firstArticleSlots = await db
    .selectFrom("itemInspectionDocumentAssignment")
    .select(["itemId", "inspectionDocumentId"])
    .where("usage", "=", "First Article")
    .where("itemId", "in", itemIds)
    .where("companyId", "=", args.companyId)
    .execute();

  const partPlans = await db
    .selectFrom("inspectionDocument")
    .select(["id", "partId"])
    .where("partId", "in", itemIds)
    .where("companyId", "=", args.companyId)
    .orderBy("id")
    .execute();

  // Formatted in SQL: node-postgres decodes timestamptz to a JS Date, and the
  // due rule takes an ISO string (approval) and a company business day (job).
  const approvals = await db
    .selectFrom("firstArticleInspection")
    .select([
      "itemId",
      sql<string>`to_char(max("approvedAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
        "latestApprovedAt"
      )
    ])
    .where("status", "=", "Approved")
    .where("approvedAt", "is not", null)
    .where("itemId", "in", itemIds)
    .where("companyId", "=", args.companyId)
    .groupBy("itemId")
    .execute();

  const completedJobs = await db
    .selectFrom("job")
    .select([
      "itemId",
      sql<string>`to_char(max("completedDate") AT TIME ZONE ${company.timezone}, 'YYYY-MM-DD')`.as(
        "lastCompletedJobDate"
      )
    ])
    .where("status", "in", ["Completed", "Closed"])
    .where("completedDate", "is not", null)
    .where("id", "<>", job.id)
    .where("itemId", "in", itemIds)
    .where("companyId", "=", args.companyId)
    .groupBy("itemId")
    .execute();

  const existingLots = await db
    .selectFrom("inspection")
    .select(["sourceDocumentLineId"])
    .where("sourceDocument", "=", "First Article")
    .where("sourceDocumentLineId", "in", makeMethodIds)
    .where("companyId", "=", args.companyId)
    .execute();

  const slotByItem = new Map(
    firstArticleSlots.map((slot) => [slot.itemId, slot.inspectionDocumentId])
  );
  const partPlansByItem = new Map<string, string[]>();
  for (const plan of partPlans) {
    const list = partPlansByItem.get(plan.partId) ?? [];
    list.push(plan.id);
    partPlansByItem.set(plan.partId, list);
  }
  const approvedAtByItem = new Map(
    approvals.map((row) => [row.itemId, row.latestApprovedAt])
  );
  const completedByItem = new Map(
    completedJobs.map((row) => [row.itemId, row.lastCompletedJobDate])
  );
  const lotMakeMethodIds = new Set(
    existingLots.map((lot) => lot.sourceDocumentLineId)
  );

  return {
    ...context,
    input: {
      ...baseInput,
      makeMethods: makeMethods.map((makeMethod) => ({
        jobMakeMethodId: makeMethod.id,
        itemId: makeMethod.itemId,
        description: formatFirstArticlePartDescription(
          makeMethod.readableId,
          makeMethod.revision
        ),
        firstArticlePlanId: slotByItem.get(makeMethod.itemId) ?? null,
        partPlanIds: partPlansByItem.get(makeMethod.itemId) ?? [],
        latestApprovedAt: approvedAtByItem.get(makeMethod.itemId) ?? null,
        lastCompletedJobDate: completedByItem.get(makeMethod.itemId) ?? null,
        hasFirstArticleLot: lotMakeMethodIds.has(makeMethod.id)
      }))
    }
  };
}

/**
 * Everything `resolveFirstArticleNeeds` needs for one job, in a fixed number
 * of queries regardless of the size of the method tree. Pass the active `trx`
 * when called inside a transaction.
 */
export async function loadFirstArticleNeedInput(
  trx: Kysely<KyselyDatabase>,
  args: { jobId: string; companyId: string; today: string }
): Promise<FirstArticleNeedInput> {
  const { input } = await loadFirstArticleContext(trx, args);
  return input;
}

/**
 * Creates the First Article lots a job needs — at release (no `only`), or one
 * manual FAI for a chosen make method (`only`, treated as required and due,
 * still requiring a resolved plan). Idempotent: a make method that already has
 * a First Article lot is skipped, including one created concurrently.
 */
export async function createFirstArticleInspections(
  db: Kysely<KyselyDatabase>,
  args: {
    jobId: string;
    companyId: string;
    userId: string;
    /** YYYY-MM-DD, company timezone. */
    today: string;
    only?: FirstArticleManualRequest;
  }
): Promise<Result<{ firstArticleInspectionIds: string[] }>> {
  const { companyId, userId, only } = args;

  try {
    const result = await db.transaction().execute(async (trx) => {
      const context = await loadFirstArticleContext(trx, args);
      const needs = resolveFirstArticleNeeds(context.input);
      const { job, items } = context;

      let toCreate: FirstArticleNeed[];
      if (only) {
        const need = needs.find(
          (n) => n.jobMakeMethodId === only.jobMakeMethodId
        );
        if (!need) throw new Error("Make method not found on this job");
        if (!need.planId) {
          throw new Error(
            `Assign a first article plan for ${need.description}`
          );
        }
        const hasLot = context.input.makeMethods.some(
          (m) =>
            m.jobMakeMethodId === need.jobMakeMethodId && m.hasFirstArticleLot
        );
        if (hasLot) {
          throw new Error(
            `This job already has a first article for ${need.description}`
          );
        }
        toCreate = [need];
      } else {
        toCreate = needs.filter((need) => need.create);
      }
      if (toCreate.length === 0) return { firstArticleInspectionIds: [] };

      const planIds = [
        ...new Set(toCreate.map((need) => need.planId as string))
      ];
      const itemIds = [...new Set(toCreate.map((need) => need.itemId))];
      const makeMethodIds = toCreate.map((need) => need.jobMakeMethodId);
      const readableIds = [
        ...new Set(itemIds.map((itemId) => items.get(itemId)?.readableId ?? ""))
      ].filter(Boolean);

      const plans = await trx
        .selectFrom("inspectionDocument")
        .select([
          "id",
          "drawingNumber",
          "drawingRevision",
          "samplingPlanType",
          "samplingSampleSize",
          "samplingPercentage",
          "samplingAql",
          "samplingInspectionLevel",
          "samplingSeverity"
        ])
        .where("id", "in", planIds)
        .where("companyId", "=", companyId)
        .execute();
      const planById = new Map(plans.map((plan) => [plan.id, plan]));

      const features = await trx
        .selectFrom("inspectionFeature")
        .select([
          "id",
          "inspectionDocumentId",
          "samplingPlanType",
          "samplingSampleSize",
          "samplingPercentage",
          "samplingAql",
          "samplingInspectionLevel",
          "samplingSeverity"
        ])
        .where("inspectionDocumentId", "in", planIds)
        .where("companyId", "=", companyId)
        .orderBy("id")
        .execute();
      const featuresByPlan = new Map<string, typeof features>();
      for (const feature of features) {
        const list = featuresByPlan.get(feature.inspectionDocumentId) ?? [];
        list.push(feature);
        featuresByPlan.set(feature.inspectionDocumentId, list);
      }

      const customerParts = job.customerId
        ? await trx
            .selectFrom("customerPartToItem")
            .select(["itemId", "customerPartId", "customerPartRevision"])
            .where("customerId", "=", job.customerId)
            .where("itemId", "in", itemIds)
            .where("companyId", "=", companyId)
            .orderBy("customerPartId")
            .execute()
        : [];
      const customerPartByItem = new Map<
        string,
        (typeof customerParts)[number]
      >();
      for (const part of customerParts) {
        if (!customerPartByItem.has(part.itemId)) {
          customerPartByItem.set(part.itemId, part);
        }
      }

      const salesOrder = job.salesOrderId
        ? await trx
            .selectFrom("salesOrder")
            .select(["customerReference"])
            .where("id", "=", job.salesOrderId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;

      // Assembly when the make method builds any made child (Form 1 field 7).
      const assemblyRows = await trx
        .selectFrom("jobMaterial")
        .select(["jobMakeMethodId"])
        .where("jobMakeMethodId", "in", makeMethodIds)
        .where("methodType", "=", "Make to Order")
        .where("companyId", "=", companyId)
        .execute();
      const assemblyMakeMethodIds = new Set(
        assemblyRows.map((row) => row.jobMakeMethodId)
      );

      // Released change notices of every revision of the part (mirrors
      // `findChangeNoticesForItem`'s affected-item relation).
      const changeOrders =
        readableIds.length > 0
          ? await trx
              .selectFrom("item")
              .innerJoin(
                "changeOrderAffectedItem",
                "changeOrderAffectedItem.itemId",
                "item.id"
              )
              .innerJoin("changeOrder", (join) =>
                join
                  .onRef(
                    "changeOrder.id",
                    "=",
                    "changeOrderAffectedItem.changeOrderId"
                  )
                  .onRef(
                    "changeOrder.companyId",
                    "=",
                    "changeOrderAffectedItem.companyId"
                  )
              )
              .select([
                "item.readableId",
                "changeOrder.id",
                "changeOrder.changeOrderId",
                "changeOrder.name"
              ])
              .where("item.readableId", "in", readableIds)
              .where("item.companyId", "=", companyId)
              .where("changeOrder.status", "=", "Done")
              .orderBy("changeOrder.changeOrderId")
              .orderBy("changeOrder.id")
              .execute()
          : [];
      const changesByReadableId = new Map<string, Map<string, string>>();
      for (const row of changeOrders) {
        const changes =
          changesByReadableId.get(row.readableId) ?? new Map<string, string>();
        changes.set(row.id, `${row.changeOrderId} ${row.name}`);
        changesByReadableId.set(row.readableId, changes);
      }

      // A First Article lot is one unit inspected on every characteristic.
      const lotSize = 1;
      const allPlan: SamplingPlanInput = {
        type: "All",
        sampleSize: null,
        percentage: null,
        aql: null,
        inspectionLevel: "II",
        severity: "Normal"
      };
      const snapshot = resolveSamplingPlan(
        allPlan,
        lotSize,
        context.samplingStandard
      );

      const firstArticleInspectionIds: string[] = [];
      for (const need of toCreate) {
        const planId = need.planId as string;
        const plan = planById.get(planId);
        if (!plan) throw new Error(`Inspection plan ${planId} not found`);
        const item = items.get(need.itemId);
        if (!item) throw new Error(`Item ${need.itemId} not found`);

        const readableInspectionId = await getNextSequence(
          trx,
          "inspection",
          companyId
        );

        const inserted = await trx
          .insertInto("inspection")
          .values({
            inspectionId: readableInspectionId,
            sourceDocument: "First Article",
            sourceDocumentId: job.id,
            sourceDocumentLineId: need.jobMakeMethodId,
            sourceDocumentReadableId: job.jobId,
            itemId: need.itemId,
            itemReadableId: item.readableIdWithRevision ?? item.readableId,
            supplierId: null,
            lotSize,
            samplingStandard: context.samplingStandard,
            samplingPlanType: allPlan.type,
            sampleSize: 1,
            acceptanceNumber: snapshot.acceptance,
            rejectionNumber: snapshot.rejection,
            aql: null,
            inspectionLevel: allPlan.inspectionLevel ?? null,
            severity: allPlan.severity ?? null,
            codeLetter: snapshot.codeLetter,
            inspectionDocumentId: planId,
            status: "Pending",
            companyId,
            createdBy: userId
          })
          // Lost a race with a concurrent generation for this make method:
          // the partial unique index keeps one lot, the winner's.
          .onConflict((oc) =>
            oc
              .columns(["sourceDocument", "sourceDocumentLineId"])
              .where("sourceDocumentLineId", "is not", null)
              .doNothing()
          )
          .returning(["id"])
          .executeTakeFirst();
        if (!inserted) continue;

        const defaultPlan = toSamplingPlanInput(plan);
        const planFeatures = featuresByPlan.get(planId) ?? [];
        if (planFeatures.length > 0) {
          await trx
            .insertInto("inspectionSamplingPlan")
            .values(
              planFeatures.map((feature) => ({
                inspectionId: inserted.id,
                inspectionFeatureId: feature.id,
                ...resolveLotFeaturePlan(
                  "First Article",
                  feature,
                  defaultPlan,
                  lotSize,
                  context.samplingStandard
                ),
                companyId,
                createdBy: userId
              }))
            )
            .execute();
        }

        const customerPart = customerPartByItem.get(need.itemId);
        const changes = changesByReadableId.get(item.readableId);

        const fai = await trx
          .insertInto("firstArticleInspection")
          .values({
            companyId,
            inspectionId: inserted.id,
            itemId: need.itemId,
            jobId: job.id,
            jobMakeMethodId: need.jobMakeMethodId,
            type: assemblyMakeMethodIds.has(need.jobMakeMethodId)
              ? "Assembly"
              : "Detail",
            scope: only?.scope ?? "Full",
            reason: only?.reason ?? need.reason ?? "New Part",
            baselineFirstArticleInspectionId:
              only?.baselineFirstArticleInspectionId || null,
            baselineReference: only?.baselineReference || null,
            partNumber: customerPart?.customerPartId ?? item.readableId,
            partName: item.name,
            partRevision:
              customerPart?.customerPartRevision ||
              firstArticleItemRevision(item.revision) ||
              "N/C",
            drawingNumber: plan.drawingNumber,
            drawingRevision: plan.drawingRevision,
            additionalChanges:
              changes && changes.size > 0
                ? [...changes.values()].join(", ")
                : null,
            manufacturingProcessReference: `${job.jobId} / ${item.readableId}`,
            organizationName: context.companyName,
            purchaseOrderNumber: salesOrder?.customerReference ?? null,
            comments: customerPart ? `Carbon part: ${item.readableId}` : null,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        firstArticleInspectionIds.push(fai.id);
      }

      return { firstArticleInspectionIds };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error
        ? err.message
        : "Failed to create first article inspections"
    );
  }
}

// -------------------------------------------------------------
// Issue disposition lock
// -------------------------------------------------------------

/**
 * Serializes writes to an issue's disposition rows. Every writer that inserts
 * `nonConformanceItemTrackedEntity` or `nonConformanceInspection` rows, or
 * changes `nonConformanceItem.quantity`, takes this lock first inside its
 * transaction — before touching any item row, so the lock order is always
 * issue → item and writers cannot deadlock each other.
 *
 * It holds a `FOR NO KEY UPDATE` lock on the `nonConformance` row, which
 * conflicts with other holders of the same lock but not with the FK checks of
 * unrelated child inserts. Returns the issue status for the caller's
 * locked-issue check; throws when the issue does not exist in the company.
 */
export async function lockIssueDispositions(
  trx: Transaction<KyselyDatabase>,
  args: { nonConformanceId: string; companyId: string }
): Promise<{ status: string }> {
  const issue = await trx
    .selectFrom("nonConformance")
    .select(["status"])
    .where("id", "=", args.nonConformanceId)
    .where("companyId", "=", args.companyId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  if (!issue) throw new Error("Issue not found");
  return { status: issue.status };
}
