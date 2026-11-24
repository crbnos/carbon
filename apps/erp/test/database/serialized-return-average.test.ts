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
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
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

for (const voidFirst of [true, false]) {
  postgrestTest(
    voidFirst
      ? "a sale waits for a return void and books the revised Average rate"
      : "a return void waits for a sale and rechecks the remaining Average value",
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
        let receiptId!: string;
        const { itemId, outputs } = await packSerials(
          f,
          "Average",
          await stockSerials(f),
          async (item, unit) => {
            receiptId = (await sellAndSelectReturn(f, ctx, item, unit, 40))
              .receiptId;
            unwrap(
              await invokePosting(
                handles,
                "post-receipt",
                { type: "post", receiptId },
                postReceipt
              )
            );
          }
        );
        const sale = await createPackedShipment(f, itemId, outputs[1]!);
        expect(
          (
            await assignShipmentLineEntity(ctx, {
              shipmentId: sale.shipmentId,
              shipmentLineId: sale.shipmentLineId,
              trackedEntityId: outputs[1]!,
              trackingType: "serial",
              index: 0
            })
          ).error
        ).toBeNull();
        const pid = (
          await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(
            otherConnection
          )
        ).rows[0]!.pid;
        const writing = Promise.withResolvers<void>();
        const updates = new WeakSet<object>();
        const paused = firstConnection.withPlugin({
          transformQuery({ node, queryId }) {
            if (
              node.kind === "UpdateQueryNode" &&
              node.table &&
              TableNode.is(node.table) &&
              node.table.table.identifier.name ===
                (voidFirst ? "itemCost" : "shipment")
            )
              updates.add(queryId);
            return node;
          },
          async transformResult({ queryId, result }) {
            if (updates.has(queryId)) {
              writing.resolve();
              await resume.promise;
            }
            return result;
          }
        });
        const voidReceipt = async (db: typeof paused) => {
          const result = await invokePosting(
            { ...handles, db },
            "post-receipt",
            { type: "void", receiptId },
            postReceipt
          );
          if (voidFirst) unwrap(result);
          else expect(result.error?.message).toMatch(/Cannot void.*Average/);
        };
        const postSale = async (db: typeof paused) => {
          unwrap(
            await invokePosting(
              { ...handles, db },
              "post-shipment",
              { type: "post", shipmentId: sale.shipmentId },
              postShipment
            )
          );
        };
        first = voidFirst ? voidReceipt(paused) : postSale(paused);
        await Promise.race([
          writing.promise,
          first.then(() => {
            throw new Error("Posting finished before its write");
          })
        ]);
        let completed = false;
        other = (
          voidFirst ? postSale(otherConnection) : voidReceipt(otherConnection)
        ).finally(() => {
          completed = true;
        });
        // Observe the lock wait while the first native posting is still open.
        let waiting = false;
        for (let i = 0; i < 400 && !completed && !waiting; i++) {
          const state = await sql<{
            waiting: boolean;
          }>`SELECT cardinality(pg_blocking_pids(${pid})) > 0 AS waiting`.execute(
            f.db
          );
          waiting = state.rows[0]!.waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        resume.resolve();
        await Promise.all([first, other]);
        const cost = voidFirst ? 22 : 31;
        expect(
          await postedAmounts(f, sale.shipmentId, f.account("cogs"))
        ).toEqual([cost]);
        expect(
          await postedAmounts(f, sale.shipmentId, f.account("finished-goods"))
        ).toEqual([-cost]);
        expect(await valuation(f, itemId)).toEqual(
          voidFirst ? [] : [{ quantityOnHand: 1, unitCost: 31, totalValue: 31 }]
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
