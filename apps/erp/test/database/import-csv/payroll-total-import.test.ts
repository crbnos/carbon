// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { importPayrollTotals } from "../../../app/modules/shared/payroll-total-import";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../fixtures/local-database";

const USER = "system";

const record = (overrides: Record<string, string> = {}) => ({
  employeeId: USER,
  periodStart: "2026-03-01",
  periodEnd: "2026-03-15",
  grossWages: "4,200.00",
  hoursPaid: "80",
  ...overrides
});

const emptySummary = () => ({
  inserted: 0,
  updated: 0,
  errors: [] as Array<{ row: number; reason: string }>,
  skipped: [] as Array<{ row: number; reason: string }>
});

databaseTest(
  "a re-import of the same period updates the row and does not add a second",
  async () => {
    const db = await connectLocalTestDatabase();
    const prefix = `prtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const companyId = `${prefix}-company`;
    const groupId = `${prefix}-group`;
    try {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .insertInto("companyGroup")
          .values({ id: groupId, name: prefix, createdBy: USER })
          .execute();
        await trx
          .insertInto("company")
          .values({
            id: companyId,
            name: prefix,
            companyGroupId: groupId,
            baseCurrencyCode: "USD"
          })
          .execute();
        await trx
          .insertInto("employeeType")
          .values({ id: `${prefix}-type`, name: "Employee", companyId })
          .execute();
        await trx
          .insertInto("employee")
          .values({
            id: USER,
            companyId,
            employeeTypeId: `${prefix}-type`,
            active: true
          })
          .execute();
      });

      const first = emptySummary();
      await importPayrollTotals(db, {
        mappedRecords: [
          record(),
          record({ employeeId: "not-an-employee" }),
          record({ grossWages: "1.00" })
        ],
        companyId,
        userId: USER,
        summary: first
      });
      expect(first.inserted).toBe(1);
      expect(first.updated).toBe(0);
      expect(first.errors).toEqual([
        { row: 1, reason: "The employee was not found in this company" }
      ]);
      expect(first.skipped).toEqual([
        { row: 2, reason: "Repeats the employee and period of row 1" }
      ]);

      const second = emptySummary();
      await importPayrollTotals(db, {
        mappedRecords: [record({ grossWages: "4,350.50", hoursPaid: "82" })],
        companyId,
        userId: USER,
        summary: second
      });
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(1);

      const rows = await db
        .selectFrom("payrollPeriodTotal")
        .select(["grossWages", "hoursPaid", "importedBy", "updatedBy"])
        .where("companyId", "=", companyId)
        .execute();
      expect(
        rows.map((row) => [
          Number(row.grossWages),
          Number(row.hoursPaid),
          row.importedBy,
          row.updatedBy
        ])
      ).toEqual([[4350.5, 82, USER, USER]]);
    } finally {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
      });
      await db.destroy();
    }
  }
);
