// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  assignShipmentSerial,
  issueMaterial,
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
  shipPackedUnit
} from "./fixtures/packout-shipment";
import { confirmPackoutCommand, createPairedJob } from "./fixtures/paired-job";

async function stockSerials(f: Fixture) {
  await f.db
    .updateTable("item")
    .set({ itemTrackingType: "Serial" })
    .where("companyId", "=", f.companyId)
    .where("id", "=", f.assemblyId)
    .execute();
  const serials = [40, 22].map((cost) => ({
    cost,
    id: f.prefix + "-sn-" + cost,
    readableId: "SN-" + cost
  }));
  const common = { itemId: f.assemblyId, companyId: f.companyId, quantity: 1 };
  await f.db
    .insertInto("trackedEntity")
    .values(
      serials.map((unit) => ({
        ...common,
        id: unit.id,
        readableId: unit.readableId,
        sourceDocument: "Item",
        sourceDocumentId: f.assemblyId,
        status: "Available" as const,
        createdBy: USER
      }))
    )
    .execute();
  await f.db
    .insertInto("itemLedger")
    .values(
      serials.map((unit) => ({
        ...common,
        entryType: "Positive Adjmt." as const,
        locationId: f.locationId,
        trackedEntityId: unit.id,
        createdBy: USER
      }))
    )
    .execute();
  await f.db
    .insertInto("costLedger")
    .values(
      serials.map((unit) => ({
        ...common,
        cost: unit.cost,
        trackedEntityId: unit.id,
        remainingQuantity: 1,
        itemLedgerType: "Positive Adjmt." as const,
        costLedgerType: "Direct Cost" as const
      }))
    )
    .execute();
  return serials;
}

type Method = "FIFO" | "LIFO" | "Average" | "Standard";

async function packSerials(
  f: Fixture,
  method: Method,
  sources: Awaited<ReturnType<typeof stockSerials>>
) {
  const job = await createPairedJob(f, f.assemblyId, 2);
  await f.db
    .updateTable("itemCost")
    .set({ costingMethod: method, standardCost: 15 })
    .where("companyId", "=", f.companyId)
    .where("itemId", "=", job.salesItemId)
    .execute();
  const post = async (input: Parameters<typeof issueMaterial>[1]) =>
    unwrap(
      await invokePosting(
        handlesOf(f.ctx),
        "issue",
        await confirmPackoutCommand(f, input),
        issueMaterial
      )
    );
  const outputs: string[] = [];
  for (const source of sources) {
    const output = await f.db
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", f.companyId)
      .where("itemId", "=", job.salesItemId)
      .where(sql<boolean>`attributes->>'Job' = ${job.jobId}`)
      .where("readableId", "is", null)
      .executeTakeFirstOrThrow();
    outputs.push(output.id!);
    await post({
      type: "trackedEntitiesToOperation",
      jobOperationId: job.operationId,
      materialId: job.materialId,
      parentTrackedEntityId: output.id!,
      children: [{ trackedEntityId: source.id, quantity: 1 }]
    });
    await post({
      type: "jobOperationSerialComplete",
      jobOperationId: job.operationId,
      trackedEntityId: output.id!,
      quantity: 1
    });
    if (outputs.length === 1) {
      await sql`SELECT receive_job_to_inventory(
        ${job.jobId}, 1, ${f.companyId}, ${USER}, ${f.locationId}, NULL, ARRAY[${source.readableId}]::text[]
      )`.execute(f.db);
    }
  }
  return { itemId: job.salesItemId, outputs };
}

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
