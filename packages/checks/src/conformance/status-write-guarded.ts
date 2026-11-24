// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import { blankComments } from "./no-unscoped-kysely-write";
import {
  locksBefore,
  namesColumn,
  regionOf,
  rowLocks,
  rowWrites,
  topLevelRegions
} from "./row-writes";

/**
 * An UPDATE that moves a row's lifecycle status must check the status it moves
 * FROM in the same statement, or hold the row lock while it decides.
 *
 * The shipped bug: the code reads the row, checks its status in JavaScript (or
 * not at all), then updates the row by `id` alone. Between the read and the
 * UPDATE another request moves the row, and the UPDATE overwrites that move.
 *  - `lockAccountingPeriod` / `unlockAccountingPeriod` (fixed in de82a88cc6):
 *    an unlock queued behind a close set the closed period back to Open.
 *  - the quote-to-order conversion in the `convert` edge function (2c9ef0dd8f):
 *    a replayed accept made a second sales order from an Ordered quote.
 *  - the receipt post (bbe8dfd6a9): a void between the check and the update
 *    was flipped back to Pending and posted.
 * The invoice voids (578c411ffe) are the same race in the other form: they
 * held the row lock and never re-checked the status under it. A lock passes
 * this check, so that form is the formal models' to catch, not this one.
 *
 * A write is flagged when its row sets a lifecycle status column — an
 * enum-typed column named `status` or `…Status` on that table, read from the
 * generated types, less `NOT_LIFECYCLE_ENUMS` — and
 *  - none of the statement's predicates names that column (Kysely
 *    `.where("status", …)`, supabase `.eq/.neq/.in/.is/.not/.match`, the
 *    `updateRows` filter, also when added later to a builder held in a
 *    variable), and
 *  - none names another column the same UPDATE changes (`.set({ status,
 *    salesInvoiceLineId: null }).where("salesInvoiceLineId", "in", ids)` is a
 *    claim on that column: a second run matches nothing), and
 *  - the function has not locked a row of that table before the write
 *    (`.selectFrom(t)…forUpdate()` / `.forNoKeyUpdate()`, raw SQL `FOR UPDATE`,
 *    or a call to a function in the same file that does). The lock is per
 *    table, not per row: the check cannot see which id was locked.
 *
 * `updateRowsById` has no predicate of its own, so a status it writes passes
 * only under a lock.
 */

const MESSAGE = (table: string, column: string) =>
  `This UPDATE sets ${table}.${column} with no predicate on ${column}, so a request that moved the row after you read it is overwritten. Check the status in the UPDATE (\`.eq("${column}", <expected>)\` / \`.where("${column}", "=", <expected>)\`) and refuse when no row changed, or lock the row FOR UPDATE and re-check it before the UPDATE.`;

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
 * The enum-typed lifecycle columns per table: `status` and `…Status`. A
 * `…History` table is an append-only log, so it is left out.
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

const AUDIT_COLUMNS = new Set([
  "id",
  "companyId",
  "updatedAt",
  "updatedBy",
  "createdAt",
  "createdBy"
]);

export const STATUS_WRITE_GUARDED = "status-write-guarded";

export function statusWriteGuarded(
  columnTypes: Map<string, Map<string, string>>
): ConformanceCheck {
  const columns = statusColumns(columnTypes);
  return {
    id: STATUS_WRITE_GUARDED,
    description:
      "An UPDATE that sets a lifecycle status column carries a predicate on that column, or runs after the function locked the row — a status checked in code and written by id alone overwrites a concurrent change.",
    provenance: {
      deprecates:
        "reading a row's status, checking it in code, then updating the status by id alone (lockAccountingPeriod, the convert edge function's quote → Ordered, the invoice void, the receipt post)",
      replacedBy:
        'a guarded UPDATE (`.eq("status", <expected>)`) that refuses when no row changed, or a FOR UPDATE row lock and a re-check before the UPDATE',
      since: "de82a88cc6"
    },
    scan(file, contents) {
      if (!/\.updateTable|\.update\s*\(|updateRows/.test(contents)) return [];
      const text = blankComments(contents);
      const regions = topLevelRegions(text);
      const locks = rowLocks(text);
      const violations: Violation[] = [];
      const seen = new Set<string>();
      for (const write of rowWrites(text, regions)) {
        const lifecycle = columns.get(write.table);
        if (!lifecycle) continue;
        for (const field of write.fields) {
          if (!lifecycle.has(field.name)) continue;
          const at = `${field.index}:${write.table}.${field.name}`;
          if (seen.has(at)) continue;
          if (namesColumn(write.guards, field.name, write.alias, write.table)) {
            continue;
          }
          // A predicate on another column the same UPDATE changes is a claim
          // too: `.set({ status, salesInvoiceLineId: null })
          // .where("salesInvoiceLineId", "in", ids)` matches nothing the
          // second time.
          const claims = write.fields.some(
            (other) =>
              other.name !== field.name &&
              !AUDIT_COLUMNS.has(other.name) &&
              namesColumn(write.guards, other.name, write.alias, write.table)
          );
          if (claims) continue;
          if (locksBefore(text, regions, locks, write.index).has(write.table)) {
            continue;
          }
          const fn = regionOf(regions, write.index)?.name ?? "<top level>";
          seen.add(at);
          violations.push({
            file,
            line: text.slice(0, field.index).split("\n").length,
            snippet: `${fn}: ${write.table}.${field.name}`,
            message: MESSAGE(write.table, field.name)
          });
        }
      }
      return violations;
    }
  };
}
