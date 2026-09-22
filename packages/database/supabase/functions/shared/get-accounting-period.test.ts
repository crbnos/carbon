import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { createClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { Database } from "../lib/types.ts";
import {
  cardTransactionFixture,
  databaseTest,
} from "../post-card-transaction/post-card-transaction-test-fixture.ts";
import {
  getAccountingPeriodForDate,
  getCurrentAccountingPeriod,
} from "./get-accounting-period.ts";

// A caller already holding a transaction must not read periods through REST:
// those reads cannot see its uncommitted changes and escape its locks.
const noRestReads = createClient<Database>(
  "http://unexpected-period-read.invalid",
  "test-key",
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: () =>
        Promise.reject(new Error("Period reads escaped the transaction")),
    },
  },
);

for (
  const [name, resolve] of [
    ["historical", getAccountingPeriodForDate],
    ["current", getCurrentAccountingPeriod],
  ] as const
) {
  databaseTest(
    `${name} period resolution sees the caller's uncommitted period`,
    async () => {
      const f = await cardTransactionFixture();
      try {
        await f.db.deleteFrom("accountingPeriod").where(
          "companyId",
          "=",
          f.companyId,
        ).execute();
        await f.db.transaction().execute(async (trx) => {
          const period = await trx.insertInto("accountingPeriod").values({
            companyId: f.companyId,
            startDate: "2024-02-01",
            endDate: "2024-02-29",
            fiscalYear: 2024,
            periodNumber: 2,
            status: "Active",
            closeStatus: "Open",
            createdBy: "system",
          }).returning("id").executeTakeFirstOrThrow();
          assertEquals(
            await resolve(noRestReads, f.companyId, trx, "2024-02-29"),
            period.id,
          );
        });
      } finally {
        await f.cleanup();
      }
    },
  );
}

databaseTest(
  "period creation uses the fiscal start and leap-month boundary",
  async () => {
    const f = await cardTransactionFixture();
    try {
      await f.db.deleteFrom("accountingPeriod").where(
        "companyId",
        "=",
        f.companyId,
      ).execute();
      await f.db.insertInto("fiscalYearSettings").values({
        companyId: f.companyId,
        startMonth: "July",
        updatedBy: "system",
      }).onConflict((oc) =>
        oc.column("companyId").doUpdateSet({ startMonth: "July" })
      ).execute();
      const id = await getCurrentAccountingPeriod(
        noRestReads,
        f.companyId,
        f.db,
        "2024-02-29",
      );
      const period = await f.db.selectFrom("accountingPeriod").select([
        sql<string>`"startDate"::text`.as("startDate"),
        sql<string>`"endDate"::text`.as("endDate"),
        "fiscalYear",
        "periodNumber",
        "status",
      ]).where("id", "=", id).executeTakeFirstOrThrow();
      assertEquals(period, {
        startDate: "2024-02-01",
        endDate: "2024-02-29",
        fiscalYear: 2024,
        periodNumber: 8,
        status: "Active",
      });
    } finally {
      await f.cleanup();
    }
  },
);

databaseTest(
  "concurrent first-period resolution converges to one row",
  async () => {
    const f = await cardTransactionFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      await f.db.deleteFrom("accountingPeriod").where(
        "companyId",
        "=",
        f.companyId,
      ).execute();
      const periods = await Promise.all([
        getAccountingPeriodForDate(
          noRestReads,
          f.companyId,
          left,
          "2024-02-29",
        ),
        getAccountingPeriodForDate(
          noRestReads,
          f.companyId,
          right,
          "2024-02-29",
        ),
      ]);
      assertEquals(periods[0], periods[1]);
      assertEquals(
        (await f.db.selectFrom("accountingPeriod").select("id")
          .where("companyId", "=", f.companyId).execute()).length,
        1,
      );
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  },
);
