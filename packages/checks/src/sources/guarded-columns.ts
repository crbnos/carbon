// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The columns the two concurrency checks guard: lifecycle statuses
// (`status-write-guarded`) and running totals (`counter-write-relative`).

/**
 * Enums named like a status that are not a lifecycle: a classification or a
 * measured result that is set to whatever is true now, never moved from one
 * expected state to the next, and the progress of a single background job.
 */
const NOT_LIFECYCLE_ENUMS = new Set([
  // Classification, edited freely.
  "flsaStatus",
  "itemRevisionStatus",
  // An on/off switch.
  "accountingPeriodStatus",
  "gaugeStatus",
  // A measured result.
  "inspectionStatus",
  "gaugeCalibrationStatus",
  // One job's own progress, written only by that job.
  "modelProcessingStatus",
  "documentExtractionStatus"
]);

/**
 * The enum-typed lifecycle columns per table: `status` and `…Status`, from
 * each column's generated type text (`loadDbTableColumnTypes`), less
 * `NOT_LIFECYCLE_ENUMS`. A `…History` table is an append-only log, so it is
 * left out.
 */
export function statusColumns(
  columnTypes: Map<string, Map<string, string>>
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [table, columns] of columnTypes) {
    if (/History$/.test(table)) continue;
    const status = [...columns]
      .filter(([name, type]) => {
        if (!/^(?:status|\w+Status)$/.test(name)) return false;
        const enumName =
          /^Database\["public"\]\["Enums"\]\["(\w+)"\](?: \| null)?$/.exec(
            type
          )?.[1];
        return enumName !== undefined && !NOT_LIFECYCLE_ENUMS.has(enumName);
      })
      .map(([name]) => name);
    if (status.length > 0) out.set(table, new Set(status));
  }
  return out;
}

/** The running totals: added to by many writers, so never set to a total computed in JavaScript. */
export const COUNTER_COLUMNS: ReadonlySet<string> = new Set([
  "quantityIssued",
  "quantityReceived",
  "quantityReceivedToInventory",
  "quantityInvoiced",
  "quantityShipped",
  "quantitySent",
  "quantityPicked",
  "quantityComplete",
  "quantityReturned",
  "quantityScrapped",
  "quantityReworked",
  "quantityPaidBack",
  "consumedQuantity",
  "appliedAmount"
]);
