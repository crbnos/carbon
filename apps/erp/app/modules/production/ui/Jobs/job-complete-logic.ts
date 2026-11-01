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

export type JobSerialUnit = {
  id: string;
  status: string;
  quantity: number;
  readableId: string | null;
  createdAt: string;
};

/** What a job has received to inventory, from api+/production.job.$jobId.receipts. */
export type JobReceiptSnapshot = {
  quantityReceivedToInventory: number;
  trackedEntityIds: string[];
};

const NON_RECEIVABLE_SERIAL_STATUSES = ["Consumed", "Rejected", "Scrapped"];

function isUnreceived(
  entity: JobSerialUnit,
  receivedEntityIds: ReadonlySet<string>
) {
  return (
    !NON_RECEIVABLE_SERIAL_STATUSES.includes(entity.status) &&
    !receivedEntityIds.has(entity.id)
  );
}

/**
 * The serial numbers a job completion can still receive, in the order
 * complete_job_to_inventory receives them: units finished on the shop floor
 * (Available) first, then reserved units, each by serial number. Units the job
 * already received are excluded.
 *
 * Returns null unless every unit left to receive is a numbered, single-unit
 * serial. A job still holding an unsplit seed entity has no serial numbers to
 * receive yet, so its quantity stays locked to what the shop floor finished.
 */
export function getReceivableSerialUnits(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set()
): string[] | null {
  const receivable = trackedEntities.filter((entity) =>
    isUnreceived(entity, receivedEntityIds)
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

  const statusRank = (status: string) =>
    status === "Available" ? 0 : status === "Reserved" ? 1 : 2;

  return [...receivable]
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        a.readableId!.localeCompare(b.readableId!)
    )
    .map((entity) => entity.readableId as string);
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
  | { mode: "serials"; serials: string[] }
  | { mode: "numberOnReceipt"; receivableCount: number }
  | { mode: "locked" };

export function getSerialCompleteChoice({
  trackedEntities,
  receivedEntityIds,
  hasSerialSequence,
  jobQuantity
}: {
  trackedEntities: JobSerialUnit[];
  /** Null when the job's receipts could not be read. */
  receivedEntityIds: ReadonlySet<string> | null;
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

  const serials = getReceivableSerialUnits(trackedEntities, receivedEntityIds);
  if (serials && unitsWithoutRow === 0) return { mode: "serials", serials };
  // With a sequence the completion numbers whatever it receives unnumbered.
  if (!hasSerialSequence) return { mode: "locked" };

  const receivableCount =
    trackedEntities
      .filter((entity) => isUnreceived(entity, receivedEntityIds))
      .reduce((total, entity) => total + Number(entity.quantity), 0) +
    unitsWithoutRow;
  return receivableCount > 0
    ? { mode: "numberOnReceipt", receivableCount }
    : { mode: "locked" };
}

/** Units finished on the shop floor that the job has not received yet. */
export function getFinishedUnreceivedQuantity(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set()
): number {
  return trackedEntities.filter(
    (entity) =>
      entity.status === "Available" && !receivedEntityIds.has(entity.id)
  ).length;
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
