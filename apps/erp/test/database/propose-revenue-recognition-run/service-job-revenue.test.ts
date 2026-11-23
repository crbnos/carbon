// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Service job revenue in the revenue recognition run, against the live
// database: a Billable job's earned-to-date minus what is already accrued
// becomes one Accrual row (Dr Contract Assets / Cr Service Revenue) per run.

import { expect } from "vitest";
import {
  SERVICE_REVENUE_CONTRACT_ASSETS_MISSING,
  synthesizeServiceJobRevenue
} from "../../../app/modules/accounting/accounting.service";
import { databaseTest } from "../fixtures/local-database";
import { serviceJobFixture } from "../fixtures/service-job";

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

const PERIOD_END = "2026-10-31";
const CREATED_AT = "2026-10-01T12:00:00Z";

/** The fixture plus Contract Assets and Service Revenue defaults, and a
 *  location for its jobs. */
async function fixture(): Promise<{ f: Fixture; locationId: string }> {
  const f = await serviceJobFixture();
  await f.db
    .insertInto("account")
    .values([
      {
        id: f.account("contract-assets"),
        name: "Contract assets",
        class: "Asset",
        incomeBalance: "Balance Sheet",
        companyGroupId: f.groupId,
        createdBy: "system"
      },
      {
        id: f.account("service-revenue"),
        name: "Service revenue",
        class: "Revenue",
        incomeBalance: "Income Statement",
        companyGroupId: f.groupId,
        createdBy: "system"
      }
    ])
    .execute();
  await f.db
    .updateTable("accountDefault")
    .set({
      contractAssetAccount: f.account("contract-assets"),
      serviceRevenueAccount: f.account("service-revenue")
    })
    .where("companyId", "=", f.companyId)
    .execute();
  const { locationId } = await f.addStockedItem("unit", {
    quantity: 1,
    unitCost: 10
  });
  return { f, locationId };
}

/** A job created in the run's month: the run skips a job created after its
 *  period end, and the fixture's time entries are dated 2026-10-01. */
async function addJob(f: Fixture, args: Parameters<Fixture["addJob"]>[0]) {
  const job = await f.addJob(args);
  await f.db
    .updateTable("serviceJob")
    .set({ createdAt: CREATED_AT })
    .where("id", "=", job.id)
    .execute();
  return job;
}

function synthesize(f: Fixture, periodEnd = PERIOD_END) {
  return f.db.transaction().execute((trx) =>
    synthesizeServiceJobRevenue(trx, {
      companyId: f.companyId,
      periodEnd,
      userId: "system"
    })
  );
}

/** The job's Accrual rows, oldest first. */
async function accruals(f: Fixture, serviceJobId: string) {
  const rows = await f.db
    .selectFrom("revenueRecognitionSchedule")
    .select([
      "amount",
      "status",
      "debitAccountId",
      "creditAccountId",
      "periodStart",
      "periodEnd",
      "scheduledDate"
    ])
    .where("companyId", "=", f.companyId)
    .where("serviceJobId", "=", serviceJobId)
    .where("type", "=", "Accrual")
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

async function amounts(f: Fixture, serviceJobId: string) {
  return (await accruals(f, serviceJobId)).map((row) => row.amount);
}

databaseTest(
  "a Time and Materials job accrues its billable hours at the job's rate, and each run catches up the difference",
  async () => {
    const { f, locationId } = await fixture();
    try {
      const job = await addJob(f, { locationId, laborBillRate: 95 });
      await f.addTime(job.id, { hours: 3 });
      await synthesize(f);
      expect(await accruals(f, job.id)).toEqual([
        {
          amount: 285,
          status: "Planned",
          debitAccountId: f.account("contract-assets"),
          creditAccountId: f.account("service-revenue"),
          periodStart: "2026-10-01",
          periodEnd: PERIOD_END,
          scheduledDate: PERIOD_END
        }
      ]);

      // The same period again: nothing new.
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285]);

      // One more hour: the next run accrues it.
      await f.addTime(job.id, { hours: 1 });
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285, 95]);

      // A running clock and a non-billable hour earn nothing.
      await f.addTime(job.id, { hours: 1, running: true });
      const unbilled = await f.addTime(job.id, { hours: 1 });
      await f.db
        .updateTable("serviceJobTime")
        .set({ billable: false })
        .where("id", "=", unbilled.id)
        .execute();
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285, 95]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a deleted hour reverses its accrual, and billable parts accrue at their price",
  async () => {
    const { f, locationId } = await fixture();
    try {
      const job = await addJob(f, { locationId, laborBillRate: 95 });
      await f.addTime(job.id, { hours: 2 });
      const hour = await f.addTime(job.id, { hours: 1 });
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285]);

      await f.db.deleteFrom("serviceJobTime").where("id", "=", hour.id).execute();
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285, -95]);

      await f.db
        .insertInto("serviceJobItem")
        .values([
          {
            serviceJobId: job.id,
            itemId: f.serviceItemId,
            lineType: "Charge",
            quantity: 2,
            unitPrice: 12.5,
            createdAt: CREATED_AT,
            companyId: f.companyId,
            createdBy: "system"
          },
          {
            serviceJobId: job.id,
            itemId: f.serviceItemId,
            lineType: "Charge",
            quantity: 1,
            unitPrice: 40,
            billable: false,
            createdAt: CREATED_AT,
            companyId: f.companyId,
            createdBy: "system"
          }
        ])
        .execute();
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([285, -95, 25]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Fixed Price job accrues by hours over the accepted estimate's labor hours, and all of its price once completed",
  async () => {
    const { f, locationId } = await fixture();
    try {
      const job = await addJob(f, {
        locationId,
        billingMethod: "Fixed Price",
        estimateStatus: "Accepted"
      });
      await f.db
        .updateTable("serviceJob")
        .set({ fixedPrice: 1000 })
        .where("id", "=", job.id)
        .execute();
      await f.db
        .insertInto("serviceJobEstimateLine")
        .values([
          {
            serviceJobId: job.id,
            itemId: null,
            quantity: 10,
            unitPrice: 95,
            companyId: f.companyId,
            createdBy: "system"
          },
          {
            // A part line: not labor hours.
            serviceJobId: job.id,
            itemId: f.serviceItemId,
            quantity: 5,
            unitPrice: 10,
            companyId: f.companyId,
            createdBy: "system"
          }
        ])
        .execute();
      await f.addTime(job.id, { hours: 4 });
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([400]);

      // No labor hours on the estimate: nothing until it completes.
      const unestimated = await addJob(f, {
        locationId,
        billingMethod: "Fixed Price"
      });
      await f.db
        .updateTable("serviceJob")
        .set({ fixedPrice: 600 })
        .where("id", "=", unestimated.id)
        .execute();
      await f.addTime(unestimated.id, { hours: 2 });
      await synthesize(f);
      expect(await amounts(f, unestimated.id)).toEqual([]);

      await f.db
        .updateTable("serviceJob")
        .set({ status: "Completed", completedAt: "2026-10-15T12:00:00Z" })
        .where("id", "in", [job.id, unestimated.id])
        .execute();
      await synthesize(f);
      expect(await amounts(f, job.id)).toEqual([400, 600]);
      expect(await amounts(f, unestimated.id)).toEqual([600]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Warranty job and a job with a posted invoice accrue nothing; a job that leaves Billable reverses its accruals",
  async () => {
    const { f, locationId } = await fixture();
    try {
      const warranty = await addJob(f, {
        locationId,
        coverage: "Warranty",
        laborBillRate: 95
      });
      await f.addTime(warranty.id, { hours: 3 });

      const invoiced = await addJob(f, {
        locationId,
        status: "Invoiced",
        laborBillRate: 95
      });
      await f.addTime(invoiced.id, { hours: 3 });
      const invoiceId = `${f.prefix}-service-invoice`;
      await f.db
        .insertInto("salesInvoice")
        .values({
          id: invoiceId,
          invoiceId: `INV-${f.prefix}`,
          customerId: f.customerId,
          currencyCode: "USD",
          exchangeRate: 1,
          status: "Submitted",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .updateTable("serviceJob")
        .set({ salesInvoiceId: invoiceId })
        .where("id", "=", invoiced.id)
        .execute();

      const switched = await addJob(f, { locationId, laborBillRate: 95 });
      await f.addTime(switched.id, { hours: 1 });

      try {
        await synthesize(f);
        expect(await amounts(f, warranty.id)).toEqual([]);
        expect(await amounts(f, invoiced.id)).toEqual([]);
        expect(await amounts(f, switched.id)).toEqual([95]);

        await f.db
          .updateTable("serviceJob")
          .set({ coverage: "Warranty" })
          .where("id", "=", switched.id)
          .execute();
        await synthesize(f);
        expect(await amounts(f, switched.id)).toEqual([95, -95]);
      } finally {
        // A posted invoice refuses the company's delete.
        await f.db
          .updateTable("salesInvoice")
          .set({ status: "Draft" })
          .where("id", "=", invoiceId)
          .execute();
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with no Contract Assets default the run refuses, naming it",
  async () => {
    const { f, locationId } = await fixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ contractAssetAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const job = await addJob(f, { locationId, laborBillRate: 95 });
      await f.addTime(job.id, { hours: 1 });
      await expect(synthesize(f)).rejects.toThrow(
        SERVICE_REVENUE_CONTRACT_ASSETS_MISSING
      );

      // With nothing to accrue it needs no account.
      await f.db.deleteFrom("serviceJobTime").where("serviceJobId", "=", job.id).execute();
      await expect(synthesize(f)).resolves.toBeUndefined();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "with no Service Revenue default the accrual credits the sales account",
  async () => {
    const { f, locationId } = await fixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ serviceRevenueAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      const job = await addJob(f, { locationId, laborBillRate: 95 });
      await f.addTime(job.id, { hours: 1 });
      await synthesize(f);
      const [row] = await accruals(f, job.id);
      expect(row?.creditAccountId).toBe(f.account("misc"));
    } finally {
      await f.cleanup();
    }
  }
);
