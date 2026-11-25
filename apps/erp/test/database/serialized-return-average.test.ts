// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql, TableNode } from "kysely";
import { expect } from "vitest";
import {
  assignReceiptReturnEntity,
  assignShipmentLineEntity
} from "../../app/modules/inventory/inventory.server";
import {
  issueMaterial,
  postInventoryAdjustment,
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  jobFixture,
  stampCutover,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import {
  createPackedShipment,
  postPackedShipment,
  shipPackedUnit
} from "./fixtures/packout-shipment";
import {
  createLinkedSerialReturn,
  packSerials,
  stockSerials
} from "./fixtures/serialized-sale";

async function valuation(f: Fixture, itemId: string) {
  const result = await sql`
    SELECT "quantityOnHand", "unitCost", "totalValue" FROM get_inventory_valuation(${f.companyId})
    WHERE "itemId" = ${itemId}
  `.execute(f.db);
  return result.rows;
}

function postedAmounts(f: Fixture, documentId: string, accountId: string) {
  return f.db
    .selectFrom("journalLine as l")
    .innerJoin("journal as j", "j.id", "l.journalId")
    .select("l.amount")
    .where("l.companyId", "=", f.companyId)
    .where("j.companyId", "=", f.companyId)
    .where("j.status", "=", "Posted")
    .where("l.documentId", "=", documentId)
    .where("l.accountId", "=", accountId)
    .orderBy("l.amount")
    .execute()
    .then((rows) => rows.map((row) => row.amount));
}

async function sellAndSelectReturn(
  f: Fixture,
  ctx: ReturnType<typeof operationContext>,
  itemId: string,
  unit: string,
  expectedCost: number
) {
  const original = await shipPackedUnit(f, itemId, unit);
  expect(
    await postedAmounts(f, original.shipmentId, f.account("cogs"))
  ).toEqual([expectedCost]);
  const line = await f.db
    .selectFrom("shipmentLine")
    .select("id")
    .where("companyId", "=", f.companyId)
    .where("shipmentId", "=", original.shipmentId)
    .executeTakeFirstOrThrow();
  const rma = await createLinkedSerialReturn(f, itemId, line.id);
  expect(
    (
      await assignReceiptReturnEntity(ctx, {
        receiptId: rma.receiptId,
        receiptLineId: rma.receiptLineId,
        trackedEntityId: unit,
        index: 0
      })
    ).error
  ).toBeNull();
  return rma;
}

for (const voidReturn of [false, true]) {
  postgrestTest(
    voidReturn
      ? "voiding an Average return removes the booked cost after an intervening job receipt"
      : "an Average linked return adds its original sale cost to intervening stock",
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const ctx = operationContext(f, client, USER);
        const fg = f.account("finished-goods");
        const cogs = f.account("cogs");
        let rma!: Awaited<ReturnType<typeof createLinkedSerialReturn>>;
        const receipt = async (type: "post" | "void") => {
          unwrap(
            await invokePosting(
              handlesOf(f.ctx),
              "post-receipt",
              { type, receiptId: rma.receiptId },
              postReceipt
            )
          );
        };
        const { itemId, outputs } = await packSerials(
          f,
          "Average",
          await stockSerials(f),
          async (item, unit) => {
            rma = await sellAndSelectReturn(f, ctx, item, unit, 40);
            if (voidReturn) await receipt("post");
          }
        );
        if (voidReturn) {
          expect(await valuation(f, itemId)).toEqual([
            { quantityOnHand: 2, unitCost: 31, totalValue: 62 }
          ]);
          await receipt("void");
        } else {
          expect(await valuation(f, itemId)).toEqual([
            { quantityOnHand: 1, unitCost: 22, totalValue: 22 }
          ]);
          await receipt("post");
          expect(
            (
              await setSalesReturnOrderLineDisposition(ctx, {
                lineId: rma.returnLineId,
                disposition: "Use As Is"
              })
            ).error
          ).toBeNull();
        }
        expect(await postedAmounts(f, rma.receiptId, fg)).toEqual(
          voidReturn ? [-40, 40] : [40]
        );
        expect(await postedAmounts(f, rma.receiptId, cogs)).toEqual(
          voidReturn ? [-40, 40] : [-40]
        );
        const remaining = voidReturn ? [outputs[1]!] : outputs;
        const unitCost = voidReturn ? 22 : 31;
        expect.soft(await valuation(f, itemId)).toEqual([
          {
            quantityOnHand: remaining.length,
            unitCost,
            totalValue: unitCost * remaining.length
          }
        ]);
        for (const unit of remaining) {
          const sale = await createPackedShipment(f, itemId, unit, "-resale");
          expect(
            (
              await assignShipmentLineEntity(ctx, {
                shipmentId: sale.shipmentId,
                shipmentLineId: sale.shipmentLineId,
                trackedEntityId: unit,
                trackingType: "serial",
                index: 0
              })
            ).error
          ).toBeNull();
          await postPackedShipment(f, sale, itemId, unit);
          expect
            .soft(await postedAmounts(f, sale.shipmentId, cogs))
            .toEqual([unitCost]);
          expect
            .soft(await postedAmounts(f, sale.shipmentId, fg))
            .toEqual([-unitCost]);
        }
        expect(await valuation(f, itemId)).toEqual([]);
        // These are all the finished-goods postings for the sales SKU. Its
        // source materials also hit the account under separate Job Issue documents.
        const balance = await f.db
          .selectFrom("journalLine as l")
          .innerJoin("journal as j", "j.id", "l.journalId")
          .select((eb) => eb.fn.sum<number>("l.amount").as("net"))
          .where("l.companyId", "=", f.companyId)
          .where("j.companyId", "=", f.companyId)
          .where("j.status", "=", "Posted")
          .where("l.accountId", "=", fg)
          .where("l.documentType", "in", [
            "Job Receipt",
            "Sales Shipment",
            "Receipt"
          ])
          .executeTakeFirstOrThrow();
        expect.soft(balance.net).toBe(0);
      } finally {
        await f.cleanup();
      }
    }
  );
}

for (const legacy of [true, false]) {
  postgrestTest(
    legacy
      ? "voiding a pre-upgrade serialized return leaves the established Average rate intact"
      : "voiding a FIFO return after switching to Average leaves the established rate intact",
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const ctx = operationContext(f, client, USER);
        let receiptId!: string;
        const { itemId, outputs } = await packSerials(
          f,
          legacy ? "Average" : "FIFO",
          await stockSerials(f),
          async (item, unit) => {
            receiptId = (await sellAndSelectReturn(f, ctx, item, unit, 40))
              .receiptId;
          }
        );
        const receipt = async (type: "post" | "void") =>
          unwrap(
            await invokePosting(
              handlesOf(f.ctx),
              "post-receipt",
              { type, receiptId },
              postReceipt
            )
          );
        await receipt("post");

        // A pre-upgrade receipt left the $22 rate untouched. A clerk can also
        // select Average with a $22 rate after receiving the unit under FIFO.
        await f.db
          .updateTable("itemCost")
          .set({ costingMethod: "Average", unitCost: 22 })
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", itemId)
          .execute();
        if (legacy) {
          // The old poster wrote one anonymous cost layer and no receipt line ID.
          await f.db
            .updateTable("itemLedger")
            .set({ documentLineId: null })
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", receiptId)
            .execute();
          await f.db
            .updateTable("costLedger")
            .set({ trackedEntityId: null })
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", receiptId)
            .execute();
        }
        await receipt("void");
        expect(await valuation(f, itemId)).toEqual([
          { quantityOnHand: 1, unitCost: 22, totalValue: 22 }
        ]);
        expect(
          await postedAmounts(f, receiptId, f.account("finished-goods"))
        ).toEqual([-40, 40]);
        const sale = await shipPackedUnit(f, itemId, outputs[1]!);
        expect(
          await postedAmounts(f, sale.shipmentId, f.account("cogs"))
        ).toEqual([22]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

for (const { costs, average, reason } of [
  { costs: [40, 0], average: 20, reason: "stranded credit at zero stock" },
  { costs: [10, 40], average: 25, reason: "stranded debit at zero stock" },
  {
    costs: [90, 3, 3],
    average: 32,
    reason: "negative value on remaining stock"
  }
]) {
  postgrestTest(
    `refuses an Average return void with ${reason}`,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const ctx = operationContext(f, client, USER);
        const handles = handlesOf(f.ctx);
        const fg = f.account("finished-goods");
        const cogs = f.account("cogs");
        let receiptId!: string;
        const receipt = (type: "post" | "void") =>
          invokePosting(
            handles,
            "post-receipt",
            { type, receiptId },
            postReceipt
          );
        const { itemId, outputs } = await packSerials(
          f,
          "Average",
          await stockSerials(f, costs),
          async (item, unit) => {
            const rma = await sellAndSelectReturn(
              f,
              ctx,
              item,
              unit,
              costs[0]!
            );
            receiptId = rma.receiptId;
            unwrap(await receipt("post"));
          }
        );
        const intervening = await shipPackedUnit(f, itemId, outputs[1]!);
        expect(await postedAmounts(f, intervening.shipmentId, cogs)).toEqual([
          average
        ]);
        expect((await receipt("void")).error?.message).toMatch(
          /Cannot void.*[Aa]verage/
        );
        expect(await valuation(f, itemId)).toEqual([
          {
            quantityOnHand: costs.length - 1,
            unitCost: average,
            totalValue: (costs.length - 1) * average
          }
        ]);
        expect(await postedAmounts(f, receiptId, fg)).toEqual([costs[0]]);
        expect(await postedAmounts(f, receiptId, cogs)).toEqual([-costs[0]!]);
        expect(
          await f.db
            .selectFrom("receipt")
            .select("status")
            .where("companyId", "=", f.companyId)
            .where("id", "=", receiptId)
            .executeTakeFirstOrThrow()
        ).toEqual({ status: "Posted" });
        expect(
          await f.db
            .selectFrom("itemLedger")
            .select(["quantity", "trackedEntityId"])
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", receiptId)
            .execute()
        ).toEqual([{ quantity: 1, trackedEntityId: outputs[0] }]);
        expect(
          await f.db
            .selectFrom("costLedger")
            .select(["remainingQuantity", "cost"])
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", receiptId)
            .execute()
        ).toEqual([{ remainingQuantity: 1, cost: costs[0] }]);

        unwrap(
          await invokePosting(
            handles,
            "post-shipment",
            {
              type: "void",
              shipmentId: intervening.shipmentId
            },
            postShipment
          )
        );
        unwrap(await receipt("void"));
        const remainingValue = costs
          .slice(1)
          .reduce((sum, cost) => sum + cost, 0);
        expect(await valuation(f, itemId)).toEqual([
          {
            quantityOnHand: costs.length - 1,
            unitCost: remainingValue / (costs.length - 1),
            totalValue: remainingValue
          }
        ]);
        expect(await postedAmounts(f, receiptId, fg)).toEqual([
          -costs[0]!,
          costs[0]
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

postgrestTest(
  "unscrapping a serialized unit averages its original scrap cost into remaining stock",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const [unit] = await stockSerials(f, [22]);
      const setStockRate = (unitCost: number) =>
        f.db
          .updateTable("itemCost")
          .set({ costingMethod: "Average", unitCost })
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", f.assemblyId)
          .execute();
      await setStockRate(22);
      const reason = await f.db
        .insertInto("scrapReason")
        .values({
          name: "Damage",
          companyId: f.companyId,
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const adjust = async (adjustmentType: "Scrap" | "Unscrap") =>
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-inventory-adjustment",
            {
              itemId: f.assemblyId,
              locationId: f.locationId,
              quantity: 1,
              trackedEntityId: unit!.id,
              adjustmentType,
              scrapReasonId: reason.id
            },
            postInventoryAdjustment
          )
        );
      await adjust("Scrap");
      await stockSerials(f, [40], 1);
      await setStockRate(40);
      const restored = await adjust("Unscrap");
      expect(
        await postedAmounts(
          f,
          restored.itemLedger!.id,
          f.account("finished-goods")
        )
      ).toEqual([22]);
      expect(await valuation(f, f.assemblyId)).toEqual([
        { quantityOnHand: 2, unitCost: 31, totalValue: 62 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

async function prepareStockIssue(
  f: Fixture,
  ctx: ReturnType<typeof operationContext>,
  itemId: string,
  unit: string,
  issue:
    | "sale"
    | "material issue"
    | "positive adjustment"
    | "negative adjustment"
) {
  const handles = handlesOf(f.ctx);
  if (issue === "positive adjustment" || issue === "negative adjustment") {
    const increase = issue === "positive adjustment";
    let ledgerId!: string;
    return {
      get documentId() {
        return ledgerId;
      },
      debitAccount: f.account(
        increase ? "finished-goods" : "adjustment-variance"
      ),
      creditAccount: f.account(
        increase ? "adjustment-variance" : "finished-goods"
      ),
      writeTable: "costLedger",
      post: async (db: Fixture["db"]) => {
        const result = unwrap(
          await invokePosting(
            { ...handles, db },
            "post-inventory-adjustment",
            {
              itemId,
              locationId: f.locationId,
              quantity: 1,
              trackedEntityId: increase ? f.prefix + "-spare" : unit,
              ...(increase ? { readableId: "SPARE" } : {}),
              adjustmentType: increase ? "Positive Adjmt." : "Negative Adjmt."
            },
            postInventoryAdjustment
          )
        );
        ledgerId = result.itemLedger!.id;
      }
    };
  }
  if (issue === "material issue") {
    // A separate ordinary job consumes the sales SKU as a component.
    const job = await jobFixture(
      { ...f, partId: itemId, assemblyId: f.partId },
      "ordinary"
    );
    const output = await f.db
      .insertInto("trackedEntity")
      .values({
        itemId: f.partId,
        sourceDocument: "Item",
        sourceDocumentId: f.partId,
        status: "Reserved",
        quantity: 1,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return {
      documentId: job.jobId,
      debitAccount: f.account("wip"),
      creditAccount: f.account("finished-goods"),
      writeTable: "costLedger",
      post: (db: Fixture["db"]) =>
        invokePosting(
          { ...handles, db },
          "issue",
          {
            type: "trackedEntitiesToOperation",
            materialId: job.materialId,
            jobOperationId: job.operationId,
            parentTrackedEntityId: output.id!,
            children: [{ trackedEntityId: unit, quantity: 1 }]
          },
          issueMaterial
        ).then(unwrap)
    };
  }
  const sale = await createPackedShipment(f, itemId, unit);
  expect(
    (
      await assignShipmentLineEntity(ctx, {
        shipmentId: sale.shipmentId,
        shipmentLineId: sale.shipmentLineId,
        trackedEntityId: unit,
        trackingType: "serial",
        index: 0
      })
    ).error
  ).toBeNull();
  return {
    documentId: sale.shipmentId,
    debitAccount: f.account("cogs"),
    creditAccount: f.account("finished-goods"),
    writeTable: "shipment",
    post: (db: Fixture["db"]) =>
      invokePosting(
        { ...handles, db },
        "post-shipment",
        { type: "post", shipmentId: sale.shipmentId },
        postShipment
      ).then(unwrap)
  };
}

for (const scenario of [
  {
    issue: "sale",
    operation: "return post",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "sale",
    operation: "return post",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 40
  },
  {
    issue: "sale",
    operation: "return void",
    documentFirst: true,
    issuedAt: 22,
    remainingCost: null
  },
  {
    issue: "sale",
    operation: "return void",
    documentFirst: false,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "material issue",
    operation: "return post",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "material issue",
    operation: "return post",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 40
  },
  {
    issue: "material issue",
    operation: "shipment void",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "material issue",
    operation: "shipment void",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 40
  },
  {
    issue: "positive adjustment",
    operation: "shipment void",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "positive adjustment",
    operation: "shipment void",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 28
  },
  {
    issue: "negative adjustment",
    operation: "return post",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "negative adjustment",
    operation: "return post",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 40
  },
  {
    issue: "negative adjustment",
    operation: "shipment void",
    documentFirst: true,
    issuedAt: 31,
    remainingCost: 31
  },
  {
    issue: "negative adjustment",
    operation: "shipment void",
    documentFirst: false,
    issuedAt: 22,
    remainingCost: 40
  }
] as const) {
  const { issue, operation, documentFirst, issuedAt, remainingCost } = scenario;
  postgrestTest(
    `a ${issue} and a ${operation} serialize Average valuation when the ${documentFirst ? operation : issue} posts first`,
    async (client) => {
      const f = await alwaysPostFixture();
      const firstConnection = await connectLocalTestDatabase();
      const otherConnection = await connectLocalTestDatabase();
      const resume = Promise.withResolvers<void>();
      let first: Promise<unknown> | undefined;
      let other: Promise<unknown> | undefined;
      try {
        await stampCutover(f);
        const ctx = operationContext(f, client, USER);
        const handles = handlesOf(f.ctx);
        let documentId!: string;
        const { itemId, outputs } = await packSerials(
          f,
          "Average",
          await stockSerials(f),
          async (item, unit) => {
            if (operation === "shipment void") {
              const sale = await shipPackedUnit(f, item, unit);
              documentId = sale.shipmentId;
              return;
            }
            documentId = (await sellAndSelectReturn(f, ctx, item, unit, 40))
              .receiptId;
            if (operation === "return void")
              unwrap(
                await invokePosting(
                  handles,
                  "post-receipt",
                  { type: "post", receiptId: documentId },
                  postReceipt
                )
              );
          }
        );
        const stockIssue = await prepareStockIssue(
          f,
          ctx,
          itemId,
          outputs[1]!,
          issue
        );
        const pid = (
          await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
            otherConnection
          )
        ).rows[0]!.pid;
        const writing = Promise.withResolvers<void>();
        const writes = new WeakSet<object>();
        const paused = firstConnection.withPlugin({
          transformQuery({ node, queryId }) {
            // Pause after costing and before the issue locks its accounting
            // period, so the other posting reaches the actual valuation lock.
            const table =
              node.kind === "UpdateQueryNode"
                ? node.table
                : node.kind === "InsertQueryNode"
                  ? node.into
                  : undefined;
            if (
              table &&
              TableNode.is(table) &&
              table.table.identifier.name ===
                (documentFirst ? "itemCost" : stockIssue.writeTable)
            )
              writes.add(queryId);
            return node;
          },
          async transformResult({ queryId, result }) {
            if (writes.has(queryId)) {
              writing.resolve();
              await resume.promise;
            }
            return result;
          }
        });
        const postDocument = async (db: typeof paused) => {
          if (operation === "shipment void") {
            unwrap(
              await invokePosting(
                { ...handles, db },
                "post-shipment",
                { type: "void", shipmentId: documentId },
                postShipment
              )
            );
            return;
          }
          const result = await invokePosting(
            { ...handles, db },
            "post-receipt",
            {
              type: operation === "return post" ? "post" : "void",
              receiptId: documentId
            },
            postReceipt
          );
          if (documentFirst || operation === "return post") unwrap(result);
          else expect(result.error?.message).toMatch(/Cannot void.*Average/);
        };
        first = documentFirst ? postDocument(paused) : stockIssue.post(paused);
        await Promise.race([
          writing.promise,
          first.then(() => {
            throw new Error("Posting finished before its write");
          })
        ]);
        let completed = false;
        other = (
          documentFirst
            ? stockIssue.post(otherConnection)
            : postDocument(otherConnection)
        ).finally(() => {
          completed = true;
        });
        // Observe the lock wait while the first native posting is still open.
        let waiting = false;
        for (let i = 0; i < 400 && !completed && !waiting; i++) {
          const state = await sql<{
            waiting: boolean;
          }>`SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE pid = ${pid} AND locktype = 'advisory' AND NOT granted
          ) AS waiting`.execute(f.db);
          waiting = state.rows[0]!.waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        resume.resolve();
        await Promise.all([first, other]);

        if (operation === "shipment void") {
          expect(
            await postedAmounts(f, documentId, f.account("finished-goods"))
          ).toEqual([-40, 40]);
        }
        expect(
          await postedAmounts(f, stockIssue.documentId, stockIssue.debitAccount)
        ).toEqual([issuedAt]);
        expect(
          await postedAmounts(
            f,
            stockIssue.documentId,
            stockIssue.creditAccount
          )
        ).toEqual([-issuedAt]);
        const remainingUnits = issue === "positive adjustment" ? 3 : 1;
        expect(await valuation(f, itemId)).toEqual(
          remainingCost === null
            ? []
            : [
                {
                  quantityOnHand: remainingUnits,
                  unitCost: remainingCost,
                  totalValue: remainingUnits * remainingCost
                }
              ]
        );
      } finally {
        resume.resolve();
        await Promise.allSettled([first, other]);
        await otherConnection.destroy();
        await firstConnection.destroy();
        await f.cleanup();
      }
    }
  );
}
