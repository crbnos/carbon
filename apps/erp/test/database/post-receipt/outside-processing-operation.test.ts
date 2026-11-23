// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Receiving an outside processing order is how its job operation records the
// units the supplier finished: nobody records production for it.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { expect } from "vitest";
import { alwaysPostFixture } from "../fixtures/always-post";
import { databaseTest } from "../fixtures/local-database";
import {
  allTenAtFifty,
  finishedGoods,
  jobReceived,
  operation,
  outsideProcessingOrder,
  postReceiptOf,
  receive,
  wipAccount
} from "../fixtures/outside-processing";

databaseTest(
  "an outside processing order received in parts completes the operation by what was received and costs the job from every receipt",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);

      await receive(f, order.purchaseOrderId, 4);
      expect(await operation(f, order.operationId)).toEqual({
        status: "In Progress",
        quantityComplete: 4
      });

      await receive(f, order.purchaseOrderId, 6);
      expect(await operation(f, order.operationId)).toEqual({
        status: "Done",
        quantityComplete: 10
      });
      // The operation was the job's last, so its Done completed the job with
      // what the operation finished, not what it had before this receipt.
      expect(await jobReceived(f, order.jobId)).toEqual({
        status: "Completed",
        received: 10
      });
      // Both receipts' cost (20, then 30) is in the finished goods.
      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an operation sent out on two purchase order lines completes by what both received",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { lines: [6, 4] });
      const [first, second] = order.lineIds as [string, string];

      // The first line is received complete; the operation still waits for
      // the other 4.
      await receive(f, order.purchaseOrderId, { [first]: 6, [second]: 0 });
      expect(await operation(f, order.operationId)).toEqual({
        status: "In Progress",
        quantityComplete: 6
      });
      expect(await jobReceived(f, order.jobId)).toEqual({
        status: "In Progress",
        received: 0
      });

      await receive(f, order.purchaseOrderId, { [second]: 4 });
      expect(await operation(f, order.operationId)).toEqual({
        status: "Done",
        quantityComplete: 10
      });
      expect(await jobReceived(f, order.jobId)).toEqual({
        status: "Completed",
        received: 10
      });
      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "voiding an outside processing receipt takes its units back off the operation",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const receiptId = await receive(f, order.purchaseOrderId, 10);
      expect(await operation(f, order.operationId)).toEqual({
        status: "Done",
        quantityComplete: 10
      });

      await postReceiptOf(f, receiptId, "void");

      expect(await operation(f, order.operationId)).toEqual({
        status: "In Progress",
        quantityComplete: 0
      });
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
