// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  assignReceiptReturnEntity,
  assignShipmentLineEntity
} from "../../app/modules/inventory/inventory.server";
import {
  postReceipt,
  postStockTransfer
} from "../../app/modules/inventory/inventory.service";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
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

function postReturn(f: Fixture, receiptId: string, type: "post" | "void") {
  return invokePosting(
    handlesOf(f.ctx),
    "post-receipt",
    { receiptId, type },
    postReceipt
  ).then(unwrap);
}

async function sellAndReturn(
  f: Fixture,
  ctx: ReturnType<typeof operationContext>,
  serialId: string,
  suffix: string
) {
  const shipment = await createPackedShipment(f, f.assemblyId, suffix);
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
  await postPackedShipment(f, shipment, f.assemblyId, serialId);
  const rma = await createLinkedSerialReturn(
    f,
    f.assemblyId,
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
  await postReturn(f, rma.receiptId, "post");
  return rma;
}

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
        const first = await sellAndReturn(f, ctx, serialId, "first");
        expect(
          (
            await setSalesReturnOrderLineDisposition(ctx, {
              lineId: first.returnLineId,
              disposition: "Use As Is"
            })
          ).error
        ).toBeNull();
        const second = await sellAndReturn(f, ctx, serialId, "second");
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
        await expect(postReturn(f, first.receiptId, "void")).rejects.toThrow(
          /moved|consumed/
        );
        expect(await snapshot()).toEqual(before);

        await postReturn(f, second.receiptId, "void");
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

postgrestTest(
  "a current return can be voided after the clerk unpicks its serial back to the receiving bin",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const ctx = operationContext(f, client, USER);
      const serialId = (await stockSerials(f))[0]!.id;
      const rma = await sellAndReturn(f, ctx, serialId, "bin-pick");
      expect(
        (
          await setSalesReturnOrderLineDisposition(ctx, {
            lineId: rma.returnLineId,
            disposition: "Use As Is"
          })
        ).error
      ).toBeNull();

      const company = { companyId: f.companyId, createdBy: USER };
      const bin = await f.db
        .insertInto("storageUnit")
        .values({ ...company, name: "Destination", locationId: f.locationId })
        .returning("id")
        .executeTakeFirstOrThrow();
      const transfer = await f.db
        .insertInto("stockTransfer")
        .values({
          ...company,
          stockTransferId: f.prefix,
          status: "Released",
          locationId: f.locationId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const line = await f.db
        .insertInto("stockTransferLine")
        .values({
          ...company,
          stockTransferId: transfer.id,
          itemId: f.assemblyId,
          quantity: 1,
          requiresSerialTracking: true,
          toStorageUnitId: bin.id
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const pick = {
        stockTransferId: transfer.id,
        stockTransferLineId: line.id,
        trackedEntityId: serialId,
        locationId: f.locationId
      };
      await postStockTransfer(ctx, { ...pick, type: "serial" });
      await expect(postReturn(f, rma.receiptId, "void")).rejects.toThrow(
        /stock.*moved/i
      );
      await postStockTransfer(ctx, { ...pick, type: "unpickSerial" });
      await postReturn(f, rma.receiptId, "void");
      const movements = await f.db
        .selectFrom("itemLedger")
        .select(["documentId", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("trackedEntityId", "=", serialId)
        .orderBy("entryNumber")
        .execute();
      expect(movements.at(-1)).toEqual({
        documentId: rma.receiptId,
        quantity: -1
      });
      expect(
        movements.reduce((sum, row) => sum + Number(row.quantity), 0)
      ).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);
