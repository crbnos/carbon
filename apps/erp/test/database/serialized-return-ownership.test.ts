// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  stampCutover,
  unwrap,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { postgrestTest, operationContext } from "./fixtures/local-supabase";
import {
  createPackedShipment,
  postPackedShipment
} from "./fixtures/packout-shipment";
import {
  createLinkedSerialReturn,
  stockSerials
} from "./fixtures/serialized-sale";

for (const method of ["FIFO", "LIFO", "Average", "Standard"] as const) {
  postgrestTest(
    `only the latest serialized return can be voided under ${method}`,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const serialId = (await stockSerials(f))[0]!.id;
        const itemId = f.assemblyId;
        await f.db
          .updateTable("itemCost")
          .set({ costingMethod: method, unitCost: 31, standardCost: 19 })
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", itemId)
          .execute();
        const ctx = operationContext(f, client, USER);
        const post = (receiptId: string, type: "post" | "void") =>
          invokePosting(
            handlesOf(f.ctx),
            "post-receipt",
            { receiptId, type },
            postReceipt
          ).then(unwrap);
        const sellAndReturn = async (suffix: string) => {
          const shipment = await createPackedShipment(f, itemId, suffix);
          expect(
            (
              await assignShipmentLineEntity(ctx, {
                shipmentId: shipment.shipmentId,
                shipmentLineId: shipment.shipmentLineId,
                trackingType: "serial",
                trackedEntityId: serialId,
                index: 0
              })
            ).error
          ).toBeNull();
          await postPackedShipment(f, shipment, itemId, serialId);
          const rma = await createLinkedSerialReturn(
            f,
            itemId,
            shipment.shipmentLineId
          );
          expect(
            (
              await assignReceiptReturnEntity(ctx, {
                receiptId: rma.receiptId,
                receiptLineId: rma.receiptLineId,
                trackedEntityId: serialId,
                index: 0
              })
            ).error
          ).toBeNull();
          await post(rma.receiptId, "post");
          return rma;
        };
        const first = await sellAndReturn("first");
        expect(
          (
            await setSalesReturnOrderLineDisposition(ctx, {
              lineId: first.returnLineId,
              disposition: "Use As Is"
            })
          ).error
        ).toBeNull();
        const second = await sellAndReturn("second");
        const ids = [first.receiptId, second.receiptId];
        const snapshot = async () => {
          const receipts = await f.db
            .selectFrom("receipt")
            .select(["id", "status"])
            .where("companyId", "=", f.companyId)
            .where("id", "in", ids)
            .orderBy("id")
            .execute();
          const orderLines = await f.db
            .selectFrom("salesReturnOrderLine")
            .select(["id", "quantityReceived", "disposition"])
            .where("companyId", "=", f.companyId)
            .where("id", "in", [first.returnLineId, second.returnLineId])
            .orderBy("id")
            .execute();
          const physical = await f.db
            .selectFrom("itemLedger")
            .select(["documentId", "quantity"])
            .where("companyId", "=", f.companyId)
            .where("trackedEntityId", "=", serialId)
            .orderBy("entryNumber")
            .execute();
          const layers = await f.db
            .selectFrom("costLedger")
            .select(["documentId", "quantity", "cost", "remainingQuantity"])
            .where("companyId", "=", f.companyId)
            .where("documentId", "in", ids)
            .orderBy("entryNumber")
            .execute();
          const journals = await f.db
            .selectFrom("journalLine as l")
            .innerJoin("journal as j", "j.id", "l.journalId")
            .select([
              "l.id",
              "l.documentId",
              "l.accountId",
              "l.amount",
              "j.status"
            ])
            .where("l.companyId", "=", f.companyId)
            .where("j.companyId", "=", f.companyId)
            .where("l.documentId", "in", ids)
            .orderBy("l.id")
            .execute();
          const entity = await f.db
            .selectFrom("trackedEntity")
            .select(["id", "quantity", "status", "attributes"])
            .where("companyId", "=", f.companyId)
            .where("id", "=", serialId)
            .executeTakeFirstOrThrow();
          const valuation = await f.db
            .selectFrom("itemCost")
            .select(["costingMethod", "unitCost", "standardCost"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .executeTakeFirstOrThrow();
          return {
            receipts,
            orderLines,
            physical,
            layers,
            journals,
            entity,
            valuation
          };
        };
        const before = await snapshot();
        expect(before.receipts.map((r) => r.status)).toEqual([
          "Posted",
          "Posted"
        ]);
        expect(before.physical.map((row) => row.quantity)).toEqual([
          1, -1, 1, -1, 1
        ]);
        expect(before.journals).toHaveLength(4);
        expect(before.entity).toMatchObject({
          status: "On Hold",
          attributes: { Receipt: second.receiptId }
        });
        // A different return currently holds the same physical unit in the same bin.
        await expect(post(first.receiptId, "void")).rejects.toThrow(
          /moved|consumed/
        );
        expect(await snapshot()).toEqual(before);

        await post(second.receiptId, "void");
        const after = await snapshot();
        expect(after.receipts).toEqual(
          expect.arrayContaining([
            { id: first.receiptId, status: "Posted" },
            { id: second.receiptId, status: "Voided" }
          ])
        );
        expect(after.orderLines).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: first.returnLineId,
              quantityReceived: 1
            }),
            expect.objectContaining({
              id: second.returnLineId,
              quantityReceived: 0
            })
          ])
        );
        expect(after.physical).toEqual([
          ...before.physical,
          { documentId: second.receiptId, quantity: -1 }
        ]);
        expect(after.entity.status).toBe("Consumed");
        expect(
          after.layers.find((layer) => layer.documentId === second.receiptId)
            ?.remainingQuantity
        ).toBe(0);
        const reversals = after.journals.filter(
          (row) => !before.journals.some((old) => old.id === row.id)
        );
        const original = before.journals.filter(
          (row) => row.documentId === second.receiptId
        );
        expect(reversals).toHaveLength(2);
        expect(reversals).toEqual(
          expect.arrayContaining(
            original.map((row) =>
              expect.objectContaining({
                documentId: second.receiptId,
                accountId: row.accountId,
                amount: -row.amount,
                status: "Posted"
              })
            )
          )
        );
      } finally {
        await f.cleanup();
      }
    }
  );
}
