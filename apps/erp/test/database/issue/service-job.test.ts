// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { serviceJobFixture } from "../fixtures/service-job";

type Fixture = Awaited<ReturnType<typeof serviceJobFixture>>;

/** The journal lines of the job's parts, as [account, amount], newest last. */
async function partLines(f: Fixture, serviceJobId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .innerJoin("journal", "journal.id", "journalLine.journalId")
    .select([
      "journalLine.accountId",
      "journalLine.amount",
      "journal.journalEntryId"
    ])
    .where("journalLine.companyId", "=", f.companyId)
    .where("journalLine.documentType", "=", "Service Job Consumption")
    .where("journalLine.documentId", "=", serviceJobId)
    .orderBy("journal.journalEntryId")
    .orderBy("journalLine.amount", "desc")
    .execute();
  return lines.map((line) => [line.accountId, Number(line.amount)]);
}

databaseTest(
  "a part issued to a Billable job costs Cost of Service and relieves inventory",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("gasket", {
        quantity: 5,
        unitCost: 70
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });

      const issued = await f.issue({
        type: "serviceJobInventory",
        serviceJobId: job.id,
        itemId,
        unitOfMeasureCode: "EA",
        quantity: 1
      });
      expect(issued.error).toBeNull();

      expect(await partLines(f, job.id)).toEqual([
        [f.account("cost-of-service"), 70],
        [f.account("inventory"), -70]
      ]);

      const part = await f.db
        .selectFrom("serviceJobItem")
        .select(["lineType", "quantity", "unitCost"])
        .where("serviceJobId", "=", job.id)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(part.lineType).toBe("Part");
      expect(Number(part.quantity)).toBe(1);
      expect(Number(part.unitCost)).toBe(70);

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["quantity", "documentType"])
        .where("documentId", "=", job.id)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(
        ledger.map((row) => [row.documentType, Number(row.quantity)])
      ).toEqual([["Service Job Consumption", -1]]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a part issued to a Warranty job costs warranty", async () => {
  const f = await serviceJobFixture();
  try {
    const { itemId, locationId } = await f.addStockedItem("seal", {
      quantity: 5,
      unitCost: 70
    });
    const job = await f.addJob({ locationId, coverage: "Warranty" });

    const issued = await f.issue({
      type: "serviceJobInventory",
      serviceJobId: job.id,
      itemId,
      unitOfMeasureCode: "EA",
      quantity: 2
    });
    expect(issued.error).toBeNull();

    expect(await partLines(f, job.id)).toEqual([
      [f.account("warranty"), 140],
      [f.account("inventory"), -140]
    ]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "returning a part reverses it at the issued cost and removes the line",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("valve", {
        quantity: 5,
        unitCost: 70
      });
      const job = await f.addJob({ locationId, coverage: "Billable" });

      const issued = await f.issue({
        type: "serviceJobInventory",
        serviceJobId: job.id,
        itemId,
        unitOfMeasureCode: "EA",
        quantity: 2
      });
      expect(issued.error).toBeNull();
      const serviceJobItemId = issued.data?.serviceJobItemId as string;

      // The item's cost moves before the return: the return still books at
      // what the job was charged.
      await f.db
        .updateTable("itemCost")
        .set({ unitCost: 999 })
        .where("itemId", "=", itemId)
        .execute();

      const partial = await f.issue({
        type: "serviceJobUnconsume",
        serviceJobItemId,
        quantity: 1
      });
      expect(partial.error).toBeNull();
      const line = await f.db
        .selectFrom("serviceJobItem")
        .select(["quantity"])
        .where("id", "=", serviceJobItemId)
        .executeTakeFirstOrThrow();
      expect(Number(line.quantity)).toBe(1);

      const rest = await f.issue({
        type: "serviceJobUnconsume",
        serviceJobItemId
      });
      expect(rest.error).toBeNull();

      expect(await partLines(f, job.id)).toEqual([
        [f.account("cost-of-service"), 140],
        [f.account("inventory"), -140],
        [f.account("inventory"), 70],
        [f.account("cost-of-service"), -70],
        [f.account("inventory"), 70],
        [f.account("cost-of-service"), -70]
      ]);
      const remaining = await f.db
        .selectFrom("serviceJobItem")
        .select(["id"])
        .where("serviceJobId", "=", job.id)
        .execute();
      expect(remaining).toEqual([]);

      const onHand = await f.db
        .selectFrom("itemLedger")
        .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
        .where("itemId", "=", itemId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(Number(onHand.quantity)).toBe(5);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest("a Completed job takes no parts", async () => {
  const f = await serviceJobFixture();
  try {
    const { itemId, locationId } = await f.addStockedItem("bolt", {
      quantity: 5,
      unitCost: 70
    });
    const job = await f.addJob({ locationId, status: "Completed" });

    const issued = await f.issue({
      type: "serviceJobInventory",
      serviceJobId: job.id,
      itemId,
      unitOfMeasureCode: "EA",
      quantity: 1
    });
    expect(issued.error?.message).toMatch(/This job is closed/);

    const parts = await f.db
      .selectFrom("serviceJobItem")
      .select(["id"])
      .where("serviceJobId", "=", job.id)
      .execute();
    expect(parts).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

databaseTest(
  "a serial part is issued by its serial and returned to Available",
  async () => {
    const f = await serviceJobFixture();
    try {
      const { itemId, locationId } = await f.addStockedItem("module", {
        quantity: 0,
        unitCost: 70
      });
      const trackedEntityId = `${f.prefix}-serial-1`;
      await f.db
        .updateTable("item")
        .set({ itemTrackingType: "Serial" })
        .where("id", "=", itemId)
        .execute();
      await f.db
        .insertInto("trackedEntity")
        .values({
          id: trackedEntityId,
          readableId: "SN-1",
          quantity: 1,
          sourceDocument: "Item",
          sourceDocumentId: itemId,
          itemId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .insertInto("itemLedger")
        .values({
          postingDate: "2026-01-01",
          entryType: "Positive Adjmt.",
          itemId,
          locationId,
          quantity: 1,
          trackedEntityId,
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      await f.db
        .insertInto("costLedger")
        .values({
          itemLedgerType: "Positive Adjmt.",
          costLedgerType: "Direct Cost",
          adjustment: false,
          itemId,
          quantity: 1,
          cost: 70,
          remainingQuantity: 1,
          trackedEntityId,
          postingDate: "2026-01-01",
          companyId: f.companyId
        })
        .execute();
      const job = await f.addJob({ locationId, coverage: "Billable" });

      const issued = await f.issue({
        type: "serviceJobTrackedEntities",
        serviceJobId: job.id,
        itemId,
        unitOfMeasureCode: "EA",
        children: [{ trackedEntityId, quantity: 1 }]
      });
      expect(issued.error).toBeNull();
      const serviceJobItemId = issued.data?.serviceJobItemId as string;
      const part = await f.db
        .selectFrom("serviceJobItem")
        .select(["unitCost"])
        .where("id", "=", serviceJobItemId)
        .executeTakeFirstOrThrow();
      expect(Number(part.unitCost)).toBe(70);

      const returned = await f.issue({
        type: "serviceJobUnconsume",
        serviceJobItemId
      });
      expect(returned.error).toBeNull();

      expect(await partLines(f, job.id)).toEqual([
        [f.account("cost-of-service"), 70],
        [f.account("inventory"), -70],
        [f.account("inventory"), 70],
        [f.account("cost-of-service"), -70]
      ]);
      const entity = await f.db
        .selectFrom("trackedEntity")
        .select(["status"])
        .where("id", "=", trackedEntityId)
        .executeTakeFirstOrThrow();
      expect(entity.status).toBe("Available");
    } finally {
      await f.cleanup();
    }
  }
);
