// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Receiving an outside processing purchase order is how its job operation
// records the units the supplier finished: nobody records production for it.
// Before, the receipt set the operation Done and left quantityComplete at 0.
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
 *  at 5 each. The job has no material, so the supplier's 50 is its whole
 *  cost. `thenInHouse` adds an operation of our own after the outside one. */
async function outsideProcessingOrder(
  f: Fixture,
  { thenInHouse = false }: { thenInHouse?: boolean } = {}
) {
  const job = await jobFixture(f, "outside");
  const purchaseOrderId = `${f.prefix}-po-outside`;
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
        purchaseOrderId: "PO-OUTSIDE",
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
        supplierUnitPrice: 5,
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

/** Receives `quantity` of the order's one line. */
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

async function operation(f: Fixture, operationId: string) {
  const row = await f.db
    .selectFrom("jobOperation")
    .select(["status", "quantityComplete"])
    .where("id", "=", operationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return { status: row.status, quantityComplete: Number(row.quantityComplete) };
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
    received: receipts.reduce((sum, row) => sum + Number(row.quantity), 0)
  };
}

/** What is still in WIP for the job. */
async function wipBalance(f: Fixture, jobId: string) {
  const { rows } = await sql<{ balance: number }>`
    SELECT job_wip_balance(${jobId}, ${f.companyId}) AS balance
  `.execute(f.db);
  return Number(rows[0]!.balance);
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
    journal: lines.map((line) => [line.accountId, Number(line.amount)]),
    layers: layers.map((layer) => ({
      quantity: Number(layer.quantity),
      cost: Number(layer.cost)
    }))
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

/** Completes the job for 10 by hand, as the Complete dialog does. */
async function completeJob(f: Fixture, jobId: string) {
  await sql`
    SELECT complete_job_to_inventory(
      ${jobId}, 10, NULL, ${f.locationId}, ${f.companyId}, ${USER}
    )
  `.execute(f.db);
}

databaseTest(
  "a receipt that finishes the job's last operation puts the supplier's cost in finished goods",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const order = await outsideProcessingOrder(f);

      await receive(f, order.purchaseOrderId, 10);

      expect(await jobReceived(f, order.jobId)).toEqual({
        status: "Completed",
        received: 10
      });
      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipBalance(f, order.jobId)).toBe(0);
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
      expect(await wipBalance(f, order.jobId)).toBe(50);

      await completeJob(f, order.jobId);

      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipBalance(f, order.jobId)).toBe(0);
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
      expect(await wipBalance(f, order.jobId)).toBe(50);

      await closeJob(f.service, { jobId: order.jobId });

      const variance = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Close")
        .where("documentId", "=", order.jobId)
        .orderBy("amount", "desc")
        .execute();
      expect(
        variance.map((line) => [line.accountId, Number(line.amount)])
      ).toEqual([
        [f.account("filler"), 50],
        [f.account("wip"), -50]
      ]);
      expect(await wipBalance(f, order.jobId)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

/** An asset under construction, in a Construction in Progress class. */
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
      expect(Number(asset.acquisitionCost)).toBe(50);
      expect(await wipBalance(f, order.jobId)).toBe(0);
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
      expect(await wipBalance(f, order.jobId)).toBe(20);
      // The 4 go back to the supplier: the job holds no cost again.
      await receive(f, order.purchaseOrderId, -4);
      expect(await wipBalance(f, order.jobId)).toBe(0);

      // All 10 then come in: finished goods carry 50, not 50 plus the 20.
      await receive(f, order.purchaseOrderId, 10);
      expect(await finishedGoods(f, order.jobId)).toEqual(allTenAtFifty(f));
      expect(await wipBalance(f, order.jobId)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "receiving an outside processing order completes the operation by what was received, across receipts",
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
      expect(await wipBalance(f, order.jobId)).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
