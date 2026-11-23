// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Posting a lease run stamps each lessee schedule line it posts; reversing
// the run clears the stamps. The posting is one Kysely transaction.

import { expect } from "vitest";
import {
  postRevenueRecognitionRun,
  reverseRevenueRecognitionRun
} from "../../../app/modules/accounting/accounting.service";
import { leaseFixture } from "../fixtures/lease";
import { databaseTest } from "../fixtures/local-database";
import { holdInDraftRun } from "../fixtures/run";

databaseTest(
  "a lease run stamps its lessee schedule lines and Reverse Run clears them",
  async () => {
    const f = await leaseFixture();
    try {
      const { db, companyId, leaseId, accounts } = f;
      const leaseLineId = f.lineIds[0]!;
      const monthEnd = "2027-01-31";

      const period = await db
        .insertInto("accountingPeriod")
        .values({
          startDate: "2027-01-01",
          endDate: monthEnd,
          companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const scheduleLine = await db
        .insertInto("leaseScheduleLine")
        .values({
          leaseId,
          leaseLineId,
          periodDate: monthEnd,
          openingLiability: 328710.16,
          paymentAmount: 10000,
          interestAmount: 1643.55,
          principalAmount: 8356.45,
          closingLiability: 320353.71,
          leaseCost: 10000,
          rouAmortization: 8356.45,
          closingRouAsset: 320353.71,
          companyId,
          createdBy: "system"
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const rows = await db
        .insertInto("revenueRecognitionSchedule")
        .values(
          (
            [
              ["Interest", 1643.55, accounts.opex, accounts.liability],
              ["Amortization", 8356.45, accounts.opex, accounts.accumulated]
            ] as const
          ).map(([type, amount, debitAccountId, creditAccountId]) => ({
            type,
            amount,
            debitAccountId,
            creditAccountId,
            leaseId,
            leaseScheduleLineId: scheduleLine.id,
            periodStart: "2027-01-01",
            periodEnd: monthEnd,
            scheduledDate: monthEnd,
            status: "Planned" as const,
            companyId,
            createdBy: "system"
          }))
        )
        .returning("id")
        .execute();
      const runId = await holdInDraftRun(
        db,
        companyId,
        rows.map((row) => row.id),
        monthEnd,
        "Lease"
      );
      const periods = new Map([
        [monthEnd, { accountingPeriodId: period.id, postingDate: monthEnd }]
      ]);
      const stamp = () =>
        db
          .selectFrom("leaseScheduleLine")
          .select(["journalId", "postedAt"])
          .where("id", "=", scheduleLine.id)
          .where("companyId", "=", companyId)
          .executeTakeFirstOrThrow();

      const posted = await postRevenueRecognitionRun(db, {
        runId,
        companyId,
        userId: "system",
        periods,
        dimensionIds: {}
      });
      const afterPost = await stamp();
      expect(afterPost.journalId).toBe(posted.journalId);
      expect(afterPost.postedAt).not.toBeNull();
      const journal = await db
        .selectFrom("journal")
        .select("sourceType")
        .where("id", "=", posted.journalId)
        .executeTakeFirstOrThrow();
      expect(journal.sourceType).toBe("Lease Run");

      const reversed = await reverseRevenueRecognitionRun(db, {
        runId,
        periods,
        companyId,
        userId: "system"
      });
      expect(reversed.deleted).toBe(false);
      expect(await stamp()).toEqual({ journalId: null, postedAt: null });
      const after = await db
        .selectFrom("revenueRecognitionSchedule")
        .select(["status", "journalId"])
        .where("leaseScheduleLineId", "=", scheduleLine.id)
        .where("companyId", "=", companyId)
        .execute();
      expect(after).toEqual([
        { status: "Planned", journalId: null },
        { status: "Planned", journalId: null }
      ]);
      const run = await db
        .selectFrom("revenueRecognitionRun")
        .select("status")
        .where("id", "=", runId)
        .executeTakeFirstOrThrow();
      expect(run.status).toBe("Draft");
    } finally {
      await f.cleanup();
    }
  }
);
