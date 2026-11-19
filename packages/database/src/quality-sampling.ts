// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Lot sampling: the plans a new lot starts with, the plan rows a lot gains when
// its document gains characteristics, and the samples prefilled when a serial
// lot inspects every unit. Public through `./quality.ts`.
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { withTransaction } from "./client.ts";
import { errResult, isInspectionClosed, type Result } from "./quality-core.ts";
import type { SamplingPlanInput, SamplingStandard } from "./sampling.ts";
import { resolveFeatureSamplingPlan, resolveSamplingPlan } from "./sampling.ts";

// The sampling hierarchy is: feature rule -> document default -> All. This
// maps an inspectionDocument row's default-rule columns into the engine's
// plan shape (NUMERIC columns come back from pg as strings — coerce).
export function toSamplingPlanInput(
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

// -------------------------------------------------------------
// Lot sampling plans
// -------------------------------------------------------------
// The lot-level snapshot and the per-feature plans a new lot starts with. The
// document's default sampling rule is both the lot-level plan base and the
// fallback for features without their own rule. No document (or no default
// set) means 100% inspection.

export async function resolveLotSamplingPlans(
  trx: Transaction<KyselyDatabase>,
  args: {
    inspectionDocumentId: string | null;
    lotSize: number;
    companyId: string;
  }
) {
  const settings = await trx
    .selectFrom("companySettings")
    .select(["samplingStandard"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  const samplingStandard = (settings?.samplingStandard ??
    "ANSI_Z1_4") as SamplingStandard;

  const documentDefault = args.inspectionDocumentId
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
        .where("id", "=", args.inspectionDocumentId)
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

  const snapshot = resolveSamplingPlan(plan, args.lotSize, samplingStandard);

  const documentFeatures = args.inspectionDocumentId
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
        .where("inspectionDocumentId", "=", args.inspectionDocumentId)
        .where("companyId", "=", args.companyId)
        .execute()
    : [];
  const featurePlans = documentFeatures.map((feature) => ({
    inspectionFeatureId: feature.id,
    resolved: resolveFeatureSamplingPlan(
      feature,
      defaultPlan,
      args.lotSize,
      samplingStandard
    )
  }));

  return { samplingStandard, plan, snapshot, featurePlans };
}

export async function insertLotSamplingPlans(
  trx: Transaction<KyselyDatabase>,
  featurePlans: Awaited<
    ReturnType<typeof resolveLotSamplingPlans>
  >["featurePlans"],
  args: { inspectionId: string; companyId: string; userId: string }
) {
  if (featurePlans.length === 0) return;
  await trx
    .insertInto("inspectionSamplingPlan")
    .values(
      featurePlans.map((p) => ({
        inspectionId: args.inspectionId,
        inspectionFeatureId: p.inspectionFeatureId,
        sampleSize: p.resolved.sampleSize,
        acceptanceNumber: p.resolved.acceptance,
        rejectionNumber: p.resolved.rejection,
        codeLetter: p.resolved.codeLetter,
        companyId: args.companyId,
        createdBy: args.userId
      }))
    )
    .execute();
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
    const result = await withTransaction(db, async (trx) => {
      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
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
        const resolved = resolveFeatureSamplingPlan(
          feature,
          defaultPlan,
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

/**
 * Adds a Pending sample (no verdict) for each unit, in serial order, and
 * returns how many it added. The grid orders samples by createdAt, then id;
 * one statement shares one now(), so each row is a microsecond later to keep
 * serial order. A unit the lot already samples is skipped by the unique
 * (inspectionId, trackedEntityId) index.
 */
export async function insertPrefilledSamples(
  trx: Transaction<KyselyDatabase>,
  args: {
    inspectionId: string;
    units: readonly { id: string; readableId: string | null }[];
    companyId: string;
    userId: string;
  }
): Promise<number> {
  if (args.units.length === 0) return 0;
  const ordered = [...args.units].sort((a, b) =>
    (a.readableId ?? a.id).localeCompare(b.readableId ?? b.id, undefined, {
      numeric: true
    })
  );
  const inserted = await trx
    .insertInto("inspectionSample")
    .values(
      ordered.map((unit, index) => ({
        inspectionId: args.inspectionId,
        trackedEntityId: unit.id,
        status: "Pending" as const,
        companyId: args.companyId,
        createdBy: args.userId,
        createdAt: sql<string>`now() + make_interval(secs => ${index} * 0.000001)`
      }))
    )
    .onConflict((oc) =>
      oc
        .columns(["inspectionId", "trackedEntityId"])
        .where("trackedEntityId", "is not", null)
        .doNothing()
    )
    .returning(["id"])
    .execute();
  return inserted.length;
}

// -------------------------------------------------------------
// Prefilled samples
// -------------------------------------------------------------
// When a serial lot's plan inspects every unit there is nothing to choose, so
// every unit is a sample from the start (Pending, no verdict) and the
// inspector records results without scanning. A lot that samples some of its
// units keeps the scanner: which units is the inspector's choice. The units
// are the source's: a receipt line's, a job make method's (not Consumed,
// Rejected or Scrapped), a manual lot's own. Idempotent: a unit already
// sampled is left alone, and a concurrent call loses on the unique
// (inspectionId, trackedEntityId) index.

const PREFILL_EXCLUDED_STATUSES = ["Consumed", "Rejected", "Scrapped"] as const;

export async function prefillInspectionSamples(
  db: Kysely<KyselyDatabase>,
  args: { inspectionId: string; companyId: string; userId: string }
): Promise<Result<{ added: number }>> {
  try {
    const result = await withTransaction(db, async (trx) => {
      const lot = await trx
        .selectFrom("inspection")
        .innerJoin("item", "item.id", "inspection.itemId")
        .select([
          "inspection.id",
          "inspection.status",
          "inspection.sourceDocument",
          "inspection.sourceDocumentLineId",
          "inspection.sampleSize",
          "item.itemTrackingType"
        ])
        .where("inspection.id", "=", args.inspectionId)
        .where("inspection.companyId", "=", args.companyId)
        .executeTakeFirst();
      if (
        !lot ||
        lot.itemTrackingType !== "Serial" ||
        isInspectionClosed(lot.status)
      ) {
        return { added: 0 };
      }

      let units: { id: string; readableId: string | null }[] = [];
      if (lot.sourceDocument === "Manual") {
        units = await trx
          .selectFrom("inspectionTrackedEntity as ite")
          .innerJoin("trackedEntity", "trackedEntity.id", "ite.trackedEntityId")
          .select(["trackedEntity.id", "trackedEntity.readableId"])
          .where("ite.inspectionId", "=", lot.id)
          .where("ite.companyId", "=", args.companyId)
          .execute();
      } else if (lot.sourceDocumentLineId) {
        let makeMethodId: string | null = null;
        if (lot.sourceDocument === "Job Operation") {
          const operation = await trx
            .selectFrom("jobOperation")
            .select(["jobMakeMethodId"])
            .where("id", "=", lot.sourceDocumentLineId)
            .where("companyId", "=", args.companyId)
            .executeTakeFirst();
          makeMethodId = operation?.jobMakeMethodId ?? null;
          if (!makeMethodId) return { added: 0 };
        }
        units = await trx
          .selectFrom("trackedEntity")
          .select(["id", "readableId"])
          .where(
            lot.sourceDocument === "Receipt"
              ? sql<string>`attributes ->> 'Receipt Line'`
              : sql<string>`attributes ->> 'Job Make Method'`,
            "=",
            lot.sourceDocument === "Receipt"
              ? lot.sourceDocumentLineId
              : makeMethodId!
          )
          .where("status", "not in", [...PREFILL_EXCLUDED_STATUSES])
          .where("companyId", "=", args.companyId)
          .execute();
      }

      // Only when the plan inspects every unit.
      if (units.length === 0 || units.length > lot.sampleSize) {
        return { added: 0 };
      }

      const sampled = await trx
        .selectFrom("inspectionSample")
        .select(["trackedEntityId"])
        .where("inspectionId", "=", lot.id)
        .where("companyId", "=", args.companyId)
        .where("trackedEntityId", "is not", null)
        .execute();
      const sampledIds = new Set(sampled.map((s) => s.trackedEntityId));
      const added = await insertPrefilledSamples(trx, {
        inspectionId: lot.id,
        units: units.filter((unit) => !sampledIds.has(unit.id)),
        companyId: args.companyId,
        userId: args.userId
      });

      return { added };
    });
    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error
        ? err.message
        : "Failed to prefill inspection samples"
    );
  }
}
