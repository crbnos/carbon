// Pure logic for the job Complete dialog. No JSX or lingui, so it can be unit
// tested directly (apps/erp/test/job-complete-logic.test.ts).

export type JobSerialUnit = {
  id: string;
  status: string;
  quantity: number;
  readableId: string | null;
  createdAt: string;
};

const NON_RECEIVABLE_SERIAL_STATUSES = ["Consumed", "Rejected", "Scrapped"];

/**
 * The serial numbers a job completion can receive, in the order
 * complete_job_to_inventory receives them: units finished on the shop floor
 * (Available) first, then reserved units, each by serial number.
 *
 * Returns null unless every receivable unit is already a numbered, single-unit
 * serial. A job still holding an unsplit placeholder has no serial numbers to
 * receive yet, so its quantity stays locked to what the shop floor finished.
 */
export function getReceivableSerialUnits(
  trackedEntities: JobSerialUnit[]
): string[] | null {
  const receivable = trackedEntities.filter(
    (entity) => !NON_RECEIVABLE_SERIAL_STATUSES.includes(entity.status)
  );

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
 * The quantity the dialog opens at for a job whose serial units are numbered:
 * the units already finished on the shop floor, or else the job quantity,
 * never more than the units that can be received.
 */
export function getDefaultSerialCompleteQuantity({
  availableQuantity,
  jobQuantity,
  receivableSerialCount
}: {
  availableQuantity: number;
  jobQuantity: number;
  receivableSerialCount: number;
}): number {
  return availableQuantity > 0
    ? availableQuantity
    : Math.min(jobQuantity, receivableSerialCount);
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
