// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An outside processing order for a job, its receipts, and what they leave
// in the ledger. Shared by the post-receipt/outside-processing-*.test.ts files.
import { sql } from "kysely";
import { postReceipt } from "../../../app/modules/inventory/inventory.service";
import { invokeCreate, invokePosting } from "../../../app/modules/shared/shared.service";
import {
  type Fixture,
  jobFixture,
  seed,
  USER,
  unwrap
} from "./always-post";
import { handlesOf } from "./handles";

/** A job for 10 whose first operation is sent out on a purchase order for 10
 *  at `unitPrice` (5) each. The job has no material, so the supplier's 50 is
 *  its whole cost; `keepMaterial` keeps the fixture's 2 parts (at 10 each).
 *  `thenInHouse` adds an operation of our own after the outside one.
 *  `lines` splits the 10 over purchase order lines for the one operation.
 *  `key` keeps two orders of one fixture apart. */
export async function outsideProcessingOrder(
  f: Fixture,
  {
    key = "outside",
    unitPrice = 5,
    thenInHouse = false,
    keepMaterial = false,
    lines = [10]
  }: {
    key?: string;
    unitPrice?: number;
    thenInHouse?: boolean;
    keepMaterial?: boolean;
    lines?: number[];
  } = {}
) {
  const job = await jobFixture(f, key);
  const purchaseOrderId = `${f.prefix}-po-${key}`;
  const lineIds = lines.map((_, index) => `${f.prefix}-pol-${key}-${index}`);
  await seed(f, async (trx) => {
    if (!keepMaterial) {
      await trx
        .deleteFrom("jobMaterial")
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();
    }
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
      .values(
        lines.map((purchaseQuantity, index) => ({
          id: lineIds[index],
          purchaseOrderId,
          purchaseOrderLineType: "Part" as const,
          itemId: f.assemblyId,
          purchaseQuantity,
          supplierUnitPrice: unitPrice,
          exchangeRate: 1,
          conversionFactor: 1,
          inventoryUnitOfMeasureCode: "EA",
          locationId: f.locationId,
          jobId: job.jobId,
          jobOperationId: job.operationId,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
  });
  return { ...job, purchaseOrderId, lineIds };
}

/** Posts a receipt of the order: `quantity` on every line, or one quantity
 *  per purchase order line id. Returns the receipt's id. */
export async function receive(
  f: Fixture,
  purchaseOrderId: string,
  quantity: number | Record<string, number>
) {
  const receipt = await draftReceipt(f, purchaseOrderId, quantity);
  await postReceiptOf(f, receipt);
  return receipt;
}

export async function draftReceipt(
  f: Fixture,
  purchaseOrderId: string,
  quantity: number | Record<string, number>
) {
  const receipt = unwrap(
    await invokeCreate(handlesOf(f.ctx), {
      type: "receiptFromPurchaseOrder",
      purchaseOrderId,
      locationId: f.locationId
    })
  );
  await seed(f, async (trx) => {
    const byLine =
      typeof quantity === "number" ? null : Object.entries(quantity);
    for (const [lineId, received] of byLine ?? [[null, quantity as number]]) {
      let update = trx
        .updateTable("receiptLine")
        .set({ receivedQuantity: received as number })
        .where("receiptId", "=", receipt.id)
        .where("companyId", "=", f.companyId);
      if (lineId) update = update.where("lineId", "=", lineId);
      await update.execute();
    }
  });
  return receipt.id;
}

export function postReceiptOf(
  f: Fixture,
  receiptId: string,
  type: "post" | "void" = "post"
) {
  return invokePosting(
    handlesOf(f.ctx),
    "post-receipt",
    { type, receiptId },
    postReceipt
  ).then(unwrap);
}

export function operation(f: Fixture, operationId: string) {
  return f.db
    .selectFrom("jobOperation")
    .select(["status", "quantityComplete"])
    .where("id", "=", operationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
}

/** The job's status and the units its completion received to stock. */
export async function jobReceived(f: Fixture, jobId: string) {
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
export async function wipAccount(f: Fixture) {
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
export async function finishedGoods(f: Fixture, jobId: string) {
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
export const allTenAtFifty = (f: Fixture) => ({
  journal: [
    [f.account("finished-goods"), 50],
    [f.account("wip"), -50]
  ],
  layers: [{ quantity: 10, cost: 50 }]
});

/** Completes the job by hand (10 by default), as the Complete dialog does. */
export async function completeJob(f: Fixture, jobId: string, quantity = 10) {
  await sql`
    SELECT complete_job_to_inventory(
      ${jobId}, ${quantity}, NULL, ${f.locationId}, ${f.companyId}, ${USER}
    )
  `.execute(f.db);
}

export async function assetUnderConstruction(f: Fixture) {
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
