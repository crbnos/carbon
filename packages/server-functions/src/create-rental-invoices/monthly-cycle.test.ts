// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A Monthly rental agreement against the live database: periods run from the
// start date's day (7 Sep – 6 Oct, 7 Oct – 6 Nov, …) when the daily billing
// pass rolls them forward and when a return re-cuts them, and every whole
// period bills the month rate.

import { sql } from "kysely";
import { expect } from "vitest";
import create from "../create";
import { databaseTest } from "../local-database-test-fixture";
import postReceipt from "../post-receipt";
import { rentalFixture } from "../post-rental-agreement/rental-test-fixture";
import createRentalInvoices from "./index";

type Fixture = Awaited<ReturnType<typeof rentalFixture>>;

async function putOnRent(f: Fixture) {
  await f.db
    .updateTable("rentalAgreementLine")
    .set({ status: "On Rent", deliveredAt: "2026-09-07" })
    .where("id", "=", f.lineIds[0]!)
    .where("companyId", "=", f.companyId)
    .execute();
}

async function billingPeriods(f: Fixture) {
  const rows = await f.db
    .selectFrom("rentalBillingPeriod")
    .select([
      sql<string>`"periodStart"::text`.as("periodStart"),
      sql<string>`"periodEnd"::text`.as("periodEnd"),
      "days",
      "amount",
      "status",
      "rateUnitApplied",
      "isAdjustment"
    ])
    .where("rentalAgreementLineId", "=", f.lineIds[0]!)
    .where("companyId", "=", f.companyId)
    .orderBy("periodStart")
    .orderBy("isAdjustment")
    .execute();
  return rows.map((row) => [
    row.periodStart,
    row.periodEnd,
    row.days,
    Number(row.amount),
    row.rateUnitApplied,
    row.status
  ]);
}

databaseTest(
  "the daily pass rolls a Monthly agreement forward from its start day and bills the month rate",
  async () => {
    const f = await rentalFixture({ billingCycle: "Monthly" });
    try {
      await putOnRent(f);
      // The fixture seeds its periods without a tier; activation records one.
      await f.db
        .updateTable("rentalBillingPeriod")
        .set({ rateUnitApplied: "Month" })
        .where("rentalAgreementLineId", "=", f.lineIds[0]!)
        .where("companyId", "=", f.companyId)
        .execute();

      const result = await createRentalInvoices(f.ctx, {
        asOf: "2026-10-20",
        rentalAgreementId: f.agreementId
      });
      expect(result.error).toBeNull();
      expect(result.data!.failures).toEqual([]);

      // The horizon is today + 1 month (20 Nov): the 7 Nov period, plus one
      // beyond it. 7 Oct – 6 Nov fell due on the 7th and is billed.
      expect(await billingPeriods(f)).toEqual([
        ["2026-09-07", "2026-10-06", 30, 300, "Month", "Invoiced"],
        ["2026-10-07", "2026-11-06", 31, 300, "Month", "Invoiced"],
        ["2026-11-07", "2026-12-06", 30, 300, "Month", "Pending"],
        ["2026-12-07", "2027-01-06", 31, 300, "Month", "Pending"]
      ]);

      const lines = await f.db
        .selectFrom("salesInvoiceLine")
        .select(["description", "unitPrice"])
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementId", "=", f.agreementId)
        .execute();
      expect(lines).toHaveLength(1);
      expect(lines[0]!.description).toContain(
        "2026-10-07 – 2026-11-06 · 31 days · Month rate"
      );
      expect(Number(lines[0]!.unitPrice)).toBe(300);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a return cuts a Monthly period to the days used, prorated by that period's length",
  async () => {
    const f = await rentalFixture({ billingCycle: "Monthly" });
    try {
      await putOnRent(f);
      const receipt = await create(f.ctx, {
        type: "receiptFromRentalAgreement",
        rentalAgreementId: f.agreementId,
        rentalAgreementLineId: f.lineIds[0]!
      });
      expect(receipt.error).toBeNull();
      const posted = await postReceipt(f.ctx, {
        type: "post",
        receiptId: receipt.data!.id,
        postingDate: "2026-10-15"
      });
      expect(posted.error).toBeNull();

      // 7 – 15 Oct is 9 of the period's 31 days: 300 × 9 ÷ 31 = 87.10.
      expect(await billingPeriods(f)).toEqual([
        ["2026-09-07", "2026-10-06", 30, 300, null, "Invoiced"],
        ["2026-10-07", "2026-10-15", 9, 87.1, "Month", "Pending"]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
