// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  assignReceiptReturnEntity,
  assignShipmentLineEntity
} from "../../app/modules/inventory/inventory.server";
import { postReceipt } from "../../app/modules/inventory/inventory.service";
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
            const initial = await shipPackedUnit(f, item, unit);
            expect(await postedAmounts(f, initial.shipmentId, cogs)).toEqual([
              40
            ]);
            const line = await f.db
              .selectFrom("shipmentLine")
              .select("id")
              .where("companyId", "=", f.companyId)
              .where("shipmentId", "=", initial.shipmentId)
              .executeTakeFirstOrThrow();
            rma = await createLinkedSerialReturn(f, item, line.id);
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
