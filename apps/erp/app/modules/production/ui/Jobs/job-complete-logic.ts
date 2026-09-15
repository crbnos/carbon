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
 * serial. A job still holding an unsplit placeholder has no serial numbers to
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
        (a.readableId ?? "").localeCompare(b.readableId ?? "") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    )
    .map((entity) => entity.readableId as string);
}

/**
 * Whether a serial job still holds a placeholder for several units. Its units
 * become receivable only once the shop floor completes them one at a time;
 * complete_job_to_inventory refuses the placeholder, including when the last
 * operation is marked Done.
 */
export function hasUnsplitSerialPlaceholder(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set()
): boolean {
  return trackedEntities.some(
    (entity) => isUnreceived(entity, receivedEntityIds) && entity.quantity > 1
  );
}

/** Units finished on the shop floor that the job has not received yet. */
export function getFinishedUnreceivedQuantity(
  trackedEntities: JobSerialUnit[],
  receivedEntityIds: ReadonlySet<string> = new Set()
): number {
  return trackedEntities
    .filter(
      (entity) =>
        entity.status === "Available" && !receivedEntityIds.has(entity.id)
    )
    .reduce((total, entity) => total + entity.quantity, 0);
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
      : Math.min(
          Math.max(jobQuantity - priorReceivedQuantity, 0),
          receivableSerialCount
        );
  return priorReceivedQuantity + Math.min(newUnits, receivableSerialCount);
}

/** The serial numbers a completion at this cumulative quantity will receive. */
export function getSerialsToReceive(
  receivableSerials: string[],
  quantity: number,
  priorReceivedQuantity: number
): string[] {
  return receivableSerials.slice(
    0,
    Math.max(quantity - priorReceivedQuantity, 0)
  );
}

/** Serial units are received one at a time; the database refuses a fraction. */
export function isFractionalSerialQuantity(
  receivableSerials: string[] | null,
  quantity: number
): boolean {
  return (
    receivableSerials !== null &&
    Number.isFinite(quantity) &&
    !Number.isInteger(quantity)
  );
}
