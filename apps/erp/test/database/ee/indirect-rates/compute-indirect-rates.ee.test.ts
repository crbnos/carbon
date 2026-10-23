// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The rate run against the local database: it reads the YTD GL and project
// ledger cost, and writes the Actual rates, the statement and the period run.
// The feature check reads the company's plan; it is the one stubbed boundary.

import { sql } from "kysely";
import { expect, vi } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../../fixtures/local-database";

vi.mock("@carbon/ee/plan.server", () => ({
  companyHasFeature: vi.fn(async () => true)
}));

import { computeIndirectRates } from "@carbon/ee/indirect-rates.server";

const USER = "system";

databaseTest(
  "the rate run computes YTD Actual rates through the cascade and writes the statement",
  async () => {
    const db = await connectLocalTestDatabase();
    const prefix = `irtest-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const companyId = `${prefix}-company`;
    const groupId = `${prefix}-group`;
    const id = (name: string) => `${prefix}-${name}`;

    try {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
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
            baseCurrencyCode: "USD",
            timezone: "America/New_York"
          })
          .execute();
        await trx
          .insertInto("account")
          .values(
            (
              [
                ["fringe", "Fringe benefits", "Expense", "Allowable"],
                ["indirect-labor", "Indirect labor", "Expense", "Allowable"],
                ["ga", "General and administrative", "Expense", "Allowable"],
                [
                  "ga-unallowable",
                  "Entertainment",
                  "Expense",
                  "Expressly Unallowable"
                ],
                ["cash", "Cash", "Asset", "Allowable"]
              ] as const
            ).map(([key, name, accountClass, allowability]) => ({
              id: id(key),
              name,
              class: accountClass,
              allowability,
              incomeBalance:
                accountClass === "Asset"
                  ? ("Balance Sheet" as const)
                  : ("Income Statement" as const),
              companyGroupId: groupId,
              createdBy: USER
            }))
          )
          .execute();
        // B14: a period with no fiscal numbers (job-costing SQL creates these).
        await trx
          .insertInto("accountingPeriod")
          .values({
            id: id("period"),
            startDate: "2026-03-01",
            endDate: "2026-03-31",
            companyId,
            createdBy: USER
          })
          .execute();

        const journal = async (
          key: string,
          status: "Posted" | "Provisional",
          postingDate: string,
          lines: [string, number][]
        ) => {
          await trx
            .insertInto("journal")
            .values({
              id: id(`journal-${key}`),
              journalEntryId: id(`je-${key}`),
              companyId,
              status,
              postingDate
            })
            .execute();
          await trx
            .insertInto("journalLine")
            .values(
              lines.map(([account, amount], index) => ({
                journalId: id(`journal-${key}`),
                accountId: id(account),
                amount,
                journalLineReference: `${key}-${index}`,
                companyId
              }))
            )
            .execute();
        };
        // Natural-balance signs: + debits an Expense, − credits an Asset.
        await journal("ytd", "Posted", "2026-02-15", [
          ["fringe", 30_000],
          ["indirect-labor", 20_000],
          ["ga", 50_000],
          ["ga-unallowable", 5_000],
          ["cash", -105_000]
        ]);
        // Never counted: a Provisional journal, and last fiscal year.
        await journal("provisional", "Provisional", "2026-03-02", [
          ["fringe", 99_999],
          ["cash", -99_999]
        ]);
        await journal("last-year", "Posted", "2025-12-31", [
          ["fringe", 11_111],
          ["cash", -11_111]
        ]);

        await trx
          .insertInto("project")
          .values({
            id: id("project"),
            name: "Direct contract",
            identifier: "DC",
            status: "Released",
            costTreatment: "Contract",
            costObjective: "Direct",
            companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("projectLedger")
          .values({
            companyId,
            projectId: id("project"),
            postingDate: "2026-01-20",
            costType: "Labor",
            documentType: "Timesheet",
            documentId: id("timesheet"),
            quantity: 1_000,
            amount: 80_000,
            createdBy: USER
          })
          .execute();

        const pools = [
          ["fringe", "Fringe", "Fringe", 1, "Total Labor Dollars"],
          ["overhead", "Overhead", "Overhead", 2, "Direct Labor Dollars"],
          ["ga", "G&A", "G&A", 3, "Total Cost Input"]
        ] as const;
        await trx
          .insertInto("indirectPool")
          .values(
            pools.map(([key, name, poolType, sequence, baseType]) => ({
              id: id(`pool-${key}`),
              name,
              poolType,
              sequence,
              baseType,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
        await trx
          .insertInto("indirectPoolAccount")
          .values(
            (
              [
                ["fringe", "fringe", "Cost"],
                ["fringe", "indirect-labor", "Base"],
                ["overhead", "indirect-labor", "Cost"],
                ["ga", "ga", "Cost"],
                ["ga", "ga-unallowable", "Cost"]
              ] as const
            ).map(([pool, account, role]) => ({
              indirectPoolId: id(`pool-${pool}`),
              accountId: id(account),
              role,
              companyId,
              createdBy: USER
            }))
          )
          .execute();
      });

      const run = () =>
        computeIndirectRates(db, {} as never, {
          companyId,
          userId: USER,
          accountingPeriodId: id("period")
        });
      await run();
      // A second run replaces the rows; it never adds to them.
      await run();

      const rates = await db
        .selectFrom("indirectRate")
        .select([
          "indirectPoolId",
          "fiscalYear",
          "periodNumber",
          "rateType",
          "ytdRate",
          "periodRate",
          "poolCost",
          "unallowableCost",
          "baseAmount"
        ])
        .where("companyId", "=", companyId)
        .orderBy("indirectPoolId")
        .execute();
      const rateOf = (key: string) =>
        rates.find((r) => r.indirectPoolId === id(`pool-${key}`));

      expect(rates).toHaveLength(3);
      expect(rateOf("fringe")).toMatchObject({
        fiscalYear: 2026,
        periodNumber: 3,
        rateType: "Actual",
        poolCost: 30_000,
        baseAmount: 100_000,
        ytdRate: 0.3,
        // No Actual row for period 2, so no period rate.
        periodRate: null
      });
      expect(rateOf("overhead")).toMatchObject({
        poolCost: 26_000,
        baseAmount: 80_000,
        ytdRate: 0.325
      });
      // 80,000 labor + 24,000 fringe + 26,000 overhead on it
      expect(rateOf("ga")).toMatchObject({
        poolCost: 50_000,
        unallowableCost: 5_000,
        baseAmount: 130_000,
        ytdRate: 0.38462
      });

      const statement = await db
        .selectFrom("indirectExpenseStatement")
        .select([
          "indirectPoolId",
          "lineType",
          "accountId",
          "sourcePoolId",
          "amount",
          "unallowableAmount"
        ])
        .where("companyId", "=", companyId)
        .where("fiscalYear", "=", 2026)
        .where("periodNumber", "=", 3)
        .execute();
      expect(statement).toHaveLength(5);
      expect(
        statement.find(
          (l) =>
            l.indirectPoolId === id("pool-overhead") &&
            l.lineType === "Carried Burden"
        )
      ).toMatchObject({ sourcePoolId: id("pool-fringe"), amount: 6_000 });
      expect(
        statement.find((l) => l.accountId === id("ga-unallowable"))
      ).toMatchObject({ amount: 5_000, unallowableAmount: 5_000 });

      const runs = await db
        .selectFrom("indirectRateRun")
        .select(["fiscalYear", "periodNumber", "ratesComputedAt", "error"])
        .where("companyId", "=", companyId)
        .execute();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        fiscalYear: 2026,
        periodNumber: 3,
        error: null
      });
      expect(runs[0]!.ratesComputedAt).not.toBeNull();
    } finally {
      await db.destroy();
    }
  }
);
