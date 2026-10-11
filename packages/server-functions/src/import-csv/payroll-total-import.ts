// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Payroll totals (Government Contracting 5a): one row per employee and pay
// period, the gross wages and the hours paid, from the payroll system's
// export. The labor distribution report compares them with the timesheets.
// A re-import of the same period updates its row, never adds a second.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5a.md (Task 28, P8).

import type { KyselyDatabase } from "@carbon/database/client";
import { parseDate } from "@internationalized/date";
import { type Kysely, sql } from "kysely";
import { inChunks } from "./chunks";

type Rec = Record<string, string>;

type Summary = {
  inserted: number;
  updated: number;
  errors: Array<{ row: number; reason: string }>;
  skipped: Array<{ row: number; reason: string }>;
};

export type PayrollTotalRow = {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  grossWages: number;
  hoursPaid: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar date. */
function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  try {
    return parseDate(value).toString() === value;
  } catch {
    return false;
  }
}

/** A money or hours cell: "1,234.50" and "$1,234.50" read as 1234.5. */
function readAmount(value: string | undefined): number | null {
  const text = (value ?? "").trim().replace(/[$,]/g, "");
  if (text === "") return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Reads one mapped CSV row. Returns the row, or the reason it is refused.
 * Whether the employee belongs to the company is checked by the caller.
 */
export function readPayrollTotalRow(
  record: Rec
): { row: PayrollTotalRow } | { error: string } {
  const employeeId = (record.employeeId ?? "").trim();
  if (!employeeId) return { error: "Employee is required" };

  const periodStart = (record.periodStart ?? "").trim();
  const periodEnd = (record.periodEnd ?? "").trim();
  if (!isCalendarDate(periodStart)) {
    return { error: "Period Start must be a date as YYYY-MM-DD" };
  }
  if (!isCalendarDate(periodEnd)) {
    return { error: "Period End must be a date as YYYY-MM-DD" };
  }
  if (periodEnd < periodStart) {
    return { error: "Period End is before Period Start" };
  }

  const grossWages = readAmount(record.grossWages);
  if (grossWages === null || grossWages < 0) {
    return { error: "Gross Wages must be a number of 0 or more" };
  }
  const hoursPaid = readAmount(record.hoursPaid);
  if (hoursPaid === null || hoursPaid < 0) {
    return { error: "Hours Paid must be a number of 0 or more" };
  }

  return { row: { employeeId, periodStart, periodEnd, grossWages, hoursPaid } };
}

/**
 * Writes the payroll totals of a file: one `INSERT … ON CONFLICT DO UPDATE`
 * per 500 rows, in one transaction. A row with an unknown employee or bad
 * dates or amounts is a row error and does not stop the file. A second row
 * for the same employee and period is skipped.
 */
export async function importPayrollTotals(
  db: Kysely<KyselyDatabase>,
  args: {
    mappedRecords: Rec[];
    companyId: string;
    userId: string;
    summary: Summary;
  }
) {
  const { mappedRecords, companyId, userId, summary } = args;

  const read = mappedRecords.map((record) => readPayrollTotalRow(record));
  const employeeIds = [
    ...new Set(
      read.flatMap((result) => ("row" in result ? [result.row.employeeId] : []))
    )
  ];
  const employees =
    employeeIds.length === 0
      ? []
      : await db
          .selectFrom("employee")
          .select("id")
          .where("companyId", "=", companyId)
          .where("id", "in", employeeIds)
          .execute();
  const knownEmployees = new Set(employees.map((employee) => employee.id));

  const accepted: PayrollTotalRow[] = [];
  const firstRowByKey = new Map<string, number>();
  read.forEach((result, index) => {
    if ("error" in result) {
      summary.errors.push({ row: index, reason: result.error });
      return;
    }
    const { row } = result;
    if (!knownEmployees.has(row.employeeId)) {
      summary.errors.push({
        row: index,
        reason: "The employee was not found in this company"
      });
      return;
    }
    const key = `${row.employeeId}|${row.periodStart}|${row.periodEnd}`;
    const first = firstRowByKey.get(key);
    if (first !== undefined) {
      summary.skipped.push({
        row: index,
        reason: `Repeats the employee and period of row ${first + 1}`
      });
      return;
    }
    firstRowByKey.set(key, index);
    accepted.push(row);
  });
  if (accepted.length === 0) return;

  const written = await db.transaction().execute((trx) =>
    inChunks(accepted, (chunk) =>
      trx
        .insertInto("payrollPeriodTotal")
        .values(
          chunk.map((row) => ({
            ...row,
            companyId,
            importedBy: userId
          }))
        )
        .onConflict((oc) =>
          oc
            .columns(["employeeId", "periodStart", "periodEnd", "companyId"])
            .doUpdateSet((eb) => ({
              grossWages: eb.ref("excluded.grossWages"),
              hoursPaid: eb.ref("excluded.hoursPaid"),
              updatedBy: userId,
              updatedAt: sql<string>`now()`
            }))
        )
        // `xmax = 0` on a row the statement inserted, not on one it updated.
        .returning(sql<boolean>`(xmax = 0)`.as("inserted"))
        .execute()
    )
  );
  for (const row of written) {
    if (row.inserted) summary.inserted += 1;
    else summary.updated += 1;
  }
}
