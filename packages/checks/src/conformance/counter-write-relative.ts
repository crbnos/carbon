// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Provenance, Violation } from "../check";
import { blankComments } from "../sources/comments";
import {
  chainCalls,
  locksBefore,
  matchBracket,
  nearestInitializer,
  type Region,
  regionOf,
  rowLocks,
  rowWrites,
  topLevelRegions
} from "./row-writes";

/**
 * A running total (`quantityIssued`, `quantityReceived`, …) must be added to in
 * SQL, or read under the lock that every other writer of it takes.
 *
 * The shipped bug: `issueJobOperationMaterials` read the job material, then
 * wrote `quantityIssued: round(Number(material.quantityIssued) + quantityToIssue)`
 * — an absolute value computed in JavaScript from the earlier read. Two
 * completions of one operation both read the same `quantityIssued` and both
 * issued (fixed in ca513209d8 by locking the operation first). The job's
 * backflush takes different locks, so a completion that read before a backflush
 * committed still issued the material again and its write replaced the
 * backflush's increment (fixed in f92d1b24fa by reading `quantityIssued` again
 * under the draw locks the backflush takes). The operation lock of ca513209d8
 * did not cover the backflush, which is why a lock on ANOTHER table does not
 * pass this check.
 *
 * A write is flagged when its literal row object sets a counter column of that
 * table (`COUNTER_COLUMNS`, numeric in the generated types) to a value that
 * reads the same column back from JavaScript — `x.quantityIssued`, directly or
 * through one local (`const issued = line.quantityIssued + q;` …
 * `{ quantityIssued: issued }`). A value built with `sql` or Kysely's `eb` is
 * relative SQL and passes. The function passes when, before the write, it
 *  - locked a row of the written table (`.selectFrom(t)…forUpdate()`, raw SQL
 *    `FOR UPDATE`, or a same-file helper that does), or
 *  - took a named lock (`lock…(` / `pg_advisory_xact_lock`) and only then read
 *    the counter from the table again (`.selectFrom(t)` naming the column, or
 *    `selectAll`) — the f92d1b24fa fix.
 * It cannot tell whether every other writer takes that lock; the formal models
 * in `packages/models` are where a protocol with several writers is checked.
 */

export const COUNTER_COLUMNS = new Set([
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

const MESSAGE = (table: string, column: string) =>
  `This sets ${table}.${column} to a total computed in JavaScript from an earlier read, so a writer that committed after the read is lost (counted twice, or overwritten). Write it relatively in SQL (sql\`"${column}" + \${delta}\`) or read it under the row lock (.selectFrom("${table}")…forUpdate()) before computing it.`;

const RELATIVE = /^(?:sql\b|eb\b|\(\s*eb\s*\)|\(?\s*\w*\s*\)?\s*=>)/;

/** Whether the value reads `column` back from a JavaScript object. */
function readsColumn(value: string, column: string): boolean {
  return new RegExp(
    `(?:\\??\\.\\s*${column}\\b|\\[\\s*["'\`]${column}["'\`]\\s*\\])`
  ).test(value);
}

/** How many locals deep a value is followed back to a read of the column. */
const LOCAL_HOPS = 3;

/**
 * Whether a local the value names was initialized, at its nearest declaration
 * before the write, from a read of `column` — directly or through further
 * locals (`const current = job.quantityShipped ?? 0; const next = current +
 * shipped;` … `{ quantityShipped: next }`).
 */
function readsColumnThroughLocal(
  text: string,
  region: Region | undefined,
  index: number,
  value: string,
  column: string,
  hops = LOCAL_HOPS,
  visited = new Set<string>()
): boolean {
  if (!region || hops === 0) return false;
  for (const [name] of value.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*\b/g)) {
    if (visited.has(name)) continue;
    visited.add(name);
    const initializer = nearestInitializer(text, region.start, index, name);
    if (!initializer) continue;
    if (readsColumn(initializer.text, column)) return true;
    if (
      readsColumnThroughLocal(
        text,
        region,
        initializer.start,
        initializer.text,
        column,
        hops - 1,
        visited
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether, before `index`, the function took a named lock and then read
 * `column` of `table` again: `lockUntrackedDraws(…)` then
 * `.selectFrom("jobMaterial").select(["id", "quantityIssued"])`.
 */
function rereadUnderNamedLock(
  text: string,
  region: Region | undefined,
  index: number,
  table: string,
  column: string
): boolean {
  if (!region) return false;
  const body = text.slice(region.start, index);
  const lock = [
    ...body.matchAll(/\b(?:lock[A-Z][\w$]*\s*\(|pg_advisory_xact_lock\b)/g)
  ][0];
  if (!lock) return false;
  const after = region.start + (lock.index ?? 0);
  for (const m of text.slice(after, index).matchAll(/\.selectFrom\s*\(/g)) {
    const open = after + (m.index ?? 0) + m[0].length - 1;
    const named = new RegExp(`^\\(\\s*["'\`]${table}(?:\\s+as\\s+\\w+)?["'\`]`);
    if (!named.test(text.slice(open, open + 200))) continue;
    const calls = chainCalls(text, matchBracket(text, open) + 1);
    if (calls.some((c) => c.name === "selectAll")) return true;
    const selected = calls
      .filter((c) => c.name === "select")
      .map((c) => text.slice(c.open, c.close + 1))
      .join(" ");
    if (new RegExp(`["'\`](?:\\w+\\.)?${column}["'\`]`).test(selected)) {
      return true;
    }
  }
  return false;
}

export const COUNTER_WRITE_RELATIVE = "counter-write-relative";

// Exported on its own because the check is built from the generated types:
// the provenance meta-test reads it without building the check.
export const COUNTER_WRITE_RELATIVE_PROVENANCE: Provenance = {
  deprecates:
    "writing a counter as a JavaScript total of an earlier read (issueJobOperationMaterials' `quantityIssued: material.quantityIssued + quantityToIssue`)",
  replacedBy:
    'a relative SQL write (sql`"quantityIssued" + delta`), or a FOR UPDATE row lock taken before the counter is read',
  since: "ca513209d8, f92d1b24fa",
  incidents: ["ca513209d8", "f92d1b24fa"]
};

export function counterWriteRelative(
  columnTypes: Map<string, Map<string, string>>
): ConformanceCheck {
  return {
    id: COUNTER_WRITE_RELATIVE,
    description:
      "A running total is added to in SQL, or read under the row lock — an absolute value computed in JavaScript from an earlier read loses or doubles a concurrent writer's change.",
    provenance: COUNTER_WRITE_RELATIVE_PROVENANCE,
    scan(file, contents) {
      if (!/\.updateTable|\.update\s*\(|updateRows/.test(contents)) return [];
      const text = blankComments(contents);
      const regions = topLevelRegions(text);
      const locks = rowLocks(text);
      const violations: Violation[] = [];
      const seen = new Set<string>();
      for (const write of rowWrites(text, regions)) {
        const columns = columnTypes.get(write.table);
        if (!columns) continue;
        const region = regionOf(regions, write.index);
        for (const field of write.fields) {
          if (!COUNTER_COLUMNS.has(field.name)) continue;
          const at = `${field.index}:${write.table}.${field.name}`;
          if (seen.has(at)) continue;
          if (!/^number\b/.test(columns.get(field.name) ?? "")) continue;
          if (RELATIVE.test(field.value)) continue;
          const stale =
            readsColumn(field.value, field.name) ||
            readsColumnThroughLocal(
              text,
              region,
              field.index,
              field.value,
              field.name
            );
          if (!stale) continue;
          if (locksBefore(text, regions, locks, write.index).has(write.table)) {
            continue;
          }
          if (
            rereadUnderNamedLock(
              text,
              region,
              write.index,
              write.table,
              field.name
            )
          ) {
            continue;
          }
          seen.add(at);
          violations.push({
            file,
            line: text.slice(0, field.index).split("\n").length,
            snippet: `${region?.name ?? "<top level>"}: ${write.table}.${field.name}`,
            message: MESSAGE(write.table, field.name)
          });
        }
      }
      return violations;
    }
  };
}
