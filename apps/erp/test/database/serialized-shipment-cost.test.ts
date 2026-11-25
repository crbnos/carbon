// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import {
  assignShipmentSerial,
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  stampCutover,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import {
  createPackedShipment,
  postPackedShipment,
  shipPackedUnit
} from "./fixtures/packout-shipment";
import {
  stockSerials,
  packSerials,
  shipNormalAndWarranty,
  createLinkedSerialReturn
} from "./fixtures/serialized-sale";
import { postgrestTest, operationContext } from "./fixtures/local-supabase";
import {
  assignReceiptReturnEntity,
  setReceiptLineSerial,
  assignShipmentLineEntity
} from "../../app/modules/inventory/inventory.server";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";

function layers(f: Fixture, itemId: string) {
  return f.db
    .selectFrom("costLedger")
    .select(["trackedEntityId", "cost", "remainingQuantity"])
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", itemId)
    .where("quantity", ">", 0)
    .orderBy("entryNumber")
    .execute();
}

async function journal(f: Fixture, shipmentId: string) {
  const rows = await f.db
    .selectFrom("journalLine as l")
    .innerJoin("journal as j", "j.id", "l.journalId")
    .select(["l.amount", "j.status", "l.accountId"])
    .where("l.companyId", "=", f.companyId)
    .where("j.companyId", "=", f.companyId)
    .where("l.documentId", "=", shipmentId)
    .where("l.documentType", "=", "Sales Shipment")
    .execute();
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.status === "Posted")).toBe(true);
  return rows
    .filter((row) => row.accountId === f.account("cogs"))
    .map((row) => Number(row.amount))
    .sort((a, b) => a - b);
}

for (const method of ["FIFO", "LIFO", "Average", "Standard"] as const) {
  databaseTest(
    `serialized ${method} shipment posts configured COGS and preserves the matching receipt layer balances`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const { itemId, outputs } = await packSerials(
          f,
          method,
          await stockSerials(f)
        );
        const [rich, cheap] = outputs;
        const receipts = [
          { trackedEntityId: rich, cost: 40, remainingQuantity: 1 },
          { trackedEntityId: cheap, cost: 22, remainingQuantity: 1 }
        ];
        expect(await layers(f, itemId)).toEqual(receipts);
        const layered = method === "FIFO" || method === "LIFO";
        // Choose the opposite of the method's default age order.
        const shipRich = method === "LIFO";
        const first = shipRich ? rich! : cheap!;
        const second = shipRich ? cheap! : rich!;
        const policyCost = method === "Average" ? 31 : 15;
        const firstSale = await shipPackedUnit(f, itemId, first);
        expect(await journal(f, firstSale.shipmentId)).toEqual([
          layered ? (shipRich ? 40 : 22) : policyCost
        ]);
        expect(await layers(f, itemId)).toEqual(
          expect.arrayContaining(
            receipts.map((row) => ({
              ...row,
              remainingQuantity:
                layered && row.trackedEntityId === first ? 0 : 1
            }))
          )
        );
        const secondSale = await shipPackedUnit(f, itemId, second);
        expect(await journal(f, secondSale.shipmentId)).toEqual([
          layered ? (shipRich ? 22 : 40) : policyCost
        ]);
        expect(await layers(f, itemId)).toEqual(
          expect.arrayContaining(
            receipts.map((row) => ({
              ...row,
              remainingQuantity: layered ? 0 : 1
            }))
          )
        );
      } finally {
        await f.cleanup();
      }
    }
  );
}

for (const packed of [false, true]) {
  databaseTest(
    `a ${packed ? "packed" : "feature-off ordinary"} FIFO serial can be resold at its booked cost after a void`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const stock = await stockSerials(f);
        const { itemId, outputs } = packed
          ? await packSerials(f, "FIFO", stock)
          : { itemId: f.assemblyId, outputs: stock.map((s) => s.id) };
        const id = outputs[1]!;
        const sale = await shipPackedUnit(f, itemId, id);
        expect(await journal(f, sale.shipmentId)).toEqual([22]);
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-shipment",
            { type: "void", shipmentId: sale.shipmentId },
            postShipment
          )
        );
        const physical = () =>
          f.db
            .selectFrom("itemLedger")
            .select((eb) => eb.fn.sum<number>("quantity").as("qty"))
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .where("trackedEntityId", "=", id)
            .executeTakeFirstOrThrow();
        const restored = await f.db
          .selectFrom("trackedEntity")
          .select(["quantity", "status", "attributes"])
          .where("companyId", "=", f.companyId)
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect(await physical()).toEqual({ qty: 1 });
        expect(restored).toMatchObject({ quantity: 1, status: "Available" });
        expect.soft(restored.attributes).not.toHaveProperty("Shipment");
        expect.soft(restored.attributes).not.toHaveProperty("Shipment Line");
        expect
          .soft(restored.attributes)
          .not.toHaveProperty("Shipment Line Index");
        expect
          .soft(
            (await layers(f, itemId)).filter(
              (l) => l.trackedEntityId === id && l.remainingQuantity > 0
            )
          )
          .toEqual([{ trackedEntityId: id, cost: 22, remainingQuantity: 1 }]);
        expect(await journal(f, sale.shipmentId)).toEqual([-22, 22]);
        const resale = await shipPackedUnit(f, itemId, id, "resale");
        expect(await journal(f, resale.shipmentId)).toEqual([22]);
        expect(await physical()).toEqual({ qty: 0 });
        const costs = await f.db
          .selectFrom("costLedger")
          .select(["quantity", "cost"])
          .where("companyId", "=", f.companyId)
          .where("itemId", "=", itemId)
          .where("documentType", "=", "Sales Shipment")
          .where("documentId", "in", [sale.shipmentId, resale.shipmentId])
          .orderBy("entryNumber")
          .execute();
        expect(costs).toEqual([
          { quantity: -1, cost: -22 },
          { quantity: 1, cost: 22 },
          { quantity: -1, cost: -22 }
        ]);
        expect(
          (await layers(f, itemId)).filter((l) => l.remainingQuantity > 0)
        ).toEqual([
          { trackedEntityId: outputs[0], cost: 40, remainingQuantity: 1 }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}

databaseTest(
  "voiding two serialized units sold together restores each booked cost",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const units = await stockSerials(f);
      const itemId = f.assemblyId;
      const draft = await createPackedShipment(f, itemId, "both", "", 2);
      for (const [index, unit] of units.entries()) {
        expect(
          await assignShipmentSerial(
            f.db,
            f.companyId,
            {
              shipmentId: draft.shipmentId,
              shipmentLineId: draft.shipmentLineId,
              index,
              trackedEntityId: unit.id
            },
            {
              itemId,
              status: "Available",
              receiptId: undefined,
              sourceDocument: "Sales Order",
              sourceDocumentId: draft.salesOrderId,
              supplierId: null
            }
          )
        ).toBeNull();
      }
      const post = (type: "post" | "void") =>
        invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type, shipmentId: draft.shipmentId },
          postShipment
        ).then(unwrap);
      await post("post");
      expect(await journal(f, draft.shipmentId)).toEqual([62]);
      await post("void");
      expect(await journal(f, draft.shipmentId)).toEqual([-62, 62]);
      const open = (await layers(f, itemId)).filter(
        (l) => l.remainingQuantity > 0
      );
      expect(open).toHaveLength(2);
      expect(open).toEqual(
        expect.arrayContaining(
          units.map((u) => ({
            trackedEntityId: u.id,
            cost: u.cost,
            remainingQuantity: 1
          }))
        )
      );
      for (const unit of units.toReversed()) {
        const resale = await shipPackedUnit(f, itemId, unit.id);
        expect(await journal(f, resale.shipmentId)).toEqual([unit.cost]);
      }
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a sales void cannot restore a serial already returned to stock",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const [, unit] = await stockSerials(f);
      const { shipmentId } = await shipPackedUnit(f, f.assemblyId, unit!.id);
      // The later stock movement has already returned this unit from the customer.
      await f.db
        .updateTable("trackedEntity")
        .set({ status: "Available", attributes: {} })
        .where("companyId", "=", f.companyId)
        .where("id", "=", unit!.id)
        .execute();
      await f.db
        .insertInto("itemLedger")
        .values({
          companyId: f.companyId,
          itemId: f.assemblyId,
          trackedEntityId: unit!.id,
          entryType: "Positive Adjmt.",
          quantity: 1,
          locationId: f.locationId,
          createdBy: USER
        })
        .execute();
      await expect(
        invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "void", shipmentId },
          postShipment
        ).then(unwrap)
      ).rejects.toThrow(/moved|returned/);
      expect(await journal(f, shipmentId)).toEqual([22]);
      expect(
        await f.db
          .selectFrom("shipment")
          .select("status")
          .where("companyId", "=", f.companyId)
          .where("id", "=", shipmentId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: "Posted" });
      expect(
        (await layers(f, f.assemblyId)).filter(
          (layer) =>
            layer.trackedEntityId === unit!.id && layer.remainingQuantity > 0
        )
      ).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a mixed serialized sale charges normal COGS and warranty expense for the unit on each line",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const {
        itemId,
        outputs: [rich, cheap]
      } = await packSerials(f, "FIFO", await stockSerials(f));
      const sale = await shipNormalAndWarranty(f, itemId, cheap!, rich!);
      const booked = await f.db
        .selectFrom("costLedger")
        .select(["trackedEntityId", "cost", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Sales Shipment")
        .where("documentId", "=", sale.shipmentId)
        .orderBy("cost")
        .execute();
      expect(booked).toEqual([
        { trackedEntityId: rich, cost: -40, quantity: -1 },
        { trackedEntityId: cheap, cost: -22, quantity: -1 }
      ]);
      const lines = await f.db
        .selectFrom("journalLine as l")
        .innerJoin("journal as j", "j.id", "l.journalId")
        .select([
          "l.accountId",
          "l.amount",
          "l.documentLineReference",
          "j.status"
        ])
        .where("l.companyId", "=", f.companyId)
        .where("j.companyId", "=", f.companyId)
        .where("l.documentId", "=", sale.shipmentId)
        .execute();
      expect(lines).toHaveLength(4);
      expect(lines).toEqual(
        expect.arrayContaining([
          {
            accountId: f.account("cogs"),
            amount: 22,
            documentLineReference: "shipment:" + sale.shipmentLineId,
            status: "Posted"
          },
          {
            accountId: f.account("scrap"),
            amount: 40,
            documentLineReference: "shipment:" + sale.warrantyLineId,
            status: "Posted"
          },
          {
            accountId: f.account("finished-goods"),
            amount: -22,
            documentLineReference: "shipment:" + sale.shipmentLineId,
            status: "Posted"
          },
          {
            accountId: f.account("finished-goods"),
            amount: -40,
            documentLineReference: "shipment:" + sale.warrantyLineId,
            status: "Posted"
          }
        ])
      );
    } finally {
      await f.cleanup();
    }
  }
);

for (const scenario of [
  "linked cost",
  "resale after Use As Is",
  "historical pooled cost"
] as const) {
  postgrestTest(
    "a serialized customer return preserves " + scenario,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const {
          itemId,
          outputs: [rich, cheap]
        } = await packSerials(f, "FIFO", await stockSerials(f));
        const sale = await shipNormalAndWarranty(f, itemId, cheap!, rich!);
        const readOtherUnit = () =>
          f.db
            .selectFrom("trackedEntity")
            .select(["status", "quantity", "attributes"])
            .where("companyId", "=", f.companyId)
            .where("id", "=", rich!)
            .executeTakeFirstOrThrow();
        const before = await readOtherUnit();
        const rma = await createLinkedSerialReturn(
          f,
          itemId,
          sale.shipmentLineId
        );
        if (scenario === "historical pooled cost") {
          await f.db.transaction().execute(async (trx) => {
            await trx
              .deleteFrom("costLedger")
              .where("companyId", "=", f.companyId)
              .where("documentId", "=", sale.shipmentId)
              .where("documentType", "=", "Sales Shipment")
              .execute();
            await trx
              .insertInto("costLedger")
              .values({
                companyId: f.companyId,
                itemLedgerType: "Sale",
                costLedgerType: "Direct Cost",
                adjustment: false,
                itemId,
                quantity: -2,
                cost: -62,
                documentId: sale.shipmentId,
                documentType: "Sales Shipment",
                remainingQuantity: 0
              })
              .execute();
          });
        }
        const ctx = operationContext(f, client, USER);
        expect(
          (
            await assignReceiptReturnEntity(ctx, {
              receiptId: rma.receiptId,
              receiptLineId: rma.receiptLineId,
              trackedEntityId: cheap!,
              index: 0
            })
          ).error
        ).toBeNull();
        // An anonymous open layer must survive resale of a returned physical unit.
        await f.db
          .insertInto("costLedger")
          .values({
            itemLedgerType: "Positive Adjmt.",
            costLedgerType: "Direct Cost",
            itemId,
            quantity: 1,
            remainingQuantity: 1,
            cost: 77,
            companyId: f.companyId
          })
          .execute();
        unwrap(
          await invokePosting(
            handlesOf(f.ctx),
            "post-receipt",
            { type: "post", receiptId: rma.receiptId },
            postReceipt
          )
        );
        const expected = scenario === "historical pooled cost" ? 31 : 22;
        if (scenario !== "resale after Use As Is") {
          const journal = await f.db
            .selectFrom("journalLine as l")
            .innerJoin("journal as j", "j.id", "l.journalId")
            .select(["l.accountId", "l.amount", "j.status"])
            .where("l.companyId", "=", f.companyId)
            .where("j.companyId", "=", f.companyId)
            .where("l.documentId", "=", rma.receiptId)
            .execute();
          expect.soft(journal).toEqual(
            expect.arrayContaining([
              {
                accountId: f.account("cogs"),
                amount: -expected,
                status: "Posted"
              },
              {
                accountId: f.account("finished-goods"),
                amount: expected,
                status: "Posted"
              }
            ])
          );
          const layer = await f.db
            .selectFrom("costLedger")
            .select([
              "cost",
              "quantity",
              "remainingQuantity",
              "trackedEntityId"
            ])
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", rma.receiptId)
            .execute();
          expect(layer).toEqual([
            {
              cost: expected,
              quantity: 1,
              remainingQuantity: 1,
              trackedEntityId: cheap
            }
          ]);
        } else {
          expect(
            (
              await setSalesReturnOrderLineDisposition(ctx, {
                lineId: rma.returnLineId,
                disposition: "Use As Is"
              })
            ).error
          ).toBeNull();
          const next = await createPackedShipment(f, itemId, "fresh");
          const pick = (draft: typeof next) =>
            assignShipmentLineEntity(ctx, {
              shipmentId: draft.shipmentId,
              shipmentLineId: draft.shipmentLineId,
              trackingType: "serial",
              trackedEntityId: cheap!,
              index: 0
            });
          expect((await pick(next)).error).toBeNull();
          const other = await createPackedShipment(f, itemId, "other");
          expect((await pick(other)).error?.message).toMatch(
            /already assigned/
          );
          await postPackedShipment(f, next, itemId, cheap!);
          expect(await journal(f, next.shipmentId)).toEqual([22]);
          expect(
            (await layers(f, itemId)).filter((r) => r.remainingQuantity > 0)
          ).toEqual([
            { trackedEntityId: null, cost: 77, remainingQuantity: 1 }
          ]);
          expect(before).toMatchObject({
            status: "Consumed",
            attributes: {
              Shipment: sale.shipmentId,
              "Shipment Line": sale.warrantyLineId
            }
          });
          expect(await readOtherUnit()).toEqual(before);
          const otherStock = await f.db
            .selectFrom("itemLedger")
            .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .where("trackedEntityId", "=", rich!)
            .executeTakeFirstOrThrow();
          expect(otherStock.quantity).toBe(0);
          const otherMovements = await f.db
            .selectFrom("costLedger")
            .select(["quantity", "cost", "remainingQuantity"])
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .where("trackedEntityId", "=", rich!)
            .orderBy("entryNumber")
            .execute();
          expect(otherMovements).toEqual([
            { quantity: 1, cost: 40, remainingQuantity: 0 },
            { quantity: -1, cost: -40, remainingQuantity: 0 }
          ]);
          // Even stale status metadata cannot use this earlier receipt as proof
          // of a return from the later sale. Its stock debit is newer.
          await f.db
            .updateTable("trackedEntity")
            .set({ status: "Available" })
            .where("companyId", "=", f.companyId)
            .where("id", "=", cheap!)
            .execute();
          expect((await pick(other)).error?.message).toMatch(
            /already assigned/
          );
        }
      } finally {
        await f.cleanup();
      }
    }
  );
}

for (const scenario of [
  "different line",
  "different shipment",
  "mixed historical ledger",
  "legacy sale without tags",
  "new receipt serial on a linked return",
  "blind",
  "zero value",
  "another customer"
] as const) {
  postgrestTest(
    "returning the selected serial supports " + scenario,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const [rich, cheap] = await stockSerials(f);
        const itemId = f.assemblyId;
        let linkedLine: string;
        let actualShipment: string;
        if (
          scenario === "different shipment" ||
          scenario === "another customer"
        ) {
          const original = await shipPackedUnit(f, itemId, cheap!.id);
          const actual = await shipPackedUnit(f, itemId, rich!.id);
          const line = await f.db
            .selectFrom("shipmentLine")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("shipmentId", "=", original.shipmentId)
            .executeTakeFirstOrThrow();
          linkedLine = line.id;
          actualShipment = actual.shipmentId;
        } else {
          const sale = await shipNormalAndWarranty(
            f,
            itemId,
            cheap!.id,
            rich!.id
          );
          linkedLine = sale.shipmentLineId;
          actualShipment = sale.shipmentId;
        }
        const rma = await createLinkedSerialReturn(f, itemId, linkedLine);
        if (scenario === "mixed historical ledger") {
          await f.db
            .updateTable("costLedger")
            .set({ trackedEntityId: null })
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .where("documentId", "=", actualShipment)
            .where("trackedEntityId", "=", rich!.id)
            .execute();
        }
        if (scenario === "blind") {
          await f.db
            .updateTable("salesReturnOrderLine")
            .set({ shipmentLineId: null })
            .where("companyId", "=", f.companyId)
            .where("id", "=", rma.returnLineId)
            .execute();
          await f.db
            .updateTable("itemCost")
            .set({ unitCost: 9 })
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", itemId)
            .execute();
        }
        if (scenario === "zero value") {
          const reason = await f.db
            .insertInto("returnReason")
            .values({
              name: "No value",
              inventoryValueZero: true,
              companyId: f.companyId,
              createdBy: USER
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await f.db
            .updateTable("salesReturnOrderLine")
            .set({ returnReasonId: reason.id })
            .where("companyId", "=", f.companyId)
            .where("id", "=", rma.returnLineId)
            .execute();
        }
        const ctx = operationContext(f, client, USER);
        let returnedId = rich!.id;
        if (scenario === "new receipt serial on a linked return") {
          expect(
            (
              await setReceiptLineSerial(ctx, {
                receiptId: rma.receiptId,
                receiptLineId: rma.receiptLineId,
                serialNumber: "Unrecorded",
                index: 0
              })
            ).error
          ).toBeNull();
          const entered = await f.db
            .selectFrom("trackedEntity")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("readableId", "=", "Unrecorded")
            .executeTakeFirstOrThrow();
          returnedId = entered.id;
        } else {
          expect(
            (
              await assignReceiptReturnEntity(ctx, {
                receiptId: rma.receiptId,
                receiptLineId: rma.receiptLineId,
                trackedEntityId: rich!.id,
                index: 0
              })
            ).error
          ).toBeNull();
        }
        if (scenario === "legacy sale without tags") {
          // This historical return slot lacks the newer mutable SKU and shipment tags.
          const unit = await f.db
            .selectFrom("trackedEntity")
            .select("attributes")
            .where("companyId", "=", f.companyId)
            .where("id", "=", returnedId)
            .executeTakeFirstOrThrow();
          const receiptTags = {
            ...(unit.attributes as Record<string, string>)
          };
          delete receiptTags.Shipment;
          await f.db
            .updateTable("trackedEntity")
            .set({ itemId: null, attributes: receiptTags })
            .where("companyId", "=", f.companyId)
            .where("id", "=", returnedId)
            .execute();
        }
        const post = () =>
          invokePosting(
            handlesOf(f.ctx),
            "post-receipt",
            { type: "post", receiptId: rma.receiptId },
            postReceipt
          ).then(unwrap);
        if (scenario === "another customer") {
          const other = await f.db
            .insertInto("customer")
            .values({
              id: f.prefix + "-customer2",
              name: "Other customer",
              readableId: "Other",
              companyId: f.companyId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          // A selected unit whose shipment no longer proves this customer's ownership.
          await f.db
            .updateTable("shipment")
            .set({ customerId: other.id })
            .where("companyId", "=", f.companyId)
            .where("id", "=", actualShipment)
            .execute();
          await expect(post()).rejects.toThrow(/shipped to this customer/);
          expect(
            await f.db
              .selectFrom("itemLedger")
              .select("id")
              .where("companyId", "=", f.companyId)
              .where("documentId", "=", rma.receiptId)
              .execute()
          ).toEqual([]);
          return;
        }
        await post();
        const expected =
          scenario === "zero value"
            ? 0
            : scenario === "blind"
              ? 9
              : scenario === "new receipt serial on a linked return"
                ? 31
                : 40;
        expect(
          await f.db
            .selectFrom("costLedger")
            .select(["trackedEntityId", "cost", "remainingQuantity"])
            .where("companyId", "=", f.companyId)
            .where("documentId", "=", rma.receiptId)
            .execute()
        ).toEqual([
          { trackedEntityId: returnedId, cost: expected, remainingQuantity: 1 }
        ]);
      } finally {
        await f.cleanup();
      }
    }
  );
}
