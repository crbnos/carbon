// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Receiving an outside processing purchase order is how its job operation
// records the units the supplier finished: nobody records production for it.
// The supplier's cost is the job's cost: the receipt debits WIP under the
// receipt's own id, and the job's completion and close must still count it.
// Runs against the local database (SUPABASE_DB_URL); skipped without one.
import { sql } from "kysely";
import { expect } from "vitest";
import { postAssetTransfer } from "../../../app/modules/accounting/accounting.service";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import { closeJob } from "../../../app/modules/production/production.service";
import {
  invokeCreate,
  invokePosting
} from "../../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap
} from "../fixtures/always-post";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";

/** A job for 10 whose first operation is sent out on a purchase order for 10
 *  at `unitPrice` (5) each. The job has no material, so the supplier's 50 is
 *  its whole cost. `thenInHouse` adds an operation of our own after the
 *  outside one. `key` keeps two orders of one fixture apart. */
async function outsideProcessingOrder(
  f: Fixture,
  {
    key = "outside",
    unitPrice = 5,
    thenInHouse = false
  }: { key?: string; unitPrice?: number; thenInHouse?: boolean } = {}
) {
  const job = await jobFixture(f, key);
  const purchaseOrderId = `${f.prefix}-po-${key}`;
  await seed(f, async (trx) => {
    await trx
      .deleteFrom("jobMaterial")
      .where("id", "=", job.materialId)
      .where("companyId", "=", f.companyId)
      .execute();
    if (thenInHouse) {
      const outside = await trx
        .selectFrom("jobOperation")
        .select(["jobMakeMethodId", "processId"])
        .where("id", "=", job.operationId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("jobOperation")
        .values({
          jobId: job.jobId,
          jobMakeMethodId: outside.jobMakeMethodId,
          processId: outside.processId,
          description: "Inspect",
          order: 2,
          operationQuantity: 10,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }
    await trx
      .updateTable("job")
      .set({ quantity: 10, status: "In Progress" })
      .where("id", "=", job.jobId)
      .execute();
    await trx
      .updateTable("jobOperation")
      .set({
        operationType: "Outside Processing",
        operationQuantity: 10,
        status: "In Progress"
      })
      .where("id", "=", job.operationId)
      .execute();
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: `PO-${key}`,
        purchaseOrderType: "Outside Processing",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        jobId: job.jobId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "To Receive and Invoice",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("purchaseOrderDelivery")
      .values({
        id: purchaseOrderId,
        locationId: f.locationId,
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.assemblyId,
        purchaseQuantity: 10,
        supplierUnitPrice: unitPrice,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        jobId: job.jobId,
        jobOperationId: job.operationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return { ...job, purchaseOrderId };
}

async function receive(f: Fixture, purchaseOrderId: string, quantity: number) {
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  await seed(f, (trx) =>
    trx
      .updateTable("receiptLine")
      .set({ receivedQuantity: quantity })
      .where("receiptId", "=", receipt.id)
      .where("companyId", "=", f.companyId)
      .execute()
  );
  unwrap(
    await invokePosting(
      handlesOf(f.ctx),
      "post-receipt",
      { type: "post", receiptId: receipt.id },
      postReceipt
    )
  );
}

function operation(f: Fixture, operationId: string) {
  return f.db
    .selectFrom("jobOperation")
    .select(["status", "quantityComplete"])
    .where("id", "=", operationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

/** The job's status and the units its completion received to stock. */
async function jobReceived(f: Fixture, jobId: string) {
  const job = await f.db
    .selectFrom("job")
    .select("status")
    .where("id", "=", jobId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  const receipts = await f.db
    .selectFrom("itemLedger")
    .select("quantity")
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", jobId)
    .execute();
  return {
    status: job.status,
    received: receipts.reduce((sum, row) => sum + row.quantity, 0)
  };
}

/** The WIP account's balance in the fixture's company: with one job, that
 *  job's cost still in WIP, read from the ledger and not from the function
 *  the completion and the close use. */
async function wipAccount(f: Fixture) {
  const row = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.sum<number>("amount").as("balance"))
    .where("companyId", "=", f.companyId)
    .where("accountId", "=", f.account("wip"))
    .executeTakeFirstOrThrow();
  return row.balance ?? 0;
}

/** What the job's completion moved to finished goods: its Job Receipt
 *  journal lines, debit first, and its output cost layers. */
async function finishedGoods(f: Fixture, jobId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", jobId)
    .orderBy("amount", "desc")
    .execute();
  const layers = await f.db
    .selectFrom("costLedger")
    .select(["quantity", "cost"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Job Receipt")
    .where("documentId", "=", jobId)
    .where("itemLedgerType", "=", "Output")
    .execute();
  return {
    journal: lines.map((line) => [line.accountId, line.amount]),
    layers
  };
}

/** 10 finished units carrying the supplier's 50 (10 at 5). */
const allTenAtFifty = (f: Fixture) => ({
  journal: [
    [f.account("finished-goods"), 50],
    [f.account("wip"), -50]
  ],
  layers: [{ quantity: 10, cost: 50 }]
});

/** Completes the job by hand (10 by default), as the Complete dialog does. */
async function completeJob(f: Fixture, jobId: string, quantity = 10) {
  await sql`
    SELECT complete_job_to_inventory(
      ${jobId}, ${quantity}, NULL, ${f.locationId}, ${f.companyId}, ${USER}
    )
  `.execute(f.db);
}

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

async function assetUnderConstruction(f: Fixture) {
  const classId = `${f.prefix}-cip-class`;
  const assetId = `${f.prefix}-cip-asset`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("sequence")
      .values({
        table: "fixedAssetTransfer",
        name: "Fixed Asset Transfer",
        prefix: "FAT",
        companyId: f.companyId
      })
      .execute();
    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: classId,
        name: "Construction in Progress",
        isConstructionInProgress: true,
        assetAccountId: f.account("filler"),
        accumulatedDepreciationAccountId: f.account("filler"),
        depreciationExpenseAccountId: f.account("filler"),
        lossOnDisposalAccountId: f.account("filler"),
        gainOnDisposalAccountId: f.account("filler"),
        writeOffAccountId: f.account("filler"),
        writeDownAccountId: f.account("filler"),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("fixedAsset")
      .values({
        id: assetId,
        fixedAssetId: "FA-CIP",
        name: "Test cell",
        fixedAssetClassId: classId,
        status: "Under Construction",
        acquisitionCost: 0,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return assetId;
}

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
