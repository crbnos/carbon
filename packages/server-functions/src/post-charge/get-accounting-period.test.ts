// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  getAccountingPeriodForDate,
  getCurrentAccountingPeriod
} from "../lib/get-accounting-period";
import { databaseTest } from "../local-database-test-fixture";
import { chargeFixture } from "./post-charge-test-fixture";

for (const [name, resolve] of [
  ["historical", getAccountingPeriodForDate],
  ["current", getCurrentAccountingPeriod]
] as const) {
  databaseTest(
    `${name} period resolution sees the caller's uncommitted period`,
    async () => {
      const f = await chargeFixture();
      try {
        await f.db
          .deleteFrom("accountingPeriod")
          .where("companyId", "=", f.companyId)
          .execute();
        await f.db.transaction().execute(async (trx) => {
          const period = await trx
            .insertInto("accountingPeriod")
            .values({
              companyId: f.companyId,
              startDate: "2024-02-01",
              endDate: "2024-02-29",
              fiscalYear: 2024,
              periodNumber: 2,
              status: "Active",
              closeStatus: "Open",
              createdBy: "system"
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          expect(await resolve(f.companyId, trx, "2024-02-29")).toEqual(
            period.id
          );
        });
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "period creation uses the fiscal start and leap-month boundary",
  async () => {
    const f = await chargeFixture();
    try {
      await f.db
        .deleteFrom("accountingPeriod")
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .insertInto("fiscalYearSettings")
        .values({
          companyId: f.companyId,
          startMonth: "July",
          updatedBy: "system"
        })
        .onConflict((oc) =>
          oc.column("companyId").doUpdateSet({ startMonth: "July" })
        )
        .execute();
      const id = await getCurrentAccountingPeriod(
        f.companyId,
        f.db,
        "2024-02-29"
      );
      const period = await f.db
        .selectFrom("accountingPeriod")
        .select([
          sql<string>`"startDate"::text`.as("startDate"),
          sql<string>`"endDate"::text`.as("endDate"),
          "fiscalYear",
          "periodNumber",
          "status"
        ])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(period).toEqual({
        startDate: "2024-02-01",
        endDate: "2024-02-29",
        fiscalYear: 2024,
        periodNumber: 8,
        status: "Active"
      });
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "concurrent first-period resolution converges to one row",
  async () => {
    const f = await chargeFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      await f.db
        .deleteFrom("accountingPeriod")
        .where("companyId", "=", f.companyId)
        .execute();
      const periods = await Promise.all([
        getAccountingPeriodForDate(f.companyId, left, "2024-02-29"),
        getAccountingPeriodForDate(f.companyId, right, "2024-02-29")
      ]);
      expect(periods[0]).toEqual(periods[1]);
      expect(
        (
          await f.db
            .selectFrom("accountingPeriod")
            .select("id")
            .where("companyId", "=", f.companyId)
            .execute()
        ).length
      ).toEqual(1);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);
