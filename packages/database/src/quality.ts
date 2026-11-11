// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import type { NotNull, Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import {
  type FirstArticleNeed,
  type FirstArticleNeedInput,
  firstArticleItemRevision,
  formatFirstArticlePartDescription,
  resolveFirstArticleNeeds
} from "./first-article.ts";
import {
  computeLotStatus,
  deriveSampleStatus,
  type InspectionVerdict,
  valuateGeometricMeasurement,
  valuateMeasurement
} from "./inspection-verdict.ts";
import {
  assertReceiptNotVoided,
  engineErrResult,
  errResult,
  INSPECTION_CLOSED_STATUSES,
  type InspectionSource,
  isInspectionClosed,
  type Result
} from "./quality-core.ts";
import {
  insertLotSamplingPlans,
  resolveLotFeaturePlan,
  resolveLotSamplingPlans,
  toSamplingPlanInput
} from "./quality-sampling.ts";
import type { SamplingPlanInput, SamplingStandard } from "./sampling.ts";
import { resolveSamplingPlan } from "./sampling.ts";
import { getNextSequence } from "./sequence.ts";
import type { Database } from "./types.ts";

export {
  engineErrResult,
  errResult,
  type InspectionSource,
  isDatabaseError,
  isInspectionClosed,
  type Result
} from "./quality-core.ts";
// The engine is split by concern; this file is its one public entry
// (`@carbon/database/quality`), so callers import every name from here.
export {
  dispositionInspection,
  type InspectionDispositionInput,
  isRejectableWithoutReason
} from "./quality-disposition.ts";
export {
  drawHeldStripes,
  type HeldStripe,
  heldStockStripes,
  lockClaimUnit,
  lockHeldUnits,
  lockItemStockRows,
  lotClaimableAtUnit,
  setInspectionRelease,
  storageUnitLocationId,
  withInspectionRelease
} from "./quality-hold.ts";
export {
  cancelManualInspection,
  createManualInspection,
  deleteManualInspection,
  type ManualInspectionInput
} from "./quality-manual.ts";
export {
  createPmiInspectionPlan,
  deleteUnusedPmiInspectionPlans,
  type PmiPlanCharacteristic
} from "./quality-pmi.ts";
export {
  prefillInspectionSamples,
  reconcileInspectionSamplingPlans
} from "./quality-sampling.ts";
export { valuateGeometricMeasurement, valuateMeasurement };

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

// Receipt and Manual lots inspect stock that waits On Hold for the verdict, so
// a sample verdict and the lot disposition move their tracked entities. Job
// Operation lots inspect WIP whose status belongs to the job.
function holdsLotEntities(sourceDocument: InspectionSource): boolean {
  return sourceDocument === "Receipt" || sourceDocument === "Manual";
}

/** A dependent MMC/LMC reading re-valuated because its size reading changed. */
export type RevaluatedDependentMeasurement = {
  inspectionFeatureId: string;
  measurementId: string;
  status: InspectionVerdict;
  bonus: number | null;
  allowable: number | null;
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

async function lockOpenLot(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  inspectionId: string,
  mode: "update" | "share"
): Promise<Selectable<KyselyDatabase["inspection"]>["status"]> {
  const query = trx
    .selectFrom("inspection")
    .select("status")
    .where("id", "=", inspectionId)
    .where("companyId", "=", companyId);
  const lot = await (mode === "update"
    ? query.forUpdate()
    : query.forShare()
  ).executeTakeFirst();
  if (!lot) throw new Error("Inspection not found");
  if (isInspectionClosed(lot.status)) throw new Error("Inspection is closed");
  return lot.status;
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

// A serial sample of a lot that holds stock must be one of the lot's units: a
// manual lot's listed entities, a receipt lot's receipt line. Its verdict
// flips the entity, so a foreign serial would be released or rejected by a lot
// that never held it.
async function assertSampleEntityInLot(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  inspection: {
    id: string;
    sourceDocument: string;
    sourceDocumentLineId: string | null;
  },
  trackedEntityId: string
): Promise<void> {
  let member: { id: string } | undefined;
  if (inspection.sourceDocument === "Manual") {
    member = await trx
      .selectFrom("inspectionTrackedEntity")
      .select(["id"])
      .where("inspectionId", "=", inspection.id)
      .where("trackedEntityId", "=", trackedEntityId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
  } else if (inspection.sourceDocument === "Receipt") {
    member = inspection.sourceDocumentLineId
      ? await trx
          .selectFrom("trackedEntity")
          .select(["id"])
          .where("id", "=", trackedEntityId)
          .where(
            sql<string>`attributes ->> 'Receipt Line'`,
            "=",
            inspection.sourceDocumentLineId
          )
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : undefined;
  } else {
    return;
  }
  if (!member) {
    throw new Error("This tracked entity is not part of the inspection");
  }
}

// Links a sample's unit to the lot's Inspect activity. The verdict moves no
// stock: the unit stays On Hold until the lot is decided. Only invoked for
// Receipt and Manual lots — Job Operation inspections act on WIP entities
// whose lifecycle belongs to the job.
async function recordSampleInspectActivity(
  trx: Transaction<KyselyDatabase>,
  args: {
    trackedEntityId: string;
    inspectionId: string;
    // Receipt-sourced lots pass the receipt id for the activity's Receipt
    // attribute; other sources pass null.
    receiptId: string | null;
    userId: string;
    companyId: string;
  }
) {
  const entity = await trx
    .selectFrom("trackedEntity")
    .select("quantity")
    .where("id", "=", args.trackedEntityId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirstOrThrow();

  // One Inspect activity per lot, so the graph shows every unit the inspection
  // covered. The lock keeps two verdicts saved at once from each creating one.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`inspectActivity:${args.inspectionId}`}, 0))`.execute(
    trx
  );
  const activityId =
    (
      await trx
        .selectFrom("trackedActivity")
        .select("id")
        .where("sourceDocument", "=", "Inbound Inspection")
        .where("sourceDocumentId", "=", args.inspectionId)
        .where("type", "=", "Inspect")
        .where("companyId", "=", args.companyId)
        .executeTakeFirst()
    )?.id ?? (await insertInspectActivity(trx, args));

  // The unit is the activity's input and stays itself: no output row, since
  // nothing is consumed or made. A changed verdict leaves it linked once; its
  // status holds the result.
  await trx
    .insertInto("trackedActivityInput")
    .values({
      trackedActivityId: activityId,
      trackedEntityId: args.trackedEntityId,
      quantity: entity.quantity,
      companyId: args.companyId,
      createdBy: args.userId
    })
    .onConflict((oc) =>
      oc.columns(["trackedActivityId", "trackedEntityId"]).doNothing()
    )
    .execute();
}

async function insertInspectActivity(
  trx: Transaction<KyselyDatabase>,
  args: {
    inspectionId: string;
    receiptId: string | null;
    userId: string;
    companyId: string;
  }
): Promise<string> {
  const lot = await trx
    .selectFrom("inspection")
    .select("inspectionId")
    .where("id", "=", args.inspectionId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirstOrThrow();
  const activity = await trx
    .insertInto("trackedActivity")
    .values({
      type: "Inspect",
      sourceDocument: "Inbound Inspection",
      sourceDocumentId: args.inspectionId,
      sourceDocumentReadableId: lot.inspectionId,
      attributes: {
        ...(args.receiptId ? { Receipt: args.receiptId } : {}),
        Inspector: args.userId
      },
      companyId: args.companyId,
      createdBy: args.userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return activity.id;
}

// -------------------------------------------------------------
// 1. upsertInspectionSample
// -------------------------------------------------------------
// Writes that must stay consistent:
//   - inspectionSample (insert or update)
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
        .select([
          "id",
          "status",
          "sourceDocument",
          "sourceDocumentId",
          "sourceDocumentLineId"
        ])
        .where("id", "=", sample.inspectionId)
        .where("companyId", "=", sample.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      await assertReceiptNotVoided(
        trx,
        sample.companyId,
        inspection,
        "noKeyUpdate"
      );
      inspection.status = await lockOpenLot(
        trx,
        sample.companyId,
        sample.inspectionId,
        "update"
      );
      // Serial parts carry a tracked entity that may only be sampled once, so we
      // upsert by it. Anonymous (batch / inventory / non-inventory) columns have
      // no entity: the caller passes the column's sampleId to update it in place
      // (idempotent re-toggle of the "Overall result" cell), otherwise each call
      // is a fresh anonymous sample.
      const trackedEntityId = sample.trackedEntityId || null;
      if (trackedEntityId) {
        await assertSampleEntityInLot(
          trx,
          sample.companyId,
          inspection,
          trackedEntityId
        );
      }
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

      if (
        holdsLotEntities(inspection.sourceDocument) &&
        trackedEntityId &&
        sample.status !== "Pending"
      ) {
        await recordSampleInspectActivity(trx, {
          trackedEntityId,
          inspectionId: sample.inspectionId,
          receiptId:
            inspection.sourceDocument === "Receipt"
              ? inspection.sourceDocumentId
              : null,
          userId: sample.inspectedBy,
          companyId: sample.companyId
        });
      }

      const samples = await trx
        .selectFrom("inspectionSample")
        .select(["status"])
        .where("inspectionId", "=", sample.inspectionId)
        .where("companyId", "=", sample.companyId)
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
          .where("companyId", "=", sample.companyId)
          .where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
          .execute();
      }

      return { id: sampleId };
    });

    return { data: result, error: null };
  } catch (err) {
    return engineErrResult(err, "Failed to save sample");
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
    /** MMC/LMC readings on this sample re-valuated against this size reading. */
    dependents: RevaluatedDependentMeasurement[];
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
      await assertReceiptNotVoided(
        trx,
        args.companyId,
        inspection,
        "noKeyUpdate"
      );
      inspection.status = await lockOpenLot(
        trx,
        args.companyId,
        args.inspectionId,
        "update"
      );
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
      // first measurement recorded against them). An existing sample is
      // locked first: two readings on one unit (a size and the MMC/LMC
      // feature that takes its bonus from it) otherwise race — each valuates
      // against the other's pre-commit value and derives the sample's status
      // from a stale set of readings.
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
          .forUpdate()
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
      // size, before the sample status is derived from them. They are
      // returned so the grids can refresh those cells without a reload.
      const dependents: RevaluatedDependentMeasurement[] = [];
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
        .where("materialCondition", "in", ["MMC", "LMC"])
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
          dependents.push({
            inspectionFeatureId: dependent.inspectionFeatureId,
            measurementId: dependent.id,
            status: valuation.status,
            bonus: valuation.bonus,
            allowable: valuation.allowable
          });
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

        if (
          holdsLotEntities(inspection.sourceDocument) &&
          sample.trackedEntityId
        ) {
          if (derivedStatus !== "Pending") {
            await recordSampleInspectActivity(trx, {
              trackedEntityId: sample.trackedEntityId,
              inspectionId: args.inspectionId,
              receiptId:
                inspection.sourceDocument === "Receipt"
                  ? inspection.sourceDocumentId
                  : null,
              userId: args.userId,
              companyId: args.companyId
            });
          }
        }
      }

      const samples = await trx
        .selectFrom("inspectionSample")
        .select(["status"])
        .where("inspectionId", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
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
          .where("companyId", "=", args.companyId)
          .where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
          .execute();
      }

      return {
        sampleId: sample.id,
        measurementId,
        measurementStatus,
        sampleStatus: derivedStatus,
        bonus,
        allowable,
        dependents
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return engineErrResult(err, "Failed to save measurement");
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
        .select(["id", "status", "sourceDocument", "sourceDocumentId"])
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      await assertReceiptNotVoided(trx, args.companyId, inspection);
      await lockOpenLot(trx, args.companyId, args.inspectionId, "update");

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
// 5b. recordInspectionGauge
// -------------------------------------------------------------
// Records (or clears) the gauge used to inspect one feature of a lot, on the
// lot's per-feature plan row. When the feature names a gauge type, only a
// gauge of that type is accepted. Inactive gauges are refused; calibration
// status is shown to the inspector but does not block (the gauge's status is
// the calibration program's call, not the inspector's).

export async function recordInspectionGauge(
  db: Kysely<KyselyDatabase>,
  args: {
    inspectionId: string;
    inspectionFeatureId: string;
    gaugeId: string | null;
    companyId: string;
    userId: string;
  }
): Promise<Result<{ inspectionFeatureId: string; gaugeId: string | null }>> {
  try {
    const result = await db.transaction().execute(async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select(["id", "status", "sourceDocument", "sourceDocumentId"])
        .where("id", "=", args.inspectionId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      await assertReceiptNotVoided(trx, args.companyId, inspection);
      await lockOpenLot(trx, args.companyId, args.inspectionId, "share");

      const plan = await trx
        .selectFrom("inspectionSamplingPlan")
        .innerJoin("inspectionFeature", (join) =>
          join
            .onRef(
              "inspectionFeature.id",
              "=",
              "inspectionSamplingPlan.inspectionFeatureId"
            )
            .onRef(
              "inspectionFeature.companyId",
              "=",
              "inspectionSamplingPlan.companyId"
            )
        )
        .select(["inspectionSamplingPlan.id", "inspectionFeature.gaugeTypeId"])
        .where("inspectionSamplingPlan.inspectionId", "=", args.inspectionId)
        .where(
          "inspectionSamplingPlan.inspectionFeatureId",
          "=",
          args.inspectionFeatureId
        )
        .where("inspectionSamplingPlan.companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!plan) throw new Error("Inspection feature not found");

      if (args.gaugeId) {
        const gauge = await trx
          .selectFrom("gauge")
          .select(["id", "gaugeTypeId", "gaugeStatus"])
          .where("id", "=", args.gaugeId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst();
        if (!gauge) throw new Error("Gauge not found");
        if (gauge.gaugeStatus === "Inactive") {
          throw new Error("Gauge is inactive");
        }
        if (plan.gaugeTypeId && gauge.gaugeTypeId !== plan.gaugeTypeId) {
          throw new Error("Gauge is not of the type this feature requires");
        }
      }

      await trx
        .updateTable("inspectionSamplingPlan")
        .set({
          gaugeId: args.gaugeId,
          gaugeRecordedAt: args.gaugeId ? sql<string>`now()` : null,
          updatedBy: args.userId,
          updatedAt: sql<string>`now()`
        })
        .where("id", "=", plan.id)
        .execute();

      return {
        inspectionFeatureId: args.inspectionFeatureId,
        gaugeId: args.gaugeId
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to record gauge"
    );
  }
}

// -------------------------------------------------------------
// 5c. getRecentInspectionGauges
// -------------------------------------------------------------
// The gauges most recently recorded on inspections at the same "station" as
// this lot, newest first — the execution view lists them above the rest. A Job
// Operation lot's station is its operation's work center; receipts are one
// station of their own. A work-centerless operation has no history.

export const RECENT_INSPECTION_GAUGE_LIMIT = 10;

export async function getRecentInspectionGauges(
  db: Kysely<KyselyDatabase>,
  args: { inspectionId: string; companyId: string }
): Promise<Result<string[]>> {
  try {
    // One round trip: `lot` is this inspection, `used` is the inspection the
    // gauge was recorded on, and each is joined to its operation's work center
    // (null for a receipt lot).
    const rows = await db
      .selectFrom("inspectionSamplingPlan")
      .innerJoin("inspection as used", (join) =>
        join
          .onRef("used.id", "=", "inspectionSamplingPlan.inspectionId")
          .onRef("used.companyId", "=", "inspectionSamplingPlan.companyId")
      )
      .innerJoin("inspection as lot", (join) =>
        join
          .onRef("lot.sourceDocument", "=", "used.sourceDocument")
          .on("lot.id", "=", args.inspectionId)
          .on("lot.companyId", "=", args.companyId)
      )
      .leftJoin("jobOperation as usedOperation", (join) =>
        join
          .onRef("usedOperation.id", "=", "used.sourceDocumentLineId")
          .onRef("usedOperation.companyId", "=", "used.companyId")
      )
      .leftJoin("jobOperation as lotOperation", (join) =>
        join
          .onRef("lotOperation.id", "=", "lot.sourceDocumentLineId")
          .onRef("lotOperation.companyId", "=", "lot.companyId")
      )
      .select("inspectionSamplingPlan.gaugeId")
      .where("inspectionSamplingPlan.companyId", "=", args.companyId)
      .where("inspectionSamplingPlan.gaugeId", "is not", null)
      .where("inspectionSamplingPlan.gaugeRecordedAt", "is not", null)
      .where((eb) =>
        eb.or([
          eb("lot.sourceDocument", "=", "Receipt"),
          eb(
            "usedOperation.workCenterId",
            "=",
            eb.ref("lotOperation.workCenterId")
          )
        ])
      )
      .groupBy("inspectionSamplingPlan.gaugeId")
      .orderBy(
        (eb) => eb.fn.max("inspectionSamplingPlan.gaugeRecordedAt"),
        "desc"
      )
      .limit(RECENT_INSPECTION_GAUGE_LIMIT)
      .$narrowType<{ gaugeId: NotNull }>()
      .execute();

    return { data: rows.map((row) => row.gaugeId), error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to load recent gauges"
    );
  }
}

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

      const lotSize = Math.max(
        1,
        Math.floor(Number(operation.operationQuantity ?? job.quantity ?? 1))
      );

      const { samplingStandard, plan, snapshot, featurePlans } =
        await resolveLotSamplingPlans(trx, {
          inspectionDocumentId: operation.inspectionDocumentId,
          lotSize,
          companyId: args.companyId
        });

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

      await insertLotSamplingPlans(trx, featurePlans, {
        inspectionId: inserted.id,
        companyId: args.companyId,
        userId: args.userId
      });

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

  // A first article inspects an Active plan version only: a Draft can still
  // change under the lot, and every version of a plan is its own row, so
  // counting all of them made a plan with a second version read as two.
  const firstArticleSlots = await db
    .selectFrom("itemInspectionDocumentAssignment")
    .innerJoin("inspectionDocument", (join) =>
      join
        .onRef(
          "inspectionDocument.id",
          "=",
          "itemInspectionDocumentAssignment.inspectionDocumentId"
        )
        .onRef(
          "inspectionDocument.companyId",
          "=",
          "itemInspectionDocumentAssignment.companyId"
        )
    )
    .select([
      "itemInspectionDocumentAssignment.itemId",
      "itemInspectionDocumentAssignment.inspectionDocumentId"
    ])
    .where("itemInspectionDocumentAssignment.usage", "=", "First Article")
    .where("itemInspectionDocumentAssignment.itemId", "in", itemIds)
    .where("itemInspectionDocumentAssignment.companyId", "=", args.companyId)
    .where("inspectionDocument.status", "=", "Active")
    .execute();

  const partPlans = await db
    .selectFrom("inspectionDocument")
    .select(["id", "partId"])
    .where("partId", "in", itemIds)
    .where("companyId", "=", args.companyId)
    .where("status", "=", "Active")
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

  // Last production of each part, through its make methods rather than the
  // job's own item: a made sub-assembly is usually built inside a parent job,
  // so grouping by job.itemId never saw it and a lapse went undetected. Every
  // job has a root make method, so top-level parts are covered too.
  const completedJobs = await db
    .selectFrom("jobMakeMethod")
    .innerJoin("job", (join) =>
      join
        .onRef("job.id", "=", "jobMakeMethod.jobId")
        .onRef("job.companyId", "=", "jobMakeMethod.companyId")
    )
    .select([
      "jobMakeMethod.itemId as itemId",
      sql<string>`to_char(max("job"."completedDate") AT TIME ZONE ${company.timezone}, 'YYYY-MM-DD')`.as(
        "lastCompletedJobDate"
      )
    ])
    .where("job.status", "in", ["Completed", "Closed"])
    .where("job.completedDate", "is not", null)
    .where("job.id", "<>", job.id)
    .where("jobMakeMethod.itemId", "in", itemIds)
    .where("jobMakeMethod.companyId", "=", args.companyId)
    .groupBy("jobMakeMethod.itemId")
    .execute();

  // An open (Draft / Verified) FAI for the part on another job is the part's
  // first article in progress: this job neither blocks on nor starts another.
  // A report whose job was deleted (jobId null) does not count.
  const openElsewhere = await db
    .selectFrom("firstArticleInspection")
    .select(["itemId"])
    .distinct()
    .where("status", "in", ["Draft", "Verified"])
    .where("jobId", "<>", job.id)
    .where("itemId", "in", itemIds)
    .where("companyId", "=", args.companyId)
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
  const openElsewhereItemIds = new Set(openElsewhere.map((row) => row.itemId));

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
        hasFirstArticleLot: lotMakeMethodIds.has(makeMethod.id),
        hasOpenFirstArticleElsewhere: openElsewhereItemIds.has(
          makeMethod.itemId
        )
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
            // A plan's name names the plan ("R1234 Receipt"), not a drawing,
            // so Form 1's drawing number is the inspector's to fill in.
            drawingNumber: null,
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
