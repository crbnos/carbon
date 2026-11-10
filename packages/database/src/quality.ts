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
import type { Insertable, NotNull, Selectable, Transaction } from "kysely";
import { sql } from "kysely";
import type { Kysely, KyselyDatabase } from "./client.ts";
import { withTransaction } from "./client.ts";
import {
  computeLotStatus,
  deriveSampleStatus,
  valuateMeasurement
} from "./inspection-verdict.ts";
import { EPSILON, RoundingMode, round } from "./precision.ts";
import type { SamplingPlanInput, SamplingStandard } from "./sampling.ts";
import { resolveFeatureSamplingPlan, resolveSamplingPlan } from "./sampling.ts";
import { getNextSequence } from "./sequence.ts";

type Ok<T> = { data: T; error: null };
type Err = {
  data: null;
  error: { message: string; blockers?: unknown; cause?: unknown };
};
export type Result<T> = Ok<T> | Err;

export { valuateMeasurement };

export function errResult(message: string, blockers?: unknown): Err {
  return { data: null, error: { message, ...(blockers ? { blockers } : {}) } };
}

export function isDatabaseError(err: unknown): boolean {
  const e = err as { code?: unknown; severity?: unknown } | null;
  return typeof e?.code === "string" && typeof e?.severity === "string";
}

export function engineErrResult(err: unknown, fallback: string): Err {
  const code = (err as { code?: unknown } | null)?.code;
  if (isDatabaseError(err) && code !== "P0001") {
    const message =
      code === "40P01" || code === "40001"
        ? "Another change was saved at the same time. Try again."
        : fallback;
    return { data: null, error: { message, cause: err } };
  }
  return errResult(err instanceof Error ? err.message : fallback);
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
  // Why a lot is rejected when no characteristic reached its rejection number
  // and no sample failed — a suspected counterfeit, the wrong part, transit
  // damage. A Reject with a reason needs no failure; it is stored as the lot's
  // notes when `notes` is empty.
  reason?: string;
  companyId: string;
  dispositionedBy: string;
  // One-shot mode: refuse to disposition a lot that is already terminal
  // (Passed/Failed/Partial). The MES disposition route passes this because its
  // dispositions drive physical postings (scrap/rework/complete) that must not
  // re-run.
  requireOpen?: boolean;
  // Restrict the disposition to lots of these sources. The ERP Accept/Reject/Partial
  // routes pass Receipt and Manual because their verdicts carry NO physical
  // production posting — accepting a Job Operation lot here would hard-terminate
  // it with no complete/scrap/rework and wedge the operation (whose outcome the
  // MES disposition route owns). The MES job-operation route omits this so it
  // can disposition Job Operation lots.
  requireSource?: InspectionSource | InspectionSource[];
  // Partial on an untracked (Inventory) receipt lot: how much passed. Required
  // there, ignored otherwise.
  acceptedQuantity?: number;
};

export type InspectionSource = "Receipt" | "Job Operation" | "Manual";

export type ManualInspectionInput = {
  trackedEntityIds: string[];
  inspectionDocumentId?: string | null;
  workCenterId?: string | null;
  assignee?: string | null;
  notes?: string | null;
  companyId: string;
  userId: string;
};

// Receipt and Manual lots inspect stock that waits On Hold for the verdict, so
// a sample verdict and the lot disposition move their tracked entities. Job
// Operation lots inspect WIP whose status belongs to the job.
function holdsLotEntities(sourceDocument: string): boolean {
  return sourceDocument === "Receipt" || sourceDocument === "Manual";
}

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

// Terminal lot statuses. Passed/Failed/Partial are all hard-terminal: once
// dispositioned, samples and measurements are immutable (Partial is the mixed
// close — some units passed, some failed, each already routed to its outcome).
// Cancelled is a manual lot taken off the queue with no verdict, or the lot
// of a voided receipt.
const INSPECTION_CLOSED_STATUSES = [
  "Passed",
  "Failed",
  "Partial",
  "Cancelled"
] as const;

/**
 * Lets this transaction move stock the goods-in inspection hold guards
 * (`check_inspection_hold` on `itemLedger`). Call it only from a posting that
 * IS the release. Transaction-local.
 */
export async function setInspectionRelease(
  trx: Transaction<KyselyDatabase>
): Promise<void> {
  await sql`SELECT set_config('app.inspection_release', 'on', true)`.execute(
    trx
  );
}

export async function withInspectionRelease<T>(
  trx: Transaction<KyselyDatabase>,
  fn: () => Promise<T>
): Promise<T> {
  const before = await sql<{ previous: string | null }>`
    SELECT current_setting('app.inspection_release', true) AS previous
  `.execute(trx);
  await setInspectionRelease(trx);
  const previous = before.rows[0]?.previous === "on" ? "on" : "off";
  const restore = () =>
    sql`SELECT set_config('app.inspection_release', ${previous}, true)`.execute(
      trx
    );
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await restore().catch((restoreError: unknown) => {
      if ((restoreError as { code?: unknown } | null)?.code !== "25P02") {
        console.error("inspection release: restore failed", restoreError);
      }
    });
    throw error;
  }
  await restore();
  return result;
}

export async function storageUnitLocationId(
  handle: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  storageUnitId: string
): Promise<string | null> {
  const unit = await handle
    .selectFrom("storageUnit")
    .select("locationId")
    .where("id", "=", storageUnitId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return unit?.locationId ?? null;
}

export async function lockClaimUnit(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string;
    locationId?: string | null;
    stockRowsLocked?: boolean;
  }
): Promise<void> {
  if (!args.stockRowsLocked) {
    const locationId =
      args.locationId ??
      (await storageUnitLocationId(trx, args.companyId, args.storageUnitId));
    if (!locationId) throw new Error("The storage unit could not be found");
    await lockItemStockRows(trx, args.companyId, [
      { itemId: args.itemId, locationId }
    ]);
  }
  await lockHeldUnits(trx, args.companyId, [args]);
}

export async function lotClaimableAtUnit(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string;
    ownHeld: number;
    locationId?: string | null;
    stockRowsLocked?: boolean;
  }
): Promise<number> {
  await lockClaimUnit(trx, args);
  const [row] = (
    await sql<{ onHand: number; held: number }>`
      SELECT
        public.inspection_untracked_on_hand(${args.companyId}, ${args.itemId}, ${args.storageUnitId}) AS "onHand",
        public.inspection_held_quantity(${args.companyId}, ${args.itemId}, ${args.storageUnitId}) AS "held"
    `.execute(trx)
  ).rows;
  const otherHeld = Number(row?.held ?? 0) - args.ownHeld;
  return round(Math.max(Number(row?.onHand ?? 0) - otherHeld, 0));
}

export async function lockItemStockRows(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  pairs: Array<{ itemId: string; locationId: string }>
): Promise<void> {
  if (pairs.length === 0) return;
  await sql`
    SELECT 1 FROM "itemStockQuantities" q
    JOIN unnest(${pairs.map((p) => p.itemId)}::text[], ${pairs.map((p) => p.locationId)}::text[]) AS k(i, l)
      ON q."itemId" = k.i AND q."locationId" = k.l
    WHERE q."companyId" = ${companyId}
    ORDER BY q."itemId", q."locationId", q."projectId"
    FOR UPDATE OF q
  `.execute(trx);
}

export async function lockHeldUnits(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  pairs: Array<{ itemId: string; storageUnitId: string }>
): Promise<void> {
  if (pairs.length === 0) return;
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('inspection-hold:' || ${companyId} || ':' || k.i || ':' || k.u, 0))
    FROM unnest(${pairs.map((p) => p.itemId)}::text[], ${pairs.map((p) => p.storageUnitId)}::text[]) AS k(i, u)
    ORDER BY k.i, k.u`.execute(trx);
}

function inTransaction<T>(
  db: Kysely<KyselyDatabase>,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<KyselyDatabase>);
  return db.transaction().execute(fn);
}

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

export function isInspectionClosed(status: string): boolean {
  return (INSPECTION_CLOSED_STATUSES as readonly string[]).includes(status);
}

// A receipt lot is closed once its receipt is voided: the stock it inspects was
// never received. Accepting it made the voided serials and batches Available
// again, and rejecting an untracked lot wrote the reversed stock off a second
// time. FOR SHARE waits for a void that is running, which locks the receipt.
async function assertReceiptNotVoided(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  inspection: { sourceDocument: string; sourceDocumentId: string | null },
  lock: "share" | "noKeyUpdate" = "share"
): Promise<void> {
  if (inspection.sourceDocument !== "Receipt" || !inspection.sourceDocumentId)
    return;
  const query = trx
    .selectFrom("receipt")
    .select("status")
    .where("id", "=", inspection.sourceDocumentId)
    .where("companyId", "=", companyId);
  const receipt = await (lock === "share"
    ? query.forShare()
    : query.forNoKeyUpdate()
  ).executeTakeFirst();
  if (receipt?.status === "Voided") {
    throw new Error("The receipt of this inspection was voided");
  }
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
// 2. dispositionInspection
// -------------------------------------------------------------
// Writes:
//   - trackedEntity.status
//   - inspection (status, dispositionedBy/At, notes)
//   - inspectionHistory (1 row for future plan auto-switching)

/**
 * Whether a lot has failed inspection, so it can be rejected with no reason
 * given. A document-driven lot fails when a characteristic reaches its
 * rejection number or a sample fails; a lot with no characteristics when its
 * failed samples pass the acceptance number. Anything else — a suspected
 * counterfeit, the wrong part — needs a reason. The ERP and MES Reject
 * buttons apply the same rule.
 */
export function isRejectableWithoutReason(lot: {
  features: { rejectionNumber: number; failed: number }[];
  failedSamples: number;
  acceptanceNumber: number;
}): boolean {
  if (lot.features.length > 0) {
    return (
      lot.features.some((f) => f.failed >= f.rejectionNumber) ||
      lot.failedSamples > 0
    );
  }
  return lot.failedSamples > lot.acceptanceNumber;
}

export type HeldStripe = { projectId: string | null; quantity: number };

export async function heldStockStripes(
  trx: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    storageUnitId: string | null;
    locationId?: string | null;
    documentIds: string[];
  }
): Promise<HeldStripe[]> {
  if (args.storageUnitId === null && !args.locationId) {
    throw new Error("Stock in no storage unit is read at a location");
  }
  const documentIds = args.documentIds.filter(Boolean);
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "projectId",
      sql<number>`SUM("quantity")`.as("quantity"),
      (documentIds.length > 0
        ? sql<number>`COALESCE(SUM("quantity") FILTER (WHERE "quantity" > 0 AND "documentId" IN (${sql.join(documentIds)})), 0)`
        : sql<number>`0`
      ).as("lotShare")
    ])
    .where("companyId", "=", args.companyId)
    .where("itemId", "=", args.itemId)
    .$if(args.storageUnitId !== null, (qb) =>
      qb.where("storageUnitId", "=", args.storageUnitId)
    )
    .$if(args.storageUnitId === null, (qb) =>
      qb
        .where("storageUnitId", "is", null)
        .where("locationId", "=", args.locationId as string)
    )
    .where("trackedEntityId", "is", null)
    .groupBy("projectId")
    .execute();
  return rows
    .map((row) => ({
      projectId: row.projectId,
      quantity: round(Number(row.quantity)),
      lotShare: Number(row.lotShare)
    }))
    .filter((row) => row.quantity > EPSILON)
    .sort(
      (a, b) =>
        b.lotShare - a.lotShare ||
        b.quantity - a.quantity ||
        (a.projectId ?? "").localeCompare(b.projectId ?? "")
    )
    .map(({ projectId, quantity }) => ({ projectId, quantity }));
}

export function drawHeldStripes(
  quantity: number,
  available: readonly HeldStripe[],
  options: { overflow?: boolean } = {}
): HeldStripe[] {
  const draws: HeldStripe[] = [];
  let remaining = round(quantity);
  for (const stripe of available) {
    if (remaining <= EPSILON) break;
    const take = round(Math.min(remaining, stripe.quantity));
    if (take <= EPSILON) continue;
    draws.push({ projectId: stripe.projectId, quantity: take });
    remaining = round(remaining - take);
  }
  if (options.overflow && remaining > EPSILON) {
    const unassigned = draws.find((draw) => draw.projectId === null);
    if (unassigned)
      unassigned.quantity = round(unassigned.quantity + remaining);
    else draws.push({ projectId: null, quantity: remaining });
  }
  return draws;
}

/**
 * What the rejected move takes out of the held unit: each listed serial or
 * batch unit with its on-hand there, or (untracked) up to `untrackedQuantity`
 * of the item's on-hand there. Never more than is there.
 */
async function rejectedMoves(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    fromStorageUnitId: string;
    trackedEntityIds: string[] | null;
    untrackedQuantity: number | null;
    documentIds: string[];
  }
): Promise<
  Array<{
    trackedEntityId: string | null;
    projectId: string | null;
    quantity: number;
  }>
> {
  if (args.trackedEntityIds === null) {
    if (!args.untrackedQuantity || args.untrackedQuantity <= EPSILON) return [];
    const stripes = await heldStockStripes(trx, {
      companyId: args.companyId,
      itemId: args.itemId,
      storageUnitId: args.fromStorageUnitId,
      documentIds: args.documentIds
    });
    return drawHeldStripes(args.untrackedQuantity, stripes).map((draw) => ({
      trackedEntityId: null,
      ...draw
    }));
  }
  if (args.trackedEntityIds.length === 0) return [];
  const rows = await trx
    .selectFrom("itemLedger")
    .select([
      "trackedEntityId",
      "projectId",
      sql<number>`SUM("quantity")`.as("quantity")
    ])
    .where("companyId", "=", args.companyId)
    .where("storageUnitId", "=", args.fromStorageUnitId)
    .where("trackedEntityId", "in", args.trackedEntityIds)
    .groupBy(["trackedEntityId", "projectId"])
    .execute();
  return rows
    .map((row) => ({
      trackedEntityId: row.trackedEntityId,
      projectId: row.projectId,
      quantity: round(Number(row.quantity))
    }))
    .filter((row) => row.quantity > EPSILON);
}

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
      storageUnitId: string | null;
      stripes: HeldStripe[];
    } | null;
    // The untracked quantity a Partial left rejected; the caller opens an NCR
    // for it. Null otherwise.
    rejectedQuantity: number | null;
  }>
> {
  const nowIso = new Date().toISOString();

  try {
    const result = await inTransaction(db, async (trx) => {
      const source = await trx
        .selectFrom("inspection")
        .select(["sourceDocument", "sourceDocumentId"])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
      if (!source) throw new Error("Inspection not found");
      const allowedSources = args.requireSource
        ? ([] as InspectionSource[]).concat(args.requireSource)
        : null;
      if (
        allowedSources &&
        !allowedSources.includes(source.sourceDocument as InspectionSource)
      ) {
        throw new Error(
          `This disposition is only available for ${allowedSources.join(" and ")} inspections`
        );
      }
      await assertReceiptNotVoided(trx, args.companyId, source, "noKeyUpdate");

      const inspection = await trx
        .selectFrom("inspection")
        .select([
          "id",
          "storageUnitId",
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
          "sampleSize",
          "acceptanceNumber"
        ])
        .where("id", "=", args.id)
        .where("companyId", "=", args.companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!inspection) throw new Error("Inspection not found");
      // Only a receipt lot is dispositioned again (the write-off retry); a
      // manual lot's verdict is final.
      if (
        (args.requireOpen || inspection.sourceDocument === "Manual") &&
        isInspectionClosed(inspection.status)
      ) {
        throw new Error("Inspection is already dispositioned");
      }
      const isReceiptSource = inspection.sourceDocument === "Receipt";
      const isRejectRetry =
        inspection.status === "Failed" && args.decision === "Reject";
      if (
        isReceiptSource &&
        isInspectionClosed(inspection.status) &&
        !isRejectRetry
      ) {
        throw new Error(
          inspection.status === "Partial"
            ? "This lot is already partly accepted. Its NCR decides the rest."
            : inspection.status === "Cancelled"
              ? "This lot was cancelled with its receipt."
              : "This lot is already decided."
        );
      }

      const item = await trx
        .selectFrom("item")
        .select(["itemTrackingType"])
        .where("id", "=", inspection.itemId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();

      // Receipt-sourced lots: the received tracked entities and the receiving
      // location hang off the receipt line. Manual lots list their entities in
      // inspectionTrackedEntity. Job Operation lots have none to flip: they act
      // on WIP, not stock.
      const receiptLine =
        isReceiptSource && inspection.sourceDocumentLineId
          ? await trx
              .selectFrom("receiptLine")
              .select(["locationId", "storageUnitId"])
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
          : inspection.sourceDocument === "Manual"
            ? await trx
                .selectFrom("inspectionTrackedEntity")
                .select(["trackedEntityId as id"])
                .where("inspectionId", "=", args.id)
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

      const countsByFeature = new Map<
        string,
        { recorded: number; failed: number }
      >();
      if (lotFeatures.length > 0) {
        const measurements = await trx
          .selectFrom("inspectionMeasurement")
          .select(["inspectionFeatureId", "status"])
          .where("inspectionId", "=", args.id)
          .execute();
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
      }

      if (
        args.decision === "Reject" &&
        !args.reason?.trim() &&
        !isRejectableWithoutReason({
          features: lotFeatures.map((f) => ({
            rejectionNumber: f.rejectionNumber,
            failed: countsByFeature.get(f.inspectionFeatureId)?.failed ?? 0
          })),
          failedSamples: failures,
          acceptanceNumber: inspection.acceptanceNumber
        })
      ) {
        throw new Error(
          "Cannot reject: the lot has not failed inspection. Give a reason to reject it anyway."
        );
      }

      if (
        args.decision === "Partial" &&
        isReceiptSource &&
        item?.itemTrackingType === "Batch"
      ) {
        throw new Error("A batch lot is accepted or rejected as a whole.");
      }
      if (
        args.decision === "Partial" &&
        isReceiptSource &&
        item?.itemTrackingType === "Non-Inventory"
      ) {
        throw new Error(
          "A non-inventory lot is accepted or rejected as a whole."
        );
      }
      if (args.decision === "Partial" && isReceiptSource) {
        const links = await trx
          .selectFrom("nonConformanceInspection as link")
          .innerJoin("nonConformance as ncr", "ncr.id", "link.nonConformanceId")
          .leftJoin("nonConformanceInspection as sibling", (join) =>
            join
              .onRef("sibling.nonConformanceId", "=", "link.nonConformanceId")
              .onRef("sibling.inspectionId", "!=", "link.inspectionId")
          )
          .select(["ncr.status", "sibling.inspectionId as siblingId"])
          .where("link.inspectionId", "=", args.id)
          .where("link.companyId", "=", args.companyId)
          .execute();
        if (links.some((link) => link.siblingId)) {
          throw new Error(
            "This lot shares its NCR with other lots. A Partial lot must be the only lot on its NCR."
          );
        }
        if (
          item?.itemTrackingType === "Inventory" &&
          links.some((link) => link.status === "Closed")
        ) {
          throw new Error(
            "This lot's NCR is already closed, so nothing would decide its rejected part. Remove the link or reject the lot."
          );
        }
      }
      const isTrackedReceiptLot = isReceiptSource && allLotIds.length > 0;
      if (
        args.decision === "Partial" &&
        isTrackedReceiptLot &&
        item?.itemTrackingType !== "Inventory"
      ) {
        const failedUnits = allLotIds.filter((id) => failedEntityIds.has(id));
        const passedSamples = existingSamples.filter(
          (s) => s.status === "Passed"
        ).length;
        const inspectedSamples = existingSamples.filter(
          (s) => s.status !== "Pending"
        ).length;
        const samplingComplete =
          lotFeatures.length > 0
            ? lotFeatures.every(
                (f) =>
                  (countsByFeature.get(f.inspectionFeatureId)?.recorded ?? 0) >=
                  f.sampleSize
              )
            : inspectedSamples >= inspection.sampleSize;
        if (failedUnits.length === 0) {
          throw new Error(
            "Cannot mark the lot partial: no unit of it failed its sample. Accept the lot, or reject it."
          );
        }
        if (passedSamples === 0) {
          throw new Error(
            "Cannot mark the lot partial: no sample passed. Reject the lot."
          );
        }
        if (!samplingComplete) {
          throw new Error(
            "Cannot mark the lot partial: sampling is incomplete for one or more features"
          );
        }
      }

      // Reject = entire lot non-conforming (ISO 9001:2015 §8.7). Accept
      // releases every lot entity that didn't fail a sample — un-sampled and
      // partially-inspected (Pending) units included — and rejects the failed
      // ones. Partial on a receipt lot does the same.
      let lotStatus: "Passed" | "Failed" | "Partial";
      const flips: { ids: string[]; status: "Available" | "Rejected" }[] = [];
      switch (args.decision) {
        case "Accept":
        case "Partial":
          lotStatus = args.decision === "Accept" ? "Passed" : "Partial";
          flips.push(
            {
              ids: allLotIds.filter((id) => !failedEntityIds.has(id)),
              status: "Available"
            },
            {
              ids: allLotIds.filter((id) => failedEntityIds.has(id)),
              status: "Rejected"
            }
          );
          break;
        case "Reject":
          lotStatus = "Failed";
          flips.push({ ids: allLotIds, status: "Rejected" });
          break;
      }

      const wasOpen = !isInspectionClosed(inspection.status);

      const isUntracked = item?.itemTrackingType === "Inventory";
      const heldStorageUnitId =
        inspection.storageUnitId ?? receiptLine?.storageUnitId ?? null;
      const lotDocumentIds = [inspection.id, inspection.sourceDocumentId ?? ""];

      // The unaccepted rest stays held (inspection_held_quantity) until the
      // lot's NCR closes.
      let acceptedQuantity: number | null = null;
      let rejectedQuantity: number | null = null;
      if (args.decision === "Partial" && isReceiptSource && isUntracked) {
        const accepted = round(Number(args.acceptedQuantity));
        if (
          args.acceptedQuantity === undefined ||
          !Number.isFinite(accepted) ||
          accepted < 0 ||
          round(inspection.lotSize - accepted) <= EPSILON
        ) {
          throw new Error(
            "Enter the accepted quantity: more than 0 and less than the lot size"
          );
        }
        if (accepted <= EPSILON) {
          throw new Error(
            "That is the whole lot rejected. Use Reject Lot instead."
          );
        }
        acceptedQuantity = accepted;
        rejectedQuantity = round(inspection.lotSize - accepted);
      } else if (
        isReceiptSource &&
        allLotIds.length > 0 &&
        (args.decision === "Partial" ||
          (args.decision === "Accept" &&
            allLotIds.some((id) => failedEntityIds.has(id))))
      ) {
        // A tracked lot's passed part is its Available units; the receipt's
        // inspection status reads it to tell when putaway is done.
        const passedIds = allLotIds.filter((id) => !failedEntityIds.has(id));
        const passed =
          passedIds.length > 0
            ? await trx
                .selectFrom("trackedEntity")
                .select(
                  sql<number>`COALESCE(SUM("quantity"), 0)`.as("quantity")
                )
                .where("id", "in", passedIds)
                .where("companyId", "=", args.companyId)
                .executeTakeFirst()
            : undefined;
        acceptedQuantity = round(Number(passed?.quantity ?? 0));
      }

      const untrackedTake =
        isReceiptSource && isUntracked && heldStorageUnitId
          ? args.decision === "Partial"
            ? rejectedQuantity
            : args.decision === "Reject" && inspection.lotSize > 0
              ? inspection.lotSize
              : null
          : null;
      let heldStripes: HeldStripe[] = [];
      const rejectedMove =
        isReceiptSource &&
        wasOpen &&
        heldStorageUnitId &&
        receiptLine?.locationId &&
        (args.decision === "Reject" || args.decision === "Partial")
          ? await trx
              .selectFrom("location")
              .select(["rejectedStorageUnitId"])
              .where("id", "=", receiptLine.locationId)
              .where("companyId", "=", args.companyId)
              .executeTakeFirst()
              .then((location) =>
                location?.rejectedStorageUnitId &&
                location.rejectedStorageUnitId !== heldStorageUnitId
                  ? {
                      to: location.rejectedStorageUnitId,
                      from: heldStorageUnitId,
                      locationId: receiptLine.locationId as string
                    }
                  : null
              )
          : null;
      const movesRejected = rejectedMove !== null;
      const legacyHoldsInPlace =
        args.decision === "Partial" &&
        isUntracked &&
        !inspection.storageUnitId &&
        !!heldStorageUnitId &&
        !movesRejected &&
        (await trx
          .selectFrom("storageUnit")
          .select("effectiveNettable")
          .where("id", "=", heldStorageUnitId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
          .then((unit) => !!unit && !unit.effectiveNettable));
      let writeOffQuantity = inspection.lotSize;
      if (untrackedTake !== null && heldStorageUnitId) {
        const writtenOff =
          !wasOpen &&
          (await trx
            .selectFrom("itemLedger")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("documentType", "=", "Inbound Inspection")
            .where("documentId", "=", inspection.id)
            .limit(1)
            .executeTakeFirst());
        const holdsStock =
          inspection.storageUnitId !== null || args.decision === "Partial";
        const claimable = () =>
          lotClaimableAtUnit(trx, {
            companyId: args.companyId,
            itemId: inspection.itemId,
            storageUnitId: heldStorageUnitId,
            locationId: receiptLine?.locationId,
            ownHeld:
              wasOpen && inspection.storageUnitId !== null
                ? inspection.lotSize
                : 0
          });
        if (
          args.decision === "Partial" &&
          !writtenOff &&
          (inspection.storageUnitId !== null ||
            legacyHoldsInPlace ||
            movesRejected)
        ) {
          const claim = await claimable();
          if (untrackedTake - claim > EPSILON) {
            throw new Error(
              `Only ${claim} of the ${untrackedTake} rejected are in the held storage unit, so the rest cannot stay held. Correct the stock there, or reject the lot: a Reject writes off what is there.`
            );
          }
        }
        if (args.decision === "Reject" && holdsStock && !writtenOff) {
          writeOffQuantity = wasOpen
            ? round(Math.min(inspection.lotSize, await claimable()))
            : 0;
        }
        if (args.decision === "Reject") {
          if (!holdsStock || writtenOff) {
            await lockClaimUnit(trx, {
              companyId: args.companyId,
              itemId: inspection.itemId,
              storageUnitId: heldStorageUnitId,
              locationId: receiptLine?.locationId
            });
          }
          heldStripes = await heldStockStripes(trx, {
            companyId: args.companyId,
            itemId: inspection.itemId,
            storageUnitId: heldStorageUnitId,
            documentIds: lotDocumentIds
          });
        }
      }

      // Serial and batch units move by id from the held unit. Untracked stock has
      // no id, so only the decision that closes an open lot moves it: once closed,
      // the held unit's stock may belong to another lot.
      let movedToStorageUnitId: string | null = null;
      let moveRows: Insertable<KyselyDatabase["itemLedger"]>[] = [];
      if (rejectedMove) {
        const moves = await rejectedMoves(trx, {
          companyId: args.companyId,
          itemId: inspection.itemId,
          fromStorageUnitId: rejectedMove.from,
          trackedEntityIds: isUntracked
            ? null
            : args.decision === "Reject"
              ? allLotIds
              : [...failedEntityIds].filter((id): id is string => !!id),
          untrackedQuantity:
            isUntracked && args.decision === "Partial"
              ? rejectedQuantity
              : null,
          documentIds: lotDocumentIds
        });
        if (moves.length > 0) {
          if (isUntracked) movedToStorageUnitId = rejectedMove.to;
          const [{ today }] = (
            await sql<{
              today: string;
            }>`SELECT company_today(${args.companyId})::text AS today`.execute(
              trx
            )
          ).rows as [{ today: string }];
          moveRows = moves.flatMap((move) => {
            const row = {
              postingDate: today,
              itemId: inspection.itemId,
              locationId: rejectedMove.locationId,
              trackedEntityId: move.trackedEntityId,
              projectId: move.projectId,
              entryType: "Transfer" as const,
              documentType: "Direct Transfer" as const,
              documentId: inspection.id,
              comment: "Rejected at inspection",
              companyId: args.companyId,
              createdBy: args.dispositionedBy
            };
            return [
              {
                ...row,
                storageUnitId: rejectedMove.from,
                quantity: -move.quantity
              },
              {
                ...row,
                storageUnitId: rejectedMove.to,
                quantity: move.quantity
              }
            ];
          });
        }
      }

      // Non-tracked (Inventory) items have no tracked entities to flip, so the
      // received quantity sits in itemLedger with no per-row status to exclude
      // it from on-hand. Rejecting the lot posts a compensating write-off —
      // itemLedger Negative Adjmt. + cost relief + GL — through the
      // post-nonconformance posting, which the ERP reject runs in this same
      // transaction. Tracked items are
      // handled by the status flip above; Non-Inventory never posted a
      // receipt ledger entry, so neither needs a write-off.
      const writeOff =
        args.decision === "Reject" &&
        isReceiptSource &&
        item?.itemTrackingType === "Inventory" &&
        writeOffQuantity > EPSILON
          ? {
              itemId: inspection.itemId,
              quantity: -writeOffQuantity,
              locationId: receiptLine?.locationId ?? null,
              storageUnitId: heldStorageUnitId,
              stripes: drawHeldStripes(writeOffQuantity, heldStripes, {
                overflow: true
              }).map((draw) => ({
                projectId: draw.projectId,
                quantity: -draw.quantity
              }))
            }
          : null;

      const legacyHoldUnitId =
        acceptedQuantity !== null && !movedToStorageUnitId && legacyHoldsInPlace
          ? heldStorageUnitId
          : null;

      const updated = await withInspectionRelease(trx, () =>
        trx
          .updateTable("inspection")
          .set({
            status: lotStatus,
            ...(wasOpen
              ? {
                  notes: args.notes || args.reason?.trim() || null,
                  dispositionedBy: args.dispositionedBy,
                  dispositionedAt: nowIso
                }
              : {}),
            ...(acceptedQuantity !== null ? { acceptedQuantity } : {}),
            ...((movedToStorageUnitId ?? legacyHoldUnitId)
              ? { storageUnitId: movedToStorageUnitId ?? legacyHoldUnitId }
              : {}),
            updatedBy: args.dispositionedBy,
            updatedAt: nowIso
          })
          .where("id", "=", args.id)
          .where("companyId", "=", args.companyId)
          .$if(args.requireOpen === true, (qb) =>
            qb.where("status", "not in", [...INSPECTION_CLOSED_STATUSES])
          )
          .returning(["id", "status"])
          .executeTakeFirst()
      );
      if (!updated) {
        throw new Error("Inspection is already dispositioned");
      }

      if (wasOpen) {
        for (const flip of flips) {
          if (flip.ids.length === 0) continue;
          await trx
            .updateTable("trackedEntity")
            .set({ status: flip.status })
            .where("id", "in", flip.ids)
            .where("companyId", "=", args.companyId)
            .execute();
        }
      }
      if (moveRows.length > 0) {
        await trx.insertInto("itemLedger").values(moveRows).execute();
      }

      if (wasOpen) {
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
      }

      return {
        id: updated.id,
        status: updated.status,
        writeOff,
        rejectedQuantity
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return engineErrResult(err, "Failed to disposition inspection");
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
        sampleStatus: derivedStatus
      };
    });

    return { data: result, error: null };
  } catch (err) {
    return engineErrResult(err, "Failed to save measurement");
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
// 6. getOrCreateJobOperationInspection
// -------------------------------------------------------------
// Lot sampling plans
// -------------------------------------------------------------
// The lot-level snapshot and the per-feature plans a new lot starts with. The
// document's default sampling rule is both the lot-level plan base and the
// fallback for features without their own rule. No document (or no default
// set) means 100% inspection.

async function resolveLotSamplingPlans(
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

async function insertLotSamplingPlans(
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
    const result = await db.transaction().execute(async (trx) => {
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
        const ordered = [...entities].sort((a, b) =>
          (a.readableId ?? a.id).localeCompare(
            b.readableId ?? b.id,
            undefined,
            {
              numeric: true
            }
          )
        );
        // The grid orders samples by createdAt, then id; one statement shares
        // one now(), so each row is a microsecond later to keep serial order.
        await trx
          .insertInto("inspectionSample")
          .values(
            ordered.map((entity, index) => ({
              inspectionId: id,
              trackedEntityId: entity.id,
              status: "Pending" as const,
              companyId: args.companyId,
              createdBy: args.userId,
              createdAt: sql<string>`now() + make_interval(secs => ${index} * 0.000001)`
            }))
          )
          .execute();
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
    const result = await db.transaction().execute(async (trx) => {
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
      const missing = units
        .filter((unit) => !sampledIds.has(unit.id))
        .sort((a, b) =>
          (a.readableId ?? a.id).localeCompare(
            b.readableId ?? b.id,
            undefined,
            {
              numeric: true
            }
          )
        );
      if (missing.length === 0) return { added: 0 };

      // The grid orders samples by createdAt, then id; one statement shares
      // one now(), so each row is a microsecond later to keep serial order.
      const inserted = await trx
        .insertInto("inspectionSample")
        .values(
          missing.map((unit, index) => ({
            inspectionId: lot.id,
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

      return { added: inserted.length };
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

/** One characteristic of a plan made from a model's PMI (`pmiInspectionCharacteristics`). */
export type PmiPlanCharacteristic = {
  pmiItemId: string;
  label: string;
  description: string;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit: string;
};

/**
 * Makes the inspection plan for an item from its model's PMI: a plan that
 * holds the model and no PDF, with one Measurement feature per
 * characteristic. Runs in the caller's transaction. Returns the new plan's
 * id, or null when the item already has a plan for this model — the partial
 * unique index `inspectionDocument_part_model_key` decides, so two runs for
 * one model never make two plans and an edited plan is never rewritten.
 *
 * The drawing number follows the editor's rule for a plan created without
 * one: the item's `readableIdWithRevision`, with ` (1)`, ` (2)` … when taken.
 */
export async function createPmiInspectionPlan(
  trx: Transaction<KyselyDatabase>,
  args: {
    companyId: string;
    itemId: string;
    modelUploadId: string;
    characteristics: readonly PmiPlanCharacteristic[];
    createdBy: string;
  }
): Promise<string | null> {
  const { companyId, itemId, modelUploadId, characteristics, createdBy } = args;

  const item = await trx
    .selectFrom("item")
    .select(["readableIdWithRevision"])
    .where("id", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!item) return null;

  const base = item.readableIdWithRevision?.trim() || null;
  let name = base;
  if (base) {
    const taken = new Set(
      (
        await trx
          .selectFrom("inspectionDocument")
          .select(["name"])
          .where("companyId", "=", companyId)
          .where((eb) =>
            eb.or([eb("name", "=", base), eb("name", "like", `${base} (%)`)])
          )
          .execute()
      ).map((row) => row.name)
    );
    let suffix = 0;
    while (name && taken.has(name)) {
      suffix += 1;
      name = `${base} (${suffix})`;
    }
  }

  const plan = await trx
    .insertInto("inspectionDocument")
    .values({
      companyId,
      partId: itemId,
      modelUploadId,
      name,
      createdBy
    })
    .onConflict((oc) =>
      oc
        .columns(["companyId", "partId", "modelUploadId"])
        .where((eb) =>
          eb.and([
            eb("modelUploadId", "is not", null),
            eb("rootInspectionDocumentId", "is", null)
          ])
        )
        .doNothing()
    )
    .returning(["id"])
    .executeTakeFirst();
  if (!plan) return null;

  if (characteristics.length > 0) {
    await trx
      .insertInto("inspectionFeature")
      .values(
        characteristics.map((c) => ({
          companyId,
          inspectionDocumentId: plan.id,
          // A model plan has one "page": the save RPC defaults to 1 as well,
          // and the label trigger keeps labels unique across the plan.
          pageNumber: 1,
          label: c.label,
          description: c.description,
          nominalValue: c.nominalValue,
          tolerancePlus: c.tolerancePlus,
          toleranceMinus: c.toleranceMinus,
          unit: c.unit,
          type: "Measurement" as const,
          pmiItemId: c.pmiItemId,
          createdBy
        }))
      )
      .execute();
  }

  return plan.id;
}

/**
 * Deletes the plans made from the items' model PMI that no inspection used,
 * in the caller's transaction, ahead of an item delete. A plan made for the
 * item, not by a person, must not block the delete through
 * `inspectionDocument.partId`'s RESTRICT. A used one is inspection history and
 * still refuses it, as a plan made by hand does. Returns how many it deleted.
 */
export async function deleteUnusedPmiInspectionPlans(
  trx: Transaction<KyselyDatabase>,
  args: { companyId: string; itemIds: readonly string[] }
): Promise<number> {
  if (args.itemIds.length === 0) return 0;
  const result = await trx
    .deleteFrom("inspectionDocument")
    .where("companyId", "=", args.companyId)
    .where("partId", "in", [...args.itemIds])
    .where("modelUploadId", "is not", null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("inspection")
            .select("inspection.id")
            .whereRef(
              "inspection.inspectionDocumentId",
              "=",
              "inspectionDocument.id"
            )
        )
      )
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
