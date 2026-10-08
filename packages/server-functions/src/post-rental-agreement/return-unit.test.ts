// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pins today's unit return against the live database, so moving the return
// body into `returnRentalUnit` cannot change what it writes. It acts through
// a rental receipt, which re-cuts the periods exactly as the old return did.

import { sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import postReceipt from "../post-receipt";
import { rentalFixture } from "./rental-test-fixture";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

async function returnUnitOnSeptember20(f: Fixture) {
  const receipt = await create(f.ctx, {
    type: "receiptFromRentalAgreement",
    rentalAgreementId: f.agreementId,
    rentalAgreementLineId: f.lineIds[0]!
  });
  if (receipt.error) return receipt;
  return postReceipt(f.ctx, {
    type: "post",
    receiptId: receipt.data.id,
    postingDate: "2026-09-20"
  });
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

      expect({ periods, line }).toMatchSnapshot();
    } finally {
      await f.cleanup();
    }
  }
);
