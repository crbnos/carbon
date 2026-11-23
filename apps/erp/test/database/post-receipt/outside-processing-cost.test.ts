// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The supplier's cost of an outside processing order is the job's cost: it
// reaches finished goods at completion, the asset at attachment, or the
// variance at close.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { sql } from "kysely";
import { expect } from "vitest";
import { postAssetTransfer } from "../../../app/modules/accounting/accounting.service";
import { closeJob } from "../../../app/modules/production/production.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  seed,
  stockPart,
  unwrap
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";
import {
  allTenAtFifty,
  assetUnderConstruction,
  completeJob,
  finishedGoods,
  operation,
  outsideProcessingOrder,
  receive,
  wipAccount
} from "../fixtures/outside-processing";

databaseTest(
  "a job's cost takes only its own outside processing receipts",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Two jobs, each with our own operation still open: 50 and 30 in WIP.
      const first = await outsideProcessingOrder(f, {
        key: "first",
        thenInHouse: true
      });
      const second = await outsideProcessingOrder(f, {
        key: "second",
        unitPrice: 3,
        thenInHouse: true
      });
      await receive(f, first.purchaseOrderId, 10);
      await receive(f, second.purchaseOrderId, 10);

      const jobWip = async (jobId: string) => {
        const { rows } = await sql<{ balance: number }>`
          SELECT job_wip_balance(${jobId}, ${f.companyId}) AS balance
        `.execute(f.db);
        return rows[0]!.balance;
      };
      expect(await jobWip(first.jobId)).toBe(50);
      expect(await jobWip(second.jobId)).toBe(30);

      await completeJob(f, first.jobId);

      expect(await finishedGoods(f, first.jobId)).toEqual(allTenAtFifty(f));
      // The second job's 30 is still in WIP.
      expect(await wipAccount(f)).toBe(30);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an outside operation in the middle of the routing is costed when the job completes later",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });

      await receive(f, order.purchaseOrderId, 10);
      // Our own operation is still open: the supplier's 50 waits in WIP.
      expect(await finishedGoods(f, order.jobId)).toEqual({
        journal: [],
        layers: []
      });
      expect(await wipAccount(f)).toBe(50);

      await completeJob(f, order.jobId);

      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "closing a job writes off an outside processing receipt posted after it completed",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);

      // Completed before the supplier's parts were received: nothing to cost.
      await completeJob(f, order.jobId);
      await receive(f, order.purchaseOrderId, 10);
      expect(await wipAccount(f)).toBe(50);

      await closeJob(f.service, { jobId: order.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", order.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(variance.map((line) => [line.accountId, line.amount])).toEqual([
        [f.account("filler"), 50],
        [f.account("wip"), -50]
      ]);
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "attaching a job to an asset under construction sweeps its outside processing cost",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      const assetId = await assetUnderConstruction(f);
      await receive(f, order.purchaseOrderId, 10);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-asset-transfer",
          { type: "attachJob", fixedAssetId: assetId, jobId: order.jobId },
          postAssetTransfer
        )
      );

      const asset = await f.db
        .selectFrom("fixedAsset")
        .select("acquisitionCost")
        .where("id", "=", assetId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(asset.acquisitionCost).toBe(50);
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a negative outside processing receipt takes its cost back out of the job",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);

      await receive(f, order.purchaseOrderId, 4);
      expect(await wipAccount(f)).toBe(20);
      // The 4 go back to the supplier: the job holds no cost again.
      await receive(f, order.purchaseOrderId, -4);
      expect(await wipAccount(f)).toBe(0);

      // All 10 then come in: finished goods carry 50, not 50 plus the 20.
      await receive(f, order.purchaseOrderId, 10);
      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a receipt is still the job's cost after its operation is deleted",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      await receive(f, order.purchaseOrderId, 10);
      // What the operation's delete leaves (ON DELETE SET NULL): the line
      // keeps its job and loses its operation.
      await seed(f, (trx) =>
        trx
          .updateTable("purchaseOrderLine")
          .set({ jobOperationId: null })
          .where("purchaseOrderId", "=", order.purchaseOrderId)
          .where("companyId", "=", f.companyId)
          .execute()
      );

      await completeJob(f, order.jobId);

      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a receipt returned after a partial completion stays in WIP when the job completes",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f, { thenInHouse: true });
      await receive(f, order.purchaseOrderId, 6);
      await completeJob(f, order.jobId, 5);
      const thirty = {
        journal: [
          [f.account("finished-goods"), 30],
          [f.account("wip"), -30]
        ],
        layers: [{ quantity: 5, cost: 30 }]
      };
      expect(await finishedGoods(f, order.jobId)).toEqual(thirty);

      // 4 go back to the supplier: WIP is 20 below zero.
      await receive(f, order.purchaseOrderId, -4);
      expect(await wipAccount(f)).toBe(-20);

      await completeJob(f, order.jobId);

      // The last 5 are not charged 20 more; the close settles the 20.
      expect(await finishedGoods(f, order.jobId)).toEqual(thirty);
      expect(await wipAccount(f)).toBe(-20);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a job's material and its outside processing both reach finished goods",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // The job's 2 parts at 10 backflush at completion: 20 of its own.
      await stockPart(f, 2);
      const order = await outsideProcessingOrder(f, { keepMaterial: true });

      await receive(f, order.purchaseOrderId, 10);

      expect(await finishedGoods(f, order.jobId)).toEqual({
        journal: [
          [f.account("finished-goods"), 70],
          [f.account("wip"), -70]
        ],
        layers: [{ quantity: 10, cost: 70 }]
      });
      expect(await wipAccount(f)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
