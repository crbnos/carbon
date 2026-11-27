// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck, eachFile, type Violation } from "../../check";
import { loadDbTableColumnTypes } from "../../sources/db-columns";
import { typescript } from "../../sources/inputs";
import {
  lockedRead,
  namesColumn,
  readRowWrites,
  regionOf
} from "../../sources/row-writes";
import { lineOf } from "../../sources/text";

// An UPDATE that moves a row's lifecycle status must check the status it moves
// FROM in the same statement, or hold the row lock while it decides.
//
// The shipped bug: the code reads the row, checks its status in JavaScript (or
// not at all), then updates the row by `id` alone. Between the read and the
// UPDATE another request moves the row, and the UPDATE overwrites that move.
//  - `lockAccountingPeriod` / `unlockAccountingPeriod` (fixed in de82a88cc6):
//    an unlock queued behind a close set the closed period back to Open.
//  - the quote-to-order conversion in the `convert` edge function (2c9ef0dd8f):
//    a replayed accept made a second sales order from an Ordered quote.
//  - the receipt post (bbe8dfd6a9): a void between the check and the update
//    was flipped back to Pending and posted.
//  - the sales invoice void (578c411ffe): it locked the invoice
//    (`.select("id")…forUpdate()`) and never read its status under the lock,
//    so a second void waited for the first and then reversed it again.
//
// A write is flagged when its row sets a lifecycle status column — an
// enum-typed column named `status` or `…Status` on that table, read from the
// generated types, less `NOT_LIFECYCLE_ENUMS` — and
//  - none of the statement's predicates names that column (Kysely
//    `.where("status", …)`, supabase `.eq/.neq/.in/.is/.not/.match`, the
//    `updateRows` filter, also when added later to a builder held in a
//    variable), and
//  - none names another column the same UPDATE changes (`.set({ status,
//    salesInvoiceLineId: null }).where("salesInvoiceLineId", "in", ids)` is a
//    claim on that column: a second run matches nothing), and
//  - the function has not locked a row of that table before the write
//    (`.selectFrom(t)…forUpdate()` / `.forNoKeyUpdate()`, raw SQL `FOR UPDATE`,
//    or a call to a function in the same file that does) AND read the column
//    under that lock: the locked select reads it (`.select("status")`,
//    `.select(["id", "status"])`, `selectAll()`), the locked row's local reads
//    it later (`locked?.status`), or a later select of the table does. A lock
//    that reads only `id` waits for the other writer and then overwrites it.
//    The lock is per table, not per row: the check cannot see which id was
//    locked, nor that the code compares the status it read.
//
// `updateRowsById` has no predicate of its own, so a status it writes passes
// only under a lock.
//
// The snippet is `<function>: <table>.<column>`, with no line. So a new
// unguarded write in a function and table that are already baselined is
// grandfathered too. For example, the `postSalesInvoice: salesInvoice.status`
// entry, baselined for the post branch, also covers its void branch.
//
// Two baselined sites need their reason:
//  - `activate` is a false positive. The agreement's lock and Draft check
//    guard its rental lines.
//  - the accounting providers' `upsertLocal` functions mirror a status the
//    remote system already decided.
//
// The tests replay the parent revisions of de82a88cc6, 2c9ef0dd8f and
// 578c411ffe. On main, 578c411ffe was squashed into b6ca51d4e1, so
// `incidents` names both.
//
// Two more rules were measured and not built:
//  - a claim that accepts `Pending` (`.in("status", ["Draft", "Pending"])`
//    before it sets Pending). Every hit was a receipt, shipment or purchase
//    invoice claim, whose posting re-checks the status under a lock. So every
//    hit would be a false positive.
//  - a side effect inside a transaction body. When measured, no
//    `transaction().execute` body held a direct email, print, trigger or event
//    call. The real side effects are calls into other functions, which a text
//    check cannot follow.
//
// See `.claude/rules/concurrency.md`.
export const statusWriteGuarded = defineCheck({
  id: "status-write-guarded",
  description:
    "An UPDATE that sets a lifecycle status column carries a predicate on that column, or runs after the function locked the row — a status checked in code and written by id alone overwrites a concurrent change.",
  provenance: {
    deprecates:
      "reading a row's status, checking it in code, then updating the status by id alone (lockAccountingPeriod, the convert edge function's quote → Ordered, the invoice void, the receipt post)",
    replacedBy:
      'a guarded UPDATE (`.eq("status", <expected>)`) that refuses when no row changed, or a FOR UPDATE row lock and a re-check before the UPDATE',
    since: "de82a88cc6",
    incidents: ["de82a88cc6", "2c9ef0dd8f", "578c411ffe", "b6ca51d4e1"]
  },
  reads: { files: typescript, columnTypes: loadDbTableColumnTypes },
  rule() {
    const blindLockMessage = (table: string, column: string) =>
      `This UPDATE sets ${table}.${column} after the function locked the row, but nothing reads ${column} under that lock, so a second request waits for the first and then repeats its change (the double invoice void, 578c411ffe). Select ${column} in the locked query (\`.select("${column}")…forUpdate()\`) and refuse when it is not the status you move from.`;

    const statusMessage = (table: string, column: string) =>
      `This UPDATE sets ${table}.${column} with no predicate on ${column}, so a request that moved the row after you read it is overwritten. Check the status in the UPDATE (\`.eq("${column}", <expected>)\` / \`.where("${column}", "=", <expected>)\`) and refuse when no row changed, or lock the row FOR UPDATE and re-check it before the UPDATE.`;

    /**
     * Enums named like a status that are not a lifecycle: a classification or
     * a measured result that is set to whatever is true now, never moved from
     * one expected state to the next, and the progress of a single background
     * job.
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
     * The enum-typed lifecycle columns per table: `status` and `…Status`, less
     * `NOT_LIFECYCLE_ENUMS`. A `…History` table is an append-only log, so it
     * is left out.
     */
    const statusColumns = (
      columnTypes: Map<string, Map<string, string>>
    ): Map<string, Set<string>> => {
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
    };

    const auditColumns = new Set([
      "id",
      "companyId",
      "updatedAt",
      "updatedBy",
      "createdAt",
      "createdBy"
    ]);

    return ({ files, columnTypes }) => {
      const columns = statusColumns(columnTypes);
      return eachFile(files, (file, contents) => {
        const { text, regions, locks, writes } = readRowWrites(contents);
        const violations: Violation[] = [];
        const seen = new Set<string>();
        for (const write of writes) {
          const lifecycle = columns.get(write.table);
          if (!lifecycle) continue;
          for (const field of write.fields) {
            if (!lifecycle.has(field.name)) continue;
            const at = `${field.index}:${write.table}.${field.name}`;
            if (seen.has(at)) continue;
            if (
              namesColumn(write.guards, field.name, write.alias, write.table)
            ) {
              continue;
            }
            // A predicate on another column the same UPDATE changes is a claim
            // too: `.set({ status, salesInvoiceLineId: null })
            // .where("salesInvoiceLineId", "in", ids)` matches nothing the
            // second time.
            const claims = write.fields.some(
              (other) =>
                other.name !== field.name &&
                !auditColumns.has(other.name) &&
                namesColumn(write.guards, other.name, write.alias, write.table)
            );
            if (claims) continue;
            const lock = lockedRead(
              text,
              regions,
              locks,
              write.index,
              write.table,
              field.name
            );
            if (lock === "read") continue;
            const fn = regionOf(regions, write.index)?.name ?? "<top level>";
            seen.add(at);
            violations.push({
              file,
              line: lineOf(text, field.index),
              snippet: `${fn}: ${write.table}.${field.name}`,
              message: (lock === "blind" ? blindLockMessage : statusMessage)(
                write.table,
                field.name
              )
            });
          }
        }
        return violations;
      });
    };
  }
});
