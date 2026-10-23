// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { serviceJobFixture } from "../fixtures/service-job";

databaseTest(
  "completing a job posts its time to Cost of Service, and reopening reverses it",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { locationId } = await f.addStockedItem("unit", {
        quantity: 1,
        unitCost: 10
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });
      await f.addTime(job.id, { hours: 1 });
      await f.addTime(job.id, { hours: 0.5 });

      const completed = await f.postServiceJob({
        action: "complete",
        serviceJobId: job.id,
        signedByName: "Pat Customer"
      });
      expect(completed.error).toBeNull();
      const journalId = completed.data?.journalId as string;
      expect(await f.journalLines(journalId)).toEqual([
        [f.account("cost-of-service"), 60],
        [f.account("labor-absorption"), -60]
      ]);

      const journal = await f.db
        .selectFrom("journal")
        .select(["sourceType", "status"])
        .where("id", "=", journalId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({ sourceType: "Service Job", status: "Posted" });
      const documents = await f.db
        .selectFrom("journalLine")
        .select(["documentType", "documentId"])
        .distinct()
        .where("journalId", "=", journalId)
        .execute();
      expect(documents).toEqual([
        { documentType: "Service Job", documentId: job.id }
      ]);

      const header = await f.db
        .selectFrom("serviceJob")
        .select(["status", "completionJournalId", "signedByName"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({
        status: "Completed",
        completionJournalId: journalId,
        signedByName: "Pat Customer"
      });
      const costed = await f.db
        .selectFrom("serviceJobTime")
        .select(["unitCost"])
        .where("serviceJobId", "=", job.id)
        .execute();
      expect(costed.map((row) => Number(row.unitCost))).toEqual([40, 40]);

      const reopened = await f.postServiceJob({
        action: "reopen",
        serviceJobId: job.id
      });
      expect(reopened.error).toBeNull();
      expect(
        await f.journalLines(reopened.data?.journalId as string)
      ).toEqual([
        [f.account("labor-absorption"), 60],
        [f.account("cost-of-service"), -60]
      ]);
      const after = await f.db
        .selectFrom("serviceJob")
        .select(["status", "completionJournalId", "completedAt"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(after).toEqual({
        status: "In Progress",
        completionJournalId: null,
        completedAt: null
      });
      const cleared = await f.db
        .selectFrom("serviceJobTime")
        .select(["unitCost"])
        .where("serviceJobId", "=", job.id)
        .execute();
      expect(cleared.map((row) => row.unitCost)).toEqual([null, null]);
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
  "a job that needs an accepted estimate cannot complete",
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
      expect(completed.error?.message).toBe(
        "This job needs an accepted estimate before it can be completed."
      );
      const header = await f.db
        .selectFrom("serviceJob")
        .select(["status"])
        .where("id", "=", job.id)
        .executeTakeFirstOrThrow();
      expect(header.status).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "completion refuses a running clock and a labor item with no cost",
  async () => {
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

      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 0 })
        .where("itemId", "=", f.laborItemId)
        .execute();
      const uncosted = await f.postServiceJob({
        action: "complete",
        serviceJobId: job.id
      });
      expect(uncosted.error?.message).toMatch(
        /The labor item .*-BENCH has no cost per hour/
      );
    } finally {
      await f.cleanup();
    }
  }
);

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

      const reopened = await f.postServiceJob({
        action: "reopen",
        serviceJobId: shippedJob.id
      });
      expect(reopened.error).toBeNull();
      expect(reopened.data?.journalId).toBeNull();
      expect(await rmaStatus(shipped.salesReturnOrderId)).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);
