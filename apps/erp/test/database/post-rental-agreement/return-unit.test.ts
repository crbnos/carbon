// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Returning a rental unit through a rental receipt re-cuts its billing
// periods: the invoiced period gets a credit for the unused days and the
// periods after the return are dropped.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import { rentalFixture } from "../fixtures/rental";
import {
  invokePosting,
  invokeCreate
} from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

async function returnUnitOnSeptember20(f: Fixture) {
  const receipt = await invokeCreate(handlesOf(f.ctx), {
    type: "receiptFromRentalAgreement",
    rentalAgreementId: f.agreementId,
    rentalAgreementLineId: f.lineIds[0]!
  });
  if (receipt.error) return receipt;
  return invokePosting(
    handlesOf(f.ctx),
    "post-receipt",
    {
      type: "post",
      receiptId: receipt.data.id,
      postingDate: "2026-09-20"
    },
    postReceipt
  );
}

databaseTest(
  "an early return of an Advance unit re-cuts its periods",
  async () => {
    const f = await rentalFixture();
    const lineId = f.lineIds[0]!;
    try {
      await f.db
        .updateTable("rentalAgreementLine")
        .set({ status: "On Rent", deliveredAt: "2026-09-01" })
        .where("id", "=", lineId)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await returnUnitOnSeptember20(f);
      expect(result.error).toBeNull();

      const periodRows = await f.db
        .selectFrom("rentalBillingPeriod")
        .select([
          sql<string>`"periodStart"::text`.as("periodStart"),
          sql<string>`"periodEnd"::text`.as("periodEnd"),
          "days",
          "amount",
          "isAdjustment",
          "status",
          "rateUnitApplied",
          sql<string>`"dueOn"::text`.as("dueOn")
        ])
        .where("rentalAgreementLineId", "=", lineId)
        .where("companyId", "=", f.companyId)
        .orderBy("periodStart")
        .orderBy("isAdjustment")
        .execute();
      const periods = periodRows.map((row) => ({
        ...row,
        amount: Number(row.amount)
      }));

      const line = await f.db
        .selectFrom("rentalAgreementLine")
        .select([
          "status",
          sql<string | null>`"returnedAt"::text`.as("returnedAt")
        ])
        .where("id", "=", lineId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();

      // Sep (30 days, 300) was invoiced in advance; used Sep 1-20 = 20 days:
      // 300 * 20/30 - 300 = -100. October, after the return, is dropped.
      expect(periods).toEqual([
        {
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          days: 30,
          amount: 300,
          isAdjustment: false,
          status: "Invoiced",
          rateUnitApplied: null,
          dueOn: "2026-09-01"
        },
        {
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          days: 20,
          amount: -100,
          isAdjustment: true,
          status: "Pending",
          rateUnitApplied: "Month",
          dueOn: "2026-09-20"
        }
      ]);
      expect(line).toEqual({ status: "Returned", returnedAt: "2026-09-20" });
    } finally {
      await f.cleanup();
    }
  }
);
