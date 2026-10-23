// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Receiving a Return for Service or Return for Warranty line: no stock, no
// value, one Open Depot service job per line. A Return to Stock line on the
// same receipt keeps its valued receipt. Voiding the receipt cancels a job
// with no work on it, and refuses one with work.

import { textToRichTextDoc } from "@carbon/utils";
import { expect } from "vitest";
import { invokeCreate } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import { serviceReturnFixture } from "../fixtures/service-return";

databaseTest(
  "a Return for Service line receives at no value and opens a Billable Depot job; the stock line keeps its value",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.stockItemId, returnType: "Return to Stock" },
        {
          itemId: f.unitItemId,
          returnType: "Return for Service",
          problem: "Leaks at the seal"
        }
      ]);
      const [stockLineId, serviceLineId] = lineIds as [string, string];

      const { receiptId, posted } = await f.receive(rmaId);
      expect(posted.error).toBeNull();

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select(["itemId", "quantity", "entryType"])
        .where("documentId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(ledger).toEqual([
        { itemId: f.stockItemId, quantity: 1, entryType: "Positive Adjmt." }
      ]);
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["itemId", "quantity", "cost"])
        .where("documentId", "=", receiptId)
        .where("companyId", "=", f.companyId)
        .execute();
      expect(layers).toEqual([
        { itemId: f.stockItemId, quantity: 1, cost: 25 }
      ]);
      expect(await f.documentJournalLines(receiptId)).toEqual([
        [f.account("inventory"), 25],
        [f.account("misc"), -25]
      ]);

      expect(await f.jobsOf(stockLineId)).toEqual([]);
      const jobs = await f.jobsOf(serviceLineId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        status: "Open",
        coverage: "Billable",
        workSite: "Depot",
        locationId: f.locationId,
        customerId: f.customerId,
        itemId: f.unitItemId,
        trackedEntityId: null,
        customerAssetId: null,
        // The RMA line's text, as the rich text the job holds.
        problem: textToRichTextDoc("Leaks at the seal")
      });

      expect(await f.returnLines(rmaId)).toEqual([
        { id: stockLineId, quantityReceived: 1, quantityShipped: 0 },
        { id: serviceLineId, quantityReceived: 1, quantityShipped: 0 }
      ]);
      expect(await f.rmaStatus(rmaId)).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a Return for Warranty serial opens a Warranty job, its asset goes At Depot, and the serial stays Consumed",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const serialId = await f.addSerial();
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.serialItemId, returnType: "Return for Warranty" }
      ]);
      const [lineId] = lineIds as [string];

      const { receiptId, posted } = await f.receive(rmaId, {
        [lineId]: serialId
      });
      expect(posted.error).toBeNull();

      const [job] = await f.jobsOf(lineId);
      expect(job).toMatchObject({
        status: "Open",
        coverage: "Warranty",
        workSite: "Depot",
        trackedEntityId: serialId
      });
      const asset = await f.db
        .selectFrom("customerAsset")
        .select(["id", "status", "customerId", "source"])
        .where("trackedEntityId", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(asset).toMatchObject({
        status: "At Depot",
        customerId: f.customerId,
        source: "Manual"
      });
      expect(job?.customerAssetId).toBe(asset.id);

      const serial = await f.db
        .selectFrom("trackedEntity")
        .select("status")
        .where("id", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(serial.status).toBe("Consumed");
      const activity = await f.db
        .selectFrom("trackedActivity")
        .innerJoin(
          "trackedActivityOutput",
          "trackedActivityOutput.trackedActivityId",
          "trackedActivity.id"
        )
        .select([
          "trackedActivity.type",
          "trackedActivity.attributes",
          "trackedActivityOutput.trackedEntityId"
        ])
        .where("trackedActivity.sourceDocumentId", "=", receiptId)
        .execute();
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        type: "Return Receipt",
        trackedEntityId: serialId,
        attributes: { "At Depot": true, "Service Job": job?.id }
      });

      const ledger = await f.db
        .selectFrom("itemLedger")
        .select("id")
        .where("documentId", "=", receiptId)
        .execute();
      expect(ledger).toEqual([]);
      expect(await f.documentJournalLines(receiptId)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding the receipt before any work cancels the job and returns the RMA to To Receive",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const serialId = await f.addSerial();
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.serialItemId, returnType: "Return for Service" }
      ]);
      const [lineId] = lineIds as [string];
      const { receiptId, posted } = await f.receive(rmaId, {
        [lineId]: serialId
      });
      expect(posted.error).toBeNull();

      const voided = await f.postReceipt("void", receiptId);
      expect(voided.error).toBeNull();

      const jobs = await f.jobsOf(lineId);
      expect(jobs.map((job) => job.status)).toEqual(["Cancelled"]);
      const asset = await f.db
        .selectFrom("customerAsset")
        .select("status")
        .where("trackedEntityId", "=", serialId)
        .executeTakeFirstOrThrow();
      expect(asset.status).toBe("In Service");
      expect(await f.returnLines(rmaId)).toEqual([
        { id: lineId, quantityReceived: 0, quantityShipped: 0 }
      ]);
      expect(await f.rmaStatus(rmaId)).toBe("To Receive");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding the receipt after time was logged on the job is refused",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.unitItemId, returnType: "Return for Service" }
      ]);
      const [lineId] = lineIds as [string];
      const { receiptId, posted } = await f.receive(rmaId);
      expect(posted.error).toBeNull();
      const [job] = await f.jobsOf(lineId);
      await f.addTime(job!.id, { hours: 1 });

      const voided = await f.postReceipt("void", receiptId);
      expect(voided.error?.message).toBe(
        `Service job ${job!.serviceJobId} has work on it. Cancel the job first.`
      );

      const [after] = await f.jobsOf(lineId);
      expect(after?.status).toBe("Open");
      const receipt = await f.db
        .selectFrom("receipt")
        .select("status")
        .where("id", "=", receiptId)
        .executeTakeFirstOrThrow();
      expect(receipt.status).toBe("Posted");
      expect(await f.rmaStatus(rmaId)).toBe("In Progress");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding a receipt leaves the job of a line it carried at 0 alone: another receipt opened it",
  async () => {
    const f = await serviceReturnFixture();
    try {
      const { rmaId, lineIds } = await f.addRma([
        { itemId: f.unitItemId, returnType: "Return for Service" },
        { itemId: f.unitItemId, returnType: "Return for Service" }
      ]);
      const [lineA, lineB] = lineIds as [string, string];
      const handles = handlesOf(f.ctx);
      const createReceipt = async () => {
        const created = await invokeCreate(handles, {
          type: "receiptFromSalesReturnOrder",
          salesReturnOrderId: rmaId,
          locationId: f.locationId
        });
        if (created.error) throw created.error;
        return created.data.id;
      };

      // R1 receives A, and carries B at 0.
      const first = await createReceipt();
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 0 })
        .where("receiptId", "=", first)
        .where("lineId", "=", lineB)
        .execute();
      expect((await f.postReceipt("post", first)).error).toBeNull();
      expect(await f.jobsOf(lineB)).toEqual([]);

      // R2 receives B.
      const second = await createReceipt();
      await f.db
        .updateTable("receiptLine")
        .set({ receivedQuantity: 0 })
        .where("receiptId", "=", second)
        .where("lineId", "=", lineA)
        .execute();
      expect((await f.postReceipt("post", second)).error).toBeNull();
      expect((await f.jobsOf(lineB)).map((job) => job.status)).toEqual([
        "Open"
      ]);

      // Voiding R1 cancels A's job only.
      expect((await f.postReceipt("void", first)).error).toBeNull();
      expect((await f.jobsOf(lineA)).map((job) => job.status)).toEqual([
        "Cancelled"
      ]);
      expect((await f.jobsOf(lineB)).map((job) => job.status)).toEqual([
        "Open"
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
