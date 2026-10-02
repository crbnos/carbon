// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";

/**
 * JSON request bodies for every MES command.
 *
 * These mirror the `zfd`-based validators in `apps/mes/app/services/models.ts`,
 * which exist to coerce FormData (`zfd.numeric`, `zfd.text`). The app sends
 * JSON, so numbers arrive as numbers and booleans as booleans — but the two
 * must accept the SAME values, which `models.test.ts` pins with type-parity
 * assertions against the web validators.
 *
 * `/api/v1` is additive-only: add an optional field, never rename or remove one.
 */

export const productionEventType = ["Setup", "Labor", "Machine"] as const;
export type ProductionEventType = (typeof productionEventType)[number];

export const pickingListStatus = [
  "Draft",
  "In Progress",
  "Completed",
  "Partial",
  "Cancelled"
] as const;

/** A picking list locks once Completed, Partial or Cancelled — all terminal.
 *  Reopening is ERP-only (it needs the inventory `delete` permission), so the
 *  app must never offer it. Mirrors `isPickingListLocked` in the web models. */
export function isPickingListLocked(
  status: string | null | undefined
): boolean {
  return (
    status === "Completed" || status === "Partial" || status === "Cancelled"
  );
}

// ---------------------------------------------------------------------------
// Time events
// ---------------------------------------------------------------------------

export const startEventBody = z.object({
  jobOperationId: z.string().min(1),
  type: z.enum(productionEventType),
  workCenterId: z.string().optional(),
  trackedEntityId: z.string().optional(),
  /** The 0-based unit-axis position this event is building. */
  unitIndex: z.number().int().nonnegative().optional(),
  /** Close any other open event of this operation first. */
  exclusive: z.boolean().optional(),
  /**
   * True when the operator SCANNED a traveller rather than tapping Start.
   * The scan path carries the floor gate, the blocked-work-center check and
   * the `operationStart` rules; the in-app button path (web `x+/event.tsx`)
   * has none of those, and the two must stay distinguishable.
   */
  viaScan: z.boolean().optional()
});
export type StartEventBody = z.infer<typeof startEventBody>;

export const endEventBody = z.object({
  /** Close other open events of the same operation as well. */
  exclusive: z.boolean().optional()
});
export type EndEventBody = z.infer<typeof endEventBody>;

/** The kanban-scan completion (web `x+/end.$operationId.tsx`). */
export const completeFromScanBody = z.object({
  trackedEntityId: z.string().optional(),
  acknowledged: z.boolean().optional()
});
export type CompleteFromScanBody = z.infer<typeof completeFromScanBody>;

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const eventIds = {
  setupProductionEventId: z.string().optional(),
  laborProductionEventId: z.string().optional(),
  machineProductionEventId: z.string().optional()
};

export const finishBody = z.object({
  jobOperationId: z.string().min(1),
  ...eventIds
});
export type FinishBody = z.infer<typeof finishBody>;

export const quantityBody = z.object({
  jobOperationId: z.string().min(1),
  // Quantities carry up to 5 decimals (the quantity kind in
  // `.claude/rules/numeric-precision.md`); never rounded here.
  quantity: z.number().positive(),
  trackedEntityId: z.string().optional(),
  trackingType: z.enum(["Serial", "Batch", ""]).optional(),
  notes: z.string().optional(),
  ...eventIds
});
export type QuantityBody = z.infer<typeof quantityBody>;

export const scrapBody = quantityBody.extend({
  scrapReasonId: z.string().min(1)
});
export type ScrapBody = z.infer<typeof scrapBody>;

export const reworkBody = quantityBody;
export type ReworkBody = z.infer<typeof reworkBody>;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const issueMaterialBody = z.object({
  itemId: z.string().min(1),
  jobOperationId: z.string().min(1),
  materialId: z.string().optional(),
  /** Scopes an unplanned part to the step it was issued on. */
  jobOperationStepId: z.string().optional(),
  quantity: z.number(),
  adjustmentType: z.enum([
    "Set Quantity",
    "Positive Adjmt.",
    "Negative Adjmt."
  ]),
  /** The operator confirmed a warning the server raised on a first attempt. */
  acknowledged: z.boolean().optional()
});
export type IssueMaterialBody = z.infer<typeof issueMaterialBody>;

export const issueTrackedBody = z.object({
  materialId: z.string().optional(),
  jobOperationId: z.string().optional(),
  itemId: z.string().optional(),
  /** Batch mode: the pick covers every member; the edge fn splits it pro-rata. */
  batchId: z.string().optional(),
  parentTrackedEntityId: z.string().optional(),
  children: z.array(
    z.object({ trackedEntityId: z.string(), quantity: z.number() })
  ),
  jobOperationStepId: z.string().optional(),
  /** 1-based, so it matches `currentUnitIndex + 1` in the web. */
  unitNumber: z.number().int().positive().optional(),
  overrideExpired: z.boolean().optional(),
  overrideReason: z.string().optional()
});
export type IssueTrackedBody = z.infer<typeof issueTrackedBody>;

export const unconsumeBody = issueTrackedBody.extend({
  acknowledged: z.boolean().optional()
});
export type UnconsumeBody = z.infer<typeof unconsumeBody>;

// ---------------------------------------------------------------------------
// Steps, notes, quality, print
// ---------------------------------------------------------------------------

export const stepRecordBody = z.object({
  /** The unit-axis position; the same key as `jobOperationStepRecord.index`. */
  index: z.number(),
  jobOperationStepId: z.string().min(1),
  value: z.string().optional(),
  numericValue: z.number().optional(),
  booleanValue: z.boolean().optional(),
  userValue: z.string().optional()
});
export type StepRecordBody = z.infer<typeof stepRecordBody>;

export const noteBody = z.object({ note: z.string().min(1) });
export type NoteBody = z.infer<typeof noteBody>;

export const qualityIssueBody = z.object({
  jobOperationId: z.string().min(1),
  trackedEntityId: z.string().optional(),
  description: z.string().optional(),
  nonConformanceTypeId: z.string().optional(),
  priority: z.string().optional(),
  quantity: z.number().optional()
});
export type QualityIssueBody = z.infer<typeof qualityIssueBody>;

export const printBody = z
  .object({
    sourceDocument: z.string().min(1),
    sourceDocumentId: z.string().min(1),
    workCenterId: z.string().optional(),
    printerRouteId: z.string().optional()
  })
  // `manualPrintValidator` in @carbon/printing owns the authoritative shape and
  // may carry fields this build does not know; let them through rather than
  // rejecting a print an older app cannot name.
  .passthrough();
export type PrintBody = z.infer<typeof printBody>;

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export const pickQuantityBody = z.object({
  pickingListLineId: z.string().min(1),
  quantity: z.number().min(0),
  /** "How many were actually picked?" — the short-pick answer. */
  markShort: z.boolean().optional()
});
export type PickQuantityBody = z.infer<typeof pickQuantityBody>;

export const pickTrackedBody = z.object({
  trackedEntityId: z.string().min(1),
  fromStorageUnitId: z.string().optional(),
  quantity: z.number(),
  unpick: z.boolean().optional()
});
export type PickTrackedBody = z.infer<typeof pickTrackedBody>;

export const pickingListStatusBody = z.object({
  status: z.enum(pickingListStatus),
  acknowledged: z.boolean().optional()
});
export type PickingListStatusBody = z.infer<typeof pickingListStatusBody>;

// ---------------------------------------------------------------------------
// Time card and shared terminal
// ---------------------------------------------------------------------------

export const clockOutBody = z.object({ note: z.string().optional() });
export type ClockOutBody = z.infer<typeof clockOutBody>;

/**
 * The shared-tablet pin-in. `userId` is the operator the terminal picked from
 * the employee list; `pin` is their console PIN.
 *
 * This is the one body in this file that carries a CREDENTIAL. It is never
 * logged, never echoed back, and `POST /console/pin-in` deliberately opts out
 * of the idempotency window — that window keys a sha256 of the request body,
 * and a 4-digit PIN has only 10,000 preimages, so storing its fingerprint
 * would put the PIN itself within reach of anything that can read Redis.
 */
export const pinInBody = z.object({
  userId: z.string().min(1),
  pin: z.string().regex(/^\d{4,8}$/, { message: "Enter your 4-8 digit PIN" })
});
export type PinInBody = z.infer<typeof pinInBody>;

// ---------------------------------------------------------------------------
// Inspection execution
// ---------------------------------------------------------------------------

export const inspectionSampleStatus = ["Pending", "Passed", "Failed"] as const;
export type InspectionSampleStatus = (typeof inspectionSampleStatus)[number];

export const inspectionDecision = ["Accept", "Reject", "Partial"] as const;
export type InspectionDecision = (typeof inspectionDecision)[number];

/**
 * Every inspection write names its lot in the body as well as in the path, the
 * way the picking line bodies do: the route refuses a body that names a
 * different lot rather than quietly applying the write to the one in the URL.
 */
const lotRef = { inspectionId: z.string().min(1) };

/**
 * One cell of the features x samples grid.
 *
 * `value` stays a STRING, as it is on the web. The engine valuates it against
 * the feature's nominal and tolerances and stores it in a NUMERIC column; a
 * reading carries up to 5 decimals (the quantity kind in
 * `.claude/rules/numeric-precision.md`) and is never rounded on the way in, so
 * sending the operator's digits verbatim is what keeps "0.0625" from becoming
 * a float the server rounded for them. An empty string clears the reading.
 */
export const inspectionMeasurementBody = z.object({
  ...lotRef,
  /** Absent = create an anonymous sample (non-serial grid columns). */
  sampleId: z.string().optional(),
  inspectionFeatureId: z.string().min(1),
  value: z.string().optional(),
  /** Attribute (non-numeric) features toggle pass/fail instead of a value. */
  passed: z.enum(["true", "false"]).optional(),
  notes: z.string().optional()
});
export type InspectionMeasurementBody = z.infer<
  typeof inspectionMeasurementBody
>;

/** Which gauge measured one feature of this lot; empty clears the record. */
export const inspectionGaugeBody = z.object({
  ...lotRef,
  inspectionFeatureId: z.string().min(1),
  gaugeId: z.string().optional()
});
export type InspectionGaugeBody = z.infer<typeof inspectionGaugeBody>;

/**
 * A verdict for one unit. `Pending` registers a sample without one — the
 * identify-only scan a serial lot makes before any feature is measured.
 */
export const inspectionSampleBody = z.object({
  ...lotRef,
  /** Update an existing anonymous column in place (the overall-result row). */
  sampleId: z.string().optional(),
  /** Serial parts scan a discrete tracked entity; other parts carry none. */
  trackedEntityId: z.string().optional(),
  status: z.enum(inspectionSampleStatus),
  notes: z.string().optional()
});
export type InspectionSampleBody = z.infer<typeof inspectionSampleBody>;

/** The production events a posting is clocked against. */
const inspectionEventIds = {
  setupProductionEventId: z.string().optional(),
  laborProductionEventId: z.string().optional(),
  machineProductionEventId: z.string().optional()
};

/**
 * Closing the lot. The decision carries its physical outcome, so the
 * allocation travels with it.
 *
 * The web sends the serial allocation as two JSON-encoded strings inside
 * FormData; JSON needs no such encoding, so these are real arrays. The
 * quantities are plain numbers for the same reason `zfd.numeric` exists on the
 * web. Either way the server recomputes every bucket from the database and
 * clamps to the operation's remaining quantity — these fields are operator
 * intent, never trusted arithmetic.
 */
export const inspectionDispositionBody = z.object({
  ...lotRef,
  decision: z.enum(inspectionDecision),
  /** The job operation the lot must belong to. */
  operationId: z.string().min(1),
  /** Serial allocation: the tracked entities picked per outcome. */
  scrapEntityIds: z.array(z.string().min(1)).optional(),
  reworkEntityIds: z.array(z.string().min(1)).optional(),
  /** Non-serial allocation: quantities out of the failed / open remainder. */
  scrapQuantity: z.number().min(0).optional(),
  reworkQuantity: z.number().min(0).optional(),
  scrapReasonId: z.string().optional(),
  targetOperationId: z.string().optional(),
  reworkReason: z.string().optional(),
  /** Optional documentation — never required for scrap or rework. */
  createNcr: z.boolean().optional(),
  nonConformanceTypeId: z.string().optional(),
  ...inspectionEventIds
});
export type InspectionDispositionBody = z.infer<
  typeof inspectionDispositionBody
>;

/** Progressive completion of passed units while the lot stays open. */
export const inspectionCompletePassedBody = z.object({
  ...lotRef,
  operationId: z.string().min(1),
  ...inspectionEventIds
});
export type InspectionCompletePassedBody = z.infer<
  typeof inspectionCompletePassedBody
>;
