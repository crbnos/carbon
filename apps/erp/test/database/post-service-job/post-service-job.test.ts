// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import { SERVICE_JOB_UNIT_LEFT_ERROR } from "../../../app/modules/service/service.service";
import { databaseTest } from "../fixtures/local-database";
import { PROJECT_TEST_USER } from "../fixtures/project-posting";
import { serviceJobFixture } from "../fixtures/service-job";

/** The ids of the job's 'Service Job' journals. */
async function serviceJobJournals(
  f: Awaited<ReturnType<typeof serviceJobFixture>>,
  serviceJobId: string
) {
  const rows = await f.db
    .selectFrom("journalLine")
    .select("journalId")
    .distinct()
    .where("documentType", "=", "Service Job")
    .where("documentId", "=", serviceJobId)
    .execute();
  return rows.map((row) => row.journalId);
}

databaseTest(
  "completing a job posts only the time not yet posted, and reopening posts nothing",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });
      await f.addTime(job.id, { hours: 1 });
      const posted = await f.postServiceJob({
        action: "post-time",
        serviceJobId: job.id
      });
      expect(posted.error).toBeNull();
      expect(await serviceJobJournals(f, job.id)).toHaveLength(1);

      // An entry whose post-after-write failed: Complete catches it up.
      await f.addTime(job.id, { hours: 0.5 });
      const completed = await f.postServiceJob({
        action: "complete",
        serviceJobId: job.id,
        signedByName: "Pat Customer"
      });
      expect(completed.error).toBeNull();
      const journalId = completed.data?.journalId as string;
      expect(await f.journalLines(journalId)).toEqual([
        [f.account("cost-of-service"), 20],
        [f.account("labor-absorption"), -20]
      ]);
      const journal = await f.db
        .selectFrom("journal")
        .select(["sourceType", "status"])
        .where("id", "=", journalId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({ sourceType: "Service Job", status: "Posted" });
      expect(await serviceJobJournals(f, job.id)).toHaveLength(2);

      const header = await f.db
        .selectFrom("serviceJob")
        .select(["status", "signedByName"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({
        status: "Completed",
        signedByName: "Pat Customer"
      });

      const reopened = await f.postServiceJob({
        action: "reopen",
        serviceJobId: job.id
      });
      expect(reopened.error).toBeNull();
      expect(reopened.data?.journalId).toBeNull();
      expect(await serviceJobJournals(f, job.id)).toHaveLength(2);
      const after = await f.db
        .selectFrom("serviceJob")
        .select(["status", "completedAt"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({ status: "In Progress", completedAt: null });
      // Each entry keeps the rate it posted at.
      const costed = await f.db
        .selectFrom("serviceJobTime")
        .select(["unitCost"])
        .where("serviceJobId", "=", job.id)
        .execute();
      expect(costed.map((row) => Number(row.unitCost))).toEqual([40, 40]);

      // Completing again with nothing new writes no journal.
      const again = await f.postServiceJob({
        action: "complete",
        serviceJobId: job.id
      });
      expect(again.error).toBeNull();
      expect(again.data?.journalId).toBeNull();
      expect(await serviceJobJournals(f, job.id)).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Warranty job posts its time to warranty", async () => {
  const f = await serviceJobFixture();
  try {
    const { locationId } = await f.addStockedItem("unit", {
      quantity: 1,
      unitCost: 10
    });
    const job = await f.addJob({ locationId, coverage: "Warranty" });
    await f.addTime(job.id, { hours: 2 });

    const completed = await f.postServiceJob({
      action: "complete",
      serviceJobId: job.id
    });
    expect(completed.error).toBeNull();
    expect(
      await f.journalLines(completed.data?.journalId as string)
    ).toEqual([
      [f.account("warranty"), 80],
      [f.account("labor-absorption"), -80]
    ]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a job that becomes Billable bills the time logged under Warranty",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("pump", {
        quantity: 1,
        unitCost: 70
      });
      const job = await f.addJob({ locationId, coverage: "Warranty" });
      const time = await f.addTime(job.id, { hours: 3 });
      await f.db
        .updateTable("serviceJobTime")
        .set({ billable: false })
        .where("id", "=", time.id)
        .execute();

      const changed = await f.postServiceJob({
        action: "set-coverage",
        serviceJobId: job.id,
        coverage: "Billable"
      });
      expect(changed.error).toBeNull();

      const row = await f.db
        .selectFrom("serviceJobTime")
        .select("billable")
        .where("id", "=", time.id)
        .executeTakeFirstOrThrow();
      expect(row.billable).toBe(true);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a coverage change reclasses the parts already issued",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("pump", {
        quantity: 5,
        unitCost: 70
      });
      const job = await f.addJob({ locationId, coverage: "Warranty" });
      const issued = await f.issue({
        type: "serviceJobInventory",
        serviceJobId: job.id,
        itemId,
        unitOfMeasureCode: "EA",
        quantity: 1
      });
      expect(issued.error).toBeNull();

      const changed = await f.postServiceJob({
        action: "set-coverage",
        serviceJobId: job.id,
        coverage: "Billable"
      });
      expect(changed.error).toBeNull();
      expect(await f.journalLines(changed.data?.journalId as string)).toEqual(
        [
          [f.account("cost-of-service"), 70],
          [f.account("warranty"), -70]
        ]
      );
      const header = await f.db
        .selectFrom("serviceJob")
        .select(["coverage"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(header.coverage).toBe("Billable");

      // Billable to Contract posts to the same account: no journal.
      const same = await f.postServiceJob({
        action: "set-coverage",
        serviceJobId: job.id,
        coverage: "Contract"
      });
      expect(same.error).toBeNull();
      expect(same.data?.journalId).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a coverage change moves the posted time to the new coverage account",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });
      await f.addTime(job.id, { hours: 1.5 });
      const posted = await f.postServiceJob({
        action: "post-time",
        serviceJobId: job.id
      });
      expect(posted.error).toBeNull();

      const changed = await f.postServiceJob({
        action: "set-coverage",
        serviceJobId: job.id,
        coverage: "Warranty"
      });
      expect(changed.error).toBeNull();
      expect(await f.journalLines(changed.data?.journalId as string)).toEqual(
        [
          [f.account("warranty"), 60],
          [f.account("cost-of-service"), -60]
        ]
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job completes without an accepted estimate",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({
        locationId,
        coverage: "Billable",
        billingMethod: "Fixed Price",
        estimateStatus: "Sent"
      });
      await f.addTime(job.id, { hours: 1 });

      const completed = await f.postServiceJob({
        action: "complete",
        serviceJobId: job.id
      });
      expect(completed.error).toBeNull();
      const header = await f.db
        .selectFrom("serviceJob")
        .select(["status"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(header.status).toBe("Completed");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("completion refuses a running clock", async () => {
  const f = await serviceJobFixture();
  try {
    const { locationId } = await f.addStockedItem("unit", {
      quantity: 1,
      unitCost: 10
    });
    const job = await f.addJob({ locationId });
    await f.addTime(job.id, { hours: 0, running: true });

    const running = await f.postServiceJob({
      action: "complete",
      serviceJobId: job.id
    });
    expect(running.error?.message).toBe("Stop the running clock first.");
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "completing a job from an RMA line moves the RMA on once the unit is back",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const rmaStatus = async (salesReturnOrderId: string) =>
        (
          await f.db
            .selectFrom("salesReturnOrder")
            .select(["status"])
            .where("id", "=", salesReturnOrderId)
            .executeTakeFirstOrThrow()
        ).status;

      // Not shipped back yet: the RMA stays In Progress.
      const held = await f.addReturnLine({ itemId });
      const heldJob = await f.addJob({
        locationId,
        salesReturnOrderLineId: held.lineId,
        estimateStatus: "Accepted"
      });
      const first = await f.postServiceJob({
        action: "complete",
        serviceJobId: heldJob.id
      });
      expect(first.error).toBeNull();
      expect(await rmaStatus(held.salesReturnOrderId)).toBe("In Progress");

      // Shipped back: completing the job completes the RMA, and reopening
      // the job moves it back.
      const shipped = await f.addReturnLine({ itemId, quantityShipped: 1 });
      const shippedJob = await f.addJob({
        locationId,
        salesReturnOrderLineId: shipped.lineId,
        estimateStatus: "Accepted"
      });
      const second = await f.postServiceJob({
        action: "complete",
        serviceJobId: shippedJob.id
      });
      expect(second.error).toBeNull();
      expect(await rmaStatus(shipped.salesReturnOrderId)).toBe("Completed");

      // The unit went back to the customer: the job cannot reopen.
      const refused = await f.postServiceJob({
        action: "reopen",
        serviceJobId: shippedJob.id
      });
      expect(refused.error?.message).toBe(SERVICE_JOB_UNIT_LEFT_ERROR);
      expect(await rmaStatus(shipped.salesReturnOrderId)).toBe("Completed");

      // Still at the depot: reopening works and keeps the RMA In Progress.
      const reopened = await f.postServiceJob({
        action: "reopen",
        serviceJobId: heldJob.id
      });
      expect(reopened.error).toBeNull();
      expect(reopened.data?.journalId).toBeNull();
      expect(await rmaStatus(held.salesReturnOrderId)).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job whose RMA unit was scrapped or replaced cannot reopen",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });

      const scrapped = await f.addReturnLine({ itemId });
      await f.db
        .updateTable("salesReturnOrderLine")
        .set({ disposition: "Scrap" })
        .where("id", "=", scrapped.lineId)
        .execute();
      const scrappedJob = await f.addJob({
        locationId,
        status: "Completed",
        salesReturnOrderLineId: scrapped.lineId
      });
      const scrappedReopen = await f.postServiceJob({
        action: "reopen",
        serviceJobId: scrappedJob.id
      });
      expect(scrappedReopen.error?.message).toBe(SERVICE_JOB_UNIT_LEFT_ERROR);

      const replaced = await f.addReturnLine({ itemId });
      const salesOrderId = `${f.prefix}-replacement`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("salesOrder")
          .values({
            id: salesOrderId,
            salesOrderId,
            customerId: f.customerId,
            currencyCode: "USD",
            companyId: f.companyId,
            createdBy: PROJECT_TEST_USER
          })
          .execute();
        await trx
          .insertInto("salesOrderLine")
          .values({
            salesOrderId,
            salesOrderLineType: "Part",
            itemId,
            saleQuantity: 1,
            salesReturnOrderLineId: replaced.lineId,
            companyId: f.companyId,
            createdBy: PROJECT_TEST_USER
          })
          .execute();
      });
      const replacedJob = await f.addJob({
        locationId,
        status: "Completed",
        salesReturnOrderLineId: replaced.lineId
      });
      const replacedReopen = await f.postServiceJob({
        action: "reopen",
        serviceJobId: replacedJob.id
      });
      expect(replacedReopen.error?.message).toBe(SERVICE_JOB_UNIT_LEFT_ERROR);
    } finally {
      await f.cleanup();
    }
  }
);
