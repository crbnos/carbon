// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure logic for the job Complete dialog. No JSX or lingui, so it can be unit
// tested directly (apps/erp/test/job-complete-logic.test.ts).
//
// The completed quantity is CUMULATIVE: complete_job_to_inventory receives the
// difference between it and what the job has already received. Everything here
// works on the units the job has not received yet, so the dialog and the
// database always agree on which units a completion takes.

import type { JobReceiptTracking, JobSerialUnit } from "../../types";

export type { JobSerialUnit } from "../../types";

/** What a job has received to inventory, from api+/production.job.$jobId.receipts. */
export type JobReceiptSnapshot = {
  qualityHoldsEnabled: boolean;
  receiptPreview: string;
  tracking: JobReceiptTracking;
  quantityReceivedToInventory: number;
  trackedEntityIds: string[];
  holds: Awaited<
    ReturnType<typeof import("../../production.service").getJobReceiptHolds>
  >;
  /** The job's Consumed units that were booked out of stock (issued or shipped). */
  issuedTrackedEntityIds: string[];
};

export function receiptHasTrackedOutput(tracking?: JobReceiptTracking) {
  return (
    !!tracking &&
    !tracking.consumeToProject &&
    tracking.itemTrackingType !== "Non-Inventory"
  );
}

/** Values submitted by the serial receipt dialog. Deferred units have a
 * confirmation too, even when the receipt itself will assign their numbers. */
export function getReceiptConfirmation(
  preview: Pick<JobReceiptSnapshot, "receiptPreview" | "tracking"> | null,
  namedUnits?: Pick<JobSerialUnit, "id">[]
) {
  if (!preview?.tracking.requiresSerialTracking) return null;
  return {
    expectedReceiptPreview: preview.receiptPreview,
    expectedUnitIds: receiptHasTrackedOutput(preview.tracking)
      ? namedUnits?.map((unit) => unit.id)
      : undefined
  };
}

const NON_RECEIVABLE_SERIAL_STATUSES = ["Consumed", "Rejected", "Scrapped"];

// complete_job_to_inventory also receives a unit issued into another job (or
// shipped) before its own job was received: Consumed, and booked out of stock
// (`issuedEntityIds`). A Consumed unit that never left stock is not received.
function isUnreceived(
  entity: JobSerialUnit,
  receivedEntityIds: ReadonlySet<string>,
  issuedEntityIds: ReadonlySet<string>
) {
  if (receivedEntityIds.has(entity.id)) return false;
  if (entity.status === "Consumed") return issuedEntityIds.has(entity.id);
  return !NON_RECEIVABLE_SERIAL_STATUSES.includes(entity.status);
}

// A finished unit: on the shop floor (Available), or issued since.
function isFinished(
  entity: JobSerialUnit,
  issuedEntityIds: ReadonlySet<string>
) {
  return (
    entity.status === "Available" ||
    (entity.status === "Consumed" && issuedEntityIds.has(entity.id))
  );
}

/**
 * The serial numbers a job completion can still receive, in the order
 * complete_job_to_inventory receives them: finished units (Available on the
 * shop floor, or issued since) first, then reserved units, each by serial
 * number. Units the job already received are excluded.
 *
 * Returns null unless every unit left to receive is a numbered, single-unit
 * serial. A job still holding an unsplit seed entity has no serial numbers to
 * receive yet, so its quantity stays locked to what the shop floor finished.
 */
export function getReceivableSerialUnits(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set(),
  issuedEntityIds: ReadonlySet<string> = new Set()
): JobSerialUnit[] | null {
  const receivable = trackedEntities.filter((entity) =>
    isUnreceived(entity, receivedEntityIds, issuedEntityIds)
  );

  // Stricter than complete_job_to_inventory on purpose: the database also
  // receives a single-unit serial with no serial number (a one-unit job with no
  // serial sequence), but the dialog only unlocks when it can name every unit it
  // lists. Such a job still completes through the locked path or by marking its
  // operations Done.
  if (
    receivable.length === 0 ||
    receivable.some((entity) => entity.quantity !== 1 || !entity.readableId)
  ) {
    return null;
  }

  const statusRank = (entity: JobSerialUnit) =>
    isFinished(entity, issuedEntityIds)
      ? 0
      : entity.status === "Reserved"
        ? 1
        : 2;

  // Preserve the database's serial-number, creation-time and ID order for
  // ties. Browser locale collation can disagree with the receipt SQL.
  return receivable.sort((a, b) => statusRank(a) - statusRank(b));
}

/**
 * How the Complete dialog lets the quantity be chosen for a serial job.
 *
 * - `serials`: every unit left to receive is a numbered single unit, so the
 *   dialog lists the serials a completion takes.
 * - `numberOnReceipt`: the item has a serial sequence and some units are
 *   unnumbered, still one unsplit seed, or held by no row yet. The completion
 *   numbers the units it receives and creates the missing ones
 *   (`complete_job_to_inventory`), so the quantity can be chosen up to
 *   `receivableCount` even though the serials cannot be named yet. This does
 *   not depend on the serial number timing: a job left unnumbered by a timing
 *   that has since changed to `jobCreation` is numbered on receipt too.
 * - `locked`: the quantity stays what the shop floor finished — unnumbered
 *   units of an item with no serial sequence, or receipts that could not be
 *   read.
 */
export type SerialCompleteChoice =
  | { mode: "serials"; serials: JobSerialUnit[] }
  | { mode: "numberOnReceipt"; receivableCount: number }
  | { mode: "locked" };

export function getSerialCompleteChoice({
  trackedEntities,
  heldUnitIds,
  receivedEntityIds,
  issuedEntityIds,
  hasSerialSequence,
  jobQuantity
}: {
  trackedEntities: JobSerialUnit[];
  heldUnitIds?: ReadonlySet<string>;
  /** Null when the job's receipts could not be read. */
  receivedEntityIds: ReadonlySet<string> | null;
  issuedEntityIds: ReadonlySet<string>;
  /** Whether the item has a serial sequence the completion can draw from. */
  hasSerialSequence: boolean;
  jobQuantity: number;
}): SerialCompleteChoice {
  // Without the receipts the dialog could offer a unit the job already
  // received, whatever the timing.
  if (!receivedEntityIds) return { mode: "locked" };

  // The shop floor's first completion or scrap of an unsplit seed leaves it
  // holding one unit and spawns the rest one at a time, so the rows can hold
  // fewer units than the job quantity. Only a completion that numbers on
  // receipt creates the missing units. A scrapped unit does not count: the job
  // still owes it.
  const unitsWithoutRow = hasSerialSequence
    ? Math.max(
        jobQuantity -
          trackedEntities
            .filter((entity) => entity.status !== "Scrapped")
            .reduce((total, entity) => total + Number(entity.quantity), 0),
        0
      )
    : 0;

  // A held seed still accounts for every unit on it when computing missing rows.
  const eligible = trackedEntities.filter((unit) => !heldUnitIds?.has(unit.id));
  const serials = getReceivableSerialUnits(
    eligible,
    receivedEntityIds,
    issuedEntityIds
  );
  if (serials && unitsWithoutRow === 0) return { mode: "serials", serials };
  // With a sequence the completion numbers whatever it receives unnumbered.
  if (!hasSerialSequence) return { mode: "locked" };

  const receivableCount =
    eligible
      .filter((entity) =>
        isUnreceived(entity, receivedEntityIds, issuedEntityIds)
      )
      .reduce((total, entity) => total + Number(entity.quantity), 0) +
    unitsWithoutRow;
  return receivableCount > 0
    ? { mode: "numberOnReceipt", receivableCount }
    : { mode: "locked" };
}

/** Finished units (issued since or not) that the job has not received yet. */
export function getFinishedUnreceivedQuantity(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set(),
  issuedEntityIds: ReadonlySet<string> = new Set()
): number {
  return trackedEntities.filter(
    (entity) =>
      isFinished(entity, issuedEntityIds) && !receivedEntityIds.has(entity.id)
  ).length;
}

/**
 * The cumulative quantity a locked dialog completes at: every finished unit,
 * received or not, issued since or not.
 */
export function getFinishedQuantity(
  trackedEntities: JobSerialUnit[],
  issuedEntityIds: ReadonlySet<string> = new Set()
): number {
  return trackedEntities.reduce(
    (total, entity) =>
      isFinished(entity, issuedEntityIds)
        ? total + Number(entity.quantity)
        : total,
    0
  );
}

/**
 * The cumulative quantity the dialog opens at for a job whose serial units are
 * numbered: what the job already received, plus the units finished on the shop
 * floor, or else the rest of the job quantity, never more than can be received.
 */
export function getDefaultSerialCompleteQuantity({
  finishedUnreceivedQuantity,
  jobQuantity,
  priorReceivedQuantity,
  receivableSerialCount
}: {
  finishedUnreceivedQuantity: number;
  jobQuantity: number;
  priorReceivedQuantity: number;
  receivableSerialCount: number;
}): number {
  const newUnits =
    finishedUnreceivedQuantity > 0
      ? finishedUnreceivedQuantity
      : Math.max(jobQuantity - priorReceivedQuantity, 0);
  return priorReceivedQuantity + Math.min(newUnits, receivableSerialCount);
}

/** Quantity and serial selection when the operator opens Complete. */
export function getTrackedReceiptQuantity(
  receipts: Pick<
    JobReceiptSnapshot,
    | "tracking"
    | "trackedEntityIds"
    | "issuedTrackedEntityIds"
    | "quantityReceivedToInventory"
  >
): { choice: SerialCompleteChoice; quantity: number } | null {
  const { tracking } = receipts;
  const { trackedEntities } = tracking;
  if (!tracking.requiresSerialTracking) {
    if (!tracking.requiresBatchTracking || !trackedEntities.length) return null;
    return {
      choice: { mode: "locked" },
      quantity: getFinishedQuantity(trackedEntities)
    };
  }
  const heldUnitIds = new Set(
    trackedEntities.filter((unit) => unit.held).map((unit) => unit.id)
  );
  const eligible = trackedEntities.filter((unit) => !heldUnitIds.has(unit.id));
  const receivedEntityIds = new Set(receipts.trackedEntityIds);
  const issuedEntityIds = new Set(
    tracking.fixedAssetClassId || tracking.fixedAssetId
      ? []
      : receipts.issuedTrackedEntityIds
  );
  const choice = getSerialCompleteChoice({
    trackedEntities,
    heldUnitIds,
    receivedEntityIds,
    issuedEntityIds,
    hasSerialSequence: !!tracking.sequenceId,
    jobQuantity: tracking.quantity
  });
  return {
    choice,
    quantity:
      choice.mode === "locked"
        ? getFinishedQuantity(eligible, issuedEntityIds)
        : getDefaultSerialCompleteQuantity({
            finishedUnreceivedQuantity: getFinishedUnreceivedQuantity(
              eligible,
              receivedEntityIds,
              issuedEntityIds
            ),
            jobQuantity: tracking.quantity,
            priorReceivedQuantity: receipts.quantityReceivedToInventory,
            receivableSerialCount:
              choice.mode === "serials"
                ? choice.serials.length
                : choice.receivableCount
          })
  };
}
