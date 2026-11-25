// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql, TableNode } from "kysely";
import { expect } from "vitest";
import {
  assignReceiptReturnEntity,
  getSerialNumbersForItem,
  getShipmentTracking,
  assignShipmentLineEntity
} from "../../app/modules/inventory/inventory.server";
import {
  postInventoryAdjustment,
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { getShippedTrackedEntitiesForCustomer } from "../../app/modules/sales/sales.service";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";
import {
  invokeCreate,
  invokePosting
} from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  stampCutover,
  unwrap,
  USER
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { connectLocalTestDatabase } from "./fixtures/local-database";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import { createPackedShipment, postPackedShipment } from "./fixtures/packout-shipment";
import {
  createLinkedSerialReturn,
  createNormalAndWarrantyShipment,
  stockSerials
} from "./fixtures/serialized-sale";

postgrestTest(
  "the linked receipt picker and assignment resolve legacy Item provenance from before the sale",
  async (client) => {
    const f = await alwaysPostFixture();
    const foreign = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const [rich, cheap] = await stockSerials(f);
      await f.db
        .updateTable("trackedEntity")
        .set({ itemId: null })
        .where("id", "=", rich!.id)
        .where("companyId", "=", f.companyId)
        .execute();
      const ctx = operationContext(f, client, USER);
      const sale = await createNormalAndWarrantyShipment(f, f.assemblyId);
      for (const [trackedEntityId, shipmentLineId] of [
        [rich!.id, sale.warrantyLineId],
        [cheap!.id, sale.shipmentLineId]
      ] as const) {
        expect(
          (
            await assignShipmentLineEntity(ctx, {
              shipmentId: sale.shipmentId,
              shipmentLineId,
              trackingType: "serial",
              trackedEntityId,
              index: 0
            })
          ).error
        ).toBeNull();
      }
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: sale.shipmentId },
          postShipment
        )
      );
      const rma = await createLinkedSerialReturn(
        f,
        f.assemblyId,
        sale.warrantyLineId
      );
      const draft = await createPackedShipment(f, f.assemblyId, "draft");
      const invalid = [
        {
          id: f.prefix + "-wrong-item",
          itemId: f.partId,
          sourceDocument: "Item",
          sourceDocumentId: f.assemblyId,
          companyId: f.companyId,
          attributes: { Shipment: sale.shipmentId }
        },
        {
          id: f.prefix + "-wrong-origin",
          itemId: null,
          sourceDocument: "Job",
          sourceDocumentId: f.assemblyId,
          companyId: f.companyId,
          attributes: { Shipment: sale.shipmentId }
        },
        {
          id: f.prefix + "-wrong-company",
          itemId: null,
          sourceDocument: "Item",
          sourceDocumentId: f.assemblyId,
          companyId: foreign.companyId,
          attributes: { Shipment: sale.shipmentId }
        },
        {
          id: f.prefix + "-unposted",
          itemId: null,
          sourceDocument: "Item",
          sourceDocumentId: f.assemblyId,
          companyId: f.companyId,
          attributes: { Shipment: draft.shipmentId }
        }
      ];
      await f.db
        .insertInto("trackedEntity")
        .values(
          invalid.map((row) => ({
            ...row,
            status: "Consumed" as const,
            quantity: 0,
            createdBy: USER
          }))
        )
        .execute();
      // A later draft tag cannot disown the genuine sale of this physical unit.
      await f.db
        .updateTable("trackedEntity")
        .set({ attributes: { Shipment: draft.shipmentId } })
        .where("companyId", "=", f.companyId)
        .where("id", "=", rich!.id)
        .execute();
      // Conversely, a stale posted-sale tag is insufficient if the unit left
      // stock by another route. Cover historic tag-only stock alongside it.
      const fallback = f.prefix + "-historic-tag";
      const otherUse = f.prefix + "-job-consumed";
      await f.db
        .insertInto("trackedEntity")
        .values(
          [fallback, otherUse].map((id) => ({
            id,
            companyId: f.companyId,
            itemId: null,
            sourceDocument: "Item" as const,
            sourceDocumentId: f.assemblyId,
            status: "Consumed" as const,
            quantity: 1,
            attributes: { Shipment: sale.shipmentId },
            createdBy: USER
          }))
        )
        .execute();
      await f.db
        .insertInto("itemLedger")
        .values({
          companyId: f.companyId,
          trackedEntityId: otherUse,
          itemId: f.assemblyId,
          documentType: "Job Consumption",
          entryType: "Consumption",
          quantity: -1,
          locationId: f.locationId,
          createdBy: USER
        })
        .execute();
      const options = await getShippedTrackedEntitiesForCustomer(
        client,
        f.db,
        f.companyId,
        f.customerId,
        f.assemblyId
      );
      expect(options.error).toBeNull();
      expect
        .soft(options.data?.map((row) => row.id).sort())
        .toEqual([cheap!.id, rich!.id, fallback].sort());
      const assign = (trackedEntityId: string) =>
        assignReceiptReturnEntity(ctx, {
          receiptId: rma.receiptId,
          receiptLineId: rma.receiptLineId,
          trackedEntityId,
          index: 0
        });
      expect((await assign(otherUse)).error).toBeTruthy();
      for (const row of invalid)
        expect((await assign(row.id)).error).toBeTruthy();
      await f.db
        .updateTable("trackedEntity")
        .set({ attributes: {} })
        .where("companyId", "=", f.companyId)
        .where("id", "=", rich!.id)
        .execute();
      expect((await assign(rich!.id)).error).toBeNull();
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "post", receiptId: rma.receiptId },
          postReceipt
        )
      );
      const docs = [sale.shipmentId, rma.receiptId];
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select(["documentId", "quantity", "trackedEntityId", "itemId"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "in", docs)
          .where("trackedEntityId", "=", rich!.id)
          .orderBy("entryNumber")
          .execute()
      ).toEqual(
        docs.map((documentId, i) => ({
          documentId,
          quantity: i === 0 ? -1 : 1,
          trackedEntityId: rich!.id,
          itemId: f.assemblyId
        }))
      );
      expect(
        await f.db
          .selectFrom("costLedger")
          .select([
            "documentId",
            "trackedEntityId",
            "cost",
            "remainingQuantity"
          ])
          .where("companyId", "=", f.companyId)
          .where("documentId", "in", docs)
          .where("trackedEntityId", "=", rich!.id)
          .orderBy("entryNumber")
          .execute()
      ).toEqual([
        {
          documentId: sale.shipmentId,
          trackedEntityId: rich!.id,
          cost: -40,
          remainingQuantity: 0
        },
        {
          documentId: rma.receiptId,
          trackedEntityId: rich!.id,
          cost: 40,
          remainingQuantity: 1
        }
      ]);
      expect(
        await f.db
          .selectFrom("journalLine as l")
          .innerJoin("journal as j", "j.id", "l.journalId")
          .select(["j.status", "l.amount", "l.documentLineReference"])
          .where("l.companyId", "=", f.companyId)
          .where("l.accountId", "=", f.account("finished-goods"))
          .where("l.documentId", "=", rma.receiptId)
          .execute()
      ).toEqual([
        {
          status: "Posted",
          amount: 40,
          documentLineReference: "receipt:" + rma.returnLineId
        }
      ]);
    } finally {
      await f.cleanup();
      await foreign.cleanup();
    }
  }
);

postgrestTest(
  "a corrected return finds its customer's serial after its draft shipment pick was replaced",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const [rich, cheap] = await stockSerials(f);
      const ctx = operationContext(f, client, USER);
      const original = await createPackedShipment(f, f.assemblyId, "original");
      const pick = (
        shipment: typeof original,
        trackedEntityId: string,
        expectedTrackedEntityId?: string
      ) =>
        assignShipmentLineEntity(ctx, {
          shipmentId: shipment.shipmentId,
          shipmentLineId: shipment.shipmentLineId,
          trackingType: "serial",
          trackedEntityId,
          expectedTrackedEntityId,
          index: 0
        }).then(unwrap);
      await pick(original, rich!.id);
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-shipment",
          { type: "post", shipmentId: original.shipmentId },
          postShipment
        )
      );
      const rma = await createLinkedSerialReturn(
        f,
        f.assemblyId,
        original.shipmentLineId
      );
      const assign = (receiptId: string, receiptLineId: string) =>
        assignReceiptReturnEntity(ctx, {
          receiptId,
          receiptLineId,
          trackedEntityId: rich!.id,
          index: 0
        });
      const post = (receiptId: string, type: "post" | "void") =>
        invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type, receiptId },
          postReceipt
        ).then(unwrap);
      unwrap(await assign(rma.receiptId, rma.receiptLineId));
      await post(rma.receiptId, "post");
      unwrap(
        await setSalesReturnOrderLineDisposition(ctx, {
          lineId: rma.returnLineId,
          disposition: "Use As Is"
        })
      );
      const draft = await createPackedShipment(f, f.assemblyId, "fresh");
      await pick(draft, rich!.id);
      await pick(draft, cheap!.id, rich!.id);
      await post(rma.receiptId, "void");
      const receipt = unwrap(
        await invokeCreate(handlesOf(f.ctx), {
          type: "receiptFromSalesReturnOrder",
          salesReturnOrderId: rma.rmaId,
          locationId: f.locationId
        })
      );
      const line = await f.db
        .selectFrom("receiptLine")
        .select("id")
        .where("receiptId", "=", receipt.id)
        .where("companyId", "=", f.companyId)
        .where("lineId", "=", rma.returnLineId)
        .executeTakeFirstOrThrow();
      const options = await getShippedTrackedEntitiesForCustomer(
        client,
        f.db,
        f.companyId,
        f.customerId,
        f.assemblyId
      );
      expect.soft(options.data?.map((row) => row.id)).toEqual([rich!.id]);
      unwrap(await assign(receipt.id, line.id));
      await post(receipt.id, "post");
      expect(
        await f.db
          .selectFrom("itemLedger")
          .select(["trackedEntityId", "quantity"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", receipt.id)
          .execute()
      ).toEqual([{ trackedEntityId: rich!.id, quantity: 1 }]);
      expect(
        await f.db
          .selectFrom("journalLine as l")
          .innerJoin("journal as j", "j.id", "l.journalId")
          .select(["l.amount", "j.status"])
          .where("l.companyId", "=", f.companyId)
          .where("l.documentId", "=", receipt.id)
          .where("l.accountId", "=", f.account("finished-goods"))
          .execute()
      ).toEqual([{ amount: 40, status: "Posted" }]);

      expect(
        await f.db
          .selectFrom("costLedger")
          .select(["cost", "trackedEntityId", "remainingQuantity"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", receipt.id)
          .execute()
      ).toEqual([
        { cost: 40, trackedEntityId: rich!.id, remainingQuantity: 1 }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

const returnTypes = [
  "Return to Stock",
  "Return for Service",
  "Return for Warranty"
] as const;
const shipBackCases: {
  returnType: (typeof returnTypes)[number];
  legacy: boolean;
  depotReceipt?: boolean;
  unwindLater?: (typeof returnTypes)[number];
  mismatchedBin?: boolean;
  resellAfterVoid?: "released" | "reclaimed";
}[] = returnTypes.flatMap((returnType) =>
  [false, true].map((legacy) => ({ returnType, legacy }))
);
for (const returnType of returnTypes) {
  for (const unwindLater of returnTypes) {
    shipBackCases.push({ returnType, legacy: false, unwindLater });
  }
}
shipBackCases.push(
  {
    returnType: "Return to Stock",
    legacy: false,
    unwindLater: "Return to Stock",
    mismatchedBin: true
  },
  { returnType: "Return for Warranty", legacy: true, depotReceipt: true },
  { returnType: "Return to Stock", legacy: true, resellAfterVoid: "released" },
  { returnType: "Return to Stock", legacy: true, resellAfterVoid: "reclaimed" }
);

for (const {
  returnType,
  legacy,
  depotReceipt,
  unwindLater,
  mismatchedBin,
  resellAfterVoid
} of shipBackCases) {
  postgrestTest(
    unwindLater
      ? mismatchedBin
        ? "a later receipt void in another bin cannot release an earlier ship-back"
        : `voiding the later ${unwindLater} receipt releases the earlier ${returnType} ship-back`
      : resellAfterVoid === "released"
        ? "Use As Is releases a voided return shipment's serial for an ordinary sale"
        : resellAfterVoid === "reclaimed"
          ? "a sale cannot reclaim a released return serial after its stock was issued"
          : depotReceipt
            ? "a later stockless depot receipt prevents voiding its serial's ship-back"
            : legacy
              ? "a " +
                returnType +
                " ship-back can be replaced until the legacy serial is received again"
              : "the RMA ships its serial back after " + returnType,
    async (client) => {
      const f = await alwaysPostFixture();
      try {
        await stampCutover(f);
        const [unit] = await stockSerials(f, [40]);
        const checkAverage =
          returnType === "Return to Stock" &&
          unwindLater === "Return to Stock" &&
          !mismatchedBin;
        const setAverageRate = (unitCost: number) =>
          f.db
            .updateTable("itemCost")
            .set({ costingMethod: "Average", unitCost })
            .where("companyId", "=", f.companyId)
            .where("itemId", "=", f.assemblyId)
            .execute();
        if (checkAverage) await setAverageRate(40);
        const ctx = operationContext(f, client, USER);
        const pick = (shipmentId: string, shipmentLineId: string, index = 0) =>
          assignShipmentLineEntity(ctx, {
            trackingType: "serial",
            shipmentId,
            shipmentLineId,
            trackedEntityId: unit!.id,
            index
          });
        // A production unit can name its job as provenance and its SKU via itemId.
        await f.db
          .updateTable("trackedEntity")
          .set(
            legacy
              ? { itemId: null }
              : { sourceDocument: "Job", sourceDocumentId: f.prefix + "-job" }
          )
          .where("companyId", "=", f.companyId)
          .where("id", "=", unit!.id)
          .execute();
        const sale = await createPackedShipment(f, f.assemblyId, "sold");
        expect(
          (await pick(sale.shipmentId, sale.shipmentLineId)).error
        ).toBeNull();
        await postPackedShipment(f, sale, f.assemblyId, unit!.id);
        const rma = await createLinkedSerialReturn(
          f,
          f.assemblyId,
          sale.shipmentLineId
        );
        const serviced = returnType !== "Return to Stock";
        if (serviced || (unwindLater && unwindLater !== "Return to Stock")) {
          await f.db
            .insertInto("sequence")
            .values({
              table: "serviceJob",
              name: "Service Job",
              prefix: "SJ-",
              companyId: f.companyId
            })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
        if (serviced) {
          await f.db
            .updateTable("salesReturnOrderLine")
            .set({ returnType })
            .where("id", "=", rma.returnLineId)
            .where("companyId", "=", f.companyId)
            .execute();
        }
        expect(
          (
            await assignReceiptReturnEntity(ctx, {
              receiptId: rma.receiptId,
              receiptLineId: rma.receiptLineId,
              trackedEntityId: unit!.id,
              index: 0
            })
          ).error
        ).toBeNull();
        const handles = handlesOf(f.ctx);
        unwrap(
          await invokePosting(
            handles,
            "post-receipt",
            { type: "post", receiptId: rma.receiptId },
            postReceipt
          )
        );
        if (serviced) {
          await f.db
            .updateTable("serviceJob")
            .set({
              status: "Completed",
              repairable: true,
              // A service job may name its physical serial without an asset record.
              ...(returnType === "Return for Warranty"
                ? { customerAssetId: null }
                : {})
            })
            .where("salesReturnOrderLineId", "=", rma.returnLineId)
            .where("companyId", "=", f.companyId)
            .returning("id")
            .executeTakeFirstOrThrow();
        } else {
          expect(
            (
              await setSalesReturnOrderLineDisposition(ctx, {
                lineId: rma.returnLineId,
                disposition: "Return to Customer"
              })
            ).error
          ).toBeNull();
        }
        const options = await getSerialNumbersForItem(ctx, {
          itemId: f.assemblyId,
          salesReturnOrderId: rma.rmaId
        });
        expect(options.data).toEqual([
          expect.objectContaining({
            id: unit!.id,
            status: serviced ? "Available" : "On Hold"
          })
        ]);
        const ordinary = await createPackedShipment(
          f,
          f.assemblyId,
          "ordinary"
        );
        expect(
          (await pick(ordinary.shipmentId, ordinary.shipmentLineId)).error
        ).toBeTruthy();
        const createShipBack = async () => {
          const shipment = unwrap(
            await invokeCreate(handles, {
              type: "shipmentFromSalesReturnOrder",
              salesReturnOrderId: rma.rmaId,
              locationId: f.locationId
            })
          );
          const line = await f.db
            .selectFrom("shipmentLine")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("shipmentId", "=", shipment.id)
            .where("lineId", "=", rma.returnLineId)
            .executeTakeFirstOrThrow();
          return { shipmentId: shipment.id, shipmentLineId: line.id };
        };
        const postShipBack = (shipmentId: string, type: "post" | "void") =>
          invokePosting(
            handles,
            "post-shipment",
            { type, shipmentId },
            postShipment
          );
        let shipBack = await createShipBack();
        const resize = (quantity: number) =>
          f.db
            .updateTable("shipmentLine")
            .set({ shippedQuantity: quantity })
            .where("companyId", "=", f.companyId)
            .where("id", "=", shipBack.shipmentLineId)
            .execute();
        await resize(2);
        expect(
          (await pick(shipBack.shipmentId, shipBack.shipmentLineId)).error
        ).toBeNull();
        expect(
          (await pick(shipBack.shipmentId, shipBack.shipmentLineId, 1)).error
            ?.message
        ).toMatch(/already assigned/);
        await resize(1);
        unwrap(await postShipBack(shipBack.shipmentId, "post"));
        if (legacy) {
          const voided = shipBack;
          const pending = await createLinkedSerialReturn(
            f,
            f.assemblyId,
            shipBack.shipmentLineId
          );
          unwrap(
            await assignReceiptReturnEntity(ctx, {
              receiptId: pending.receiptId,
              receiptLineId: pending.receiptLineId,
              trackedEntityId: unit!.id,
              index: 0
            })
          );
          // The second receipt has read its picks and locked its header.
          // Let the first shipment's void take the physical serial first.
          const receiptConnection = await connectLocalTestDatabase();
          try {
            const headerLock = new WeakSet<object>();
            const db = receiptConnection.withPlugin({
              transformQuery({ node, queryId }) {
                if (node.kind === "SelectQueryNode") {
                  const table = node.from?.froms[0];
                  if (
                    table &&
                    TableNode.is(table) &&
                    table.table.identifier.name === "receipt" &&
                    node.endModifiers?.some(
                      (modifier) => modifier.modifier === "ForUpdate"
                    )
                  ) {
                    headerLock.add(queryId);
                  }
                }
                return node;
              },
              async transformResult({ queryId, result }) {
                if (headerLock.has(queryId))
                  unwrap(await postShipBack(shipBack.shipmentId, "void"));
                return result;
              }
            });
            const staleReceipt = await invokePosting(
              { ...handles, db },
              "post-receipt",
              { type: "post", receiptId: pending.receiptId },
              postReceipt
            );
            expect(staleReceipt.error?.message).toMatch(/no longer shipped/);
          } finally {
            await receiptConnection.destroy();
          }
          // A returned stock serial is held until release. A depot unit
          // is Available to its customer, but carries no saleable stock.
          expect(
            (await pick(ordinary.shipmentId, ordinary.shipmentLineId)).error
          ).toBeTruthy();
          if (resellAfterVoid) {
            unwrap(
              await setSalesReturnOrderLineDisposition(ctx, {
                lineId: rma.returnLineId,
                disposition: "Use As Is"
              })
            );
            if (resellAfterVoid === "reclaimed") {
              // A stale Available tag cannot resell a unit after it left stock.
              await f.db
                .insertInto("itemLedger")
                .values({
                  companyId: f.companyId,
                  locationId: f.locationId,
                  itemId: f.assemblyId,
                  trackedEntityId: unit!.id,
                  entryType: "Negative Adjmt.",
                  quantity: -1,
                  createdBy: USER
                })
                .execute();
              expect(
                (await pick(ordinary.shipmentId, ordinary.shipmentLineId)).error
                  ?.message
              ).toMatch(/already assigned/);
              return;
            }
            expect(
              unwrap(
                await getSerialNumbersForItem(ctx, {
                  itemId: f.assemblyId,
                  stockShipment: true
                })
              )
            ).toEqual([
              expect.objectContaining({ id: unit!.id, status: "Available" })
            ]);
            unwrap(await pick(ordinary.shipmentId, ordinary.shipmentLineId));
            const competing = await createPackedShipment(
              f,
              f.assemblyId,
              "competing"
            );
            expect(
              (await pick(competing.shipmentId, competing.shipmentLineId)).error
                ?.message
            ).toMatch(/already assigned/);
            await postPackedShipment(f, ordinary, f.assemblyId, unit!.id);
            return;
          }
          if (returnType === "Return to Stock") {
            // A void recorded by an earlier version has no slot snapshot.
            await f.db
              .updateTable("trackedActivity")
              .set({ attributes: sql`attributes - 'Shipment Slots'` })
              .where("sourceDocumentId", "=", voided.shipmentId)
              .where("type", "=", "Void Shipment")
              .where("companyId", "=", f.companyId)
              .execute();
          }
          shipBack = await createShipBack();
          unwrap(await pick(shipBack.shipmentId, shipBack.shipmentLineId));
          const history = unwrap(
            await getShipmentTracking(ctx, { shipmentId: voided.shipmentId })
          );
          expect(history).toEqual([
            expect.objectContaining({
              id: unit!.id,
              attributes: expect.objectContaining({
                Shipment: voided.shipmentId,
                "Shipment Line": voided.shipmentLineId,
                "Shipment Line Index": 0
              })
            })
          ]);
          unwrap(await postShipBack(shipBack.shipmentId, "post"));
        }
        const moves = await f.db
          .selectFrom("itemLedger")
          .select(["trackedEntityId", "quantity"])
          .where("companyId", "=", f.companyId)
          .where("documentId", "=", shipBack.shipmentId)
          .where("documentType", "=", "Sales Return Shipment")
          .execute();
        expect(moves).toEqual(
          serviced ? [] : [{ trackedEntityId: unit!.id, quantity: -1 }]
        );
        // A second RMA receives the same serial from the return shipment.
        const again = await createLinkedSerialReturn(
          f,
          f.assemblyId,
          shipBack.shipmentLineId
        );
        const laterType =
          unwindLater ??
          (depotReceipt ? "Return for Warranty" : "Return to Stock");
        if (laterType !== "Return to Stock") {
          await f.db
            .updateTable("salesReturnOrderLine")
            .set({ returnType: laterType })
            .where("id", "=", again.returnLineId)
            .where("companyId", "=", f.companyId)
            .execute();
        }
        expect(
          (
            await getShippedTrackedEntitiesForCustomer(
              client,
              f.db,
              f.companyId,
              f.customerId,
              f.assemblyId
            )
          ).data
        ).toEqual([expect.objectContaining({ id: unit!.id })]);
        expect(
          (
            await assignReceiptReturnEntity(ctx, {
              receiptId: again.receiptId,
              receiptLineId: again.receiptLineId,
              trackedEntityId: unit!.id,
              index: 0
            })
          ).error
        ).toBeNull();
        unwrap(
          await invokePosting(
            handles,
            "post-receipt",
            { type: "post", receiptId: again.receiptId },
            postReceipt
          )
        );
        // The second receipt owns this unit. Reversing the earlier ship-back
        // would either duplicate its stock or release its inspection hold.
        const staleVoid = await postShipBack(shipBack.shipmentId, "void");
        expect(staleVoid.error?.message).toMatch(/unit has moved/i);
        const physical = () =>
          f.db
            .selectFrom("trackedEntity")
            .select(["id", "status", "attributes"])
            .where("companyId", "=", f.companyId)
            .where("id", "=", unit!.id)
            .executeTakeFirstOrThrow();
        const onHand = () =>
          f.db
            .selectFrom("itemLedger")
            .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
            .where("trackedEntityId", "=", unit!.id)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
            .then((row) => Number(row.quantity));
        expect((await physical()).status).toBe(
          laterType === "Return to Stock" ? "On Hold" : "Available"
        );
        expect(await onHand()).toBe(laterType === "Return to Stock" ? 1 : 0);
        const priorShipment = await f.db
          .selectFrom("shipment")
          .select("status")
          .where("id", "=", shipBack.shipmentId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
        expect(priorShipment.status).toBe("Posted");
        if (unwindLater) {
          unwrap(
            await invokePosting(
              handles,
              "post-receipt",
              { type: "void", receiptId: again.receiptId },
              postReceipt
            )
          );
          expect((await physical()).status).toBe("Consumed");
          expect(await onHand()).toBe(0);

          if (mismatchedBin) {
            // A legacy reversal restored the document total but drew the
            // serial from another bin. The two movements do not cancel there.
            const bin = await f.db
              .insertInto("storageUnit")
              .values({
                name: "Other bin",
                locationId: f.locationId,
                companyId: f.companyId,
                createdBy: USER
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            await f.db
              .updateTable("itemLedger")
              .set({ storageUnitId: bin.id })
              .where("companyId", "=", f.companyId)
              .where("documentId", "=", again.receiptId)
              .where("trackedEntityId", "=", unit!.id)
              .where("quantity", "=", -1)
              .returning("id")
              .executeTakeFirstOrThrow();
            expect(
              (await postShipBack(shipBack.shipmentId, "void")).error?.message
            ).toMatch(/unit has moved/i);
            expect((await physical()).status).toBe("Consumed");
            expect(await onHand()).toBe(0);
            return;
          }
          if (checkAverage) {
            // Only the other $22 serial is on the shelf when the $40 unit comes back.
            await setAverageRate(22);
            unwrap(
              await invokePosting(
                handles,
                "post-inventory-adjustment",
                {
                  adjustmentType: "Positive Adjmt.",
                  itemId: f.assemblyId,
                  locationId: f.locationId,
                  trackedEntityId: f.prefix + "-other",
                  readableId: "OTHER",
                  quantity: 1
                },
                postInventoryAdjustment
              )
            );
          }
          unwrap(await postShipBack(shipBack.shipmentId, "void"));
          expect(await physical()).toMatchObject({
            id: unit!.id,
            status: serviced ? "Available" : "On Hold",
            attributes: {
              Receipt: rma.receiptId,
              "Receipt Line": rma.receiptLineId
            }
          });
          expect(await onHand()).toBe(serviced ? 0 : 1);
          expect(
            await f.db
              .selectFrom("shipment")
              .select("status")
              .where("companyId", "=", f.companyId)
              .where("id", "=", shipBack.shipmentId)
              .executeTakeFirstOrThrow()
          ).toEqual({ status: "Voided" });
          if (checkAverage) {
            expect(
              (
                await sql`SELECT "quantityOnHand", "unitCost", "totalValue"
              FROM get_inventory_valuation(${f.companyId}) WHERE "itemId" = ${f.assemblyId}`.execute(
                  f.db
                )
              ).rows
            ).toEqual([{ quantityOnHand: 2, unitCost: 31, totalValue: 62 }]);
            expect(
              await f.db
                .selectFrom("journalLine as l")
                .innerJoin("journal as j", "j.id", "l.journalId")
                .select("l.amount")
                .where("l.companyId", "=", f.companyId)
                .where("j.companyId", "=", f.companyId)
                .where("j.status", "=", "Posted")
                .where("l.documentId", "=", shipBack.shipmentId)
                .where("l.accountId", "=", f.account("finished-goods"))
                .orderBy("l.amount")
                .execute()
            ).toEqual([{ amount: -40 }, { amount: 40 }]);
          }
          return;
        }
        if (depotReceipt) {
          // Legacy depot shipments lacked the stock entry number. Even when
          // live tags no longer identify the second RMA, its posted receipt
          // proves custody of this exact unit moved on from the first one.
          await f.db
            .updateTable("trackedActivity")
            .set({ attributes: sql`attributes - 'Stock Entry Number'` })
            .where("sourceDocumentId", "=", shipBack.shipmentId)
            .where("type", "=", "Return Shipment")
            .where("companyId", "=", f.companyId)
            .execute();
          await f.db
            .updateTable("trackedEntity")
            .set({
              status: "Consumed",
              attributes: sql`attributes - 'Receipt' - 'Receipt Line' - 'Receipt Line Index'`
            })
            .where("id", "=", unit!.id)
            .where("companyId", "=", f.companyId)
            .execute();
          const legacyVoid = await postShipBack(shipBack.shipmentId, "void");
          expect(legacyVoid.error?.message).toMatch(/unit has moved/i);
          return;
        }
        expect(
          (
            await setSalesReturnOrderLineDisposition(ctx, {
              lineId: again.returnLineId,
              disposition: "Use As Is"
            })
          ).error
        ).toBeNull();
        expect(
          (
            await getSerialNumbersForItem(ctx, {
              itemId: f.assemblyId,
              stockShipment: true
            })
          ).data
        ).toEqual([
          expect.objectContaining({ id: unit!.id, status: "Available" })
        ]);
        if (legacy) {
          // Earlier ship-backs recorded movements without immutable slots.
          await f.db
            .updateTable("trackedActivity")
            .set({ attributes: sql`attributes - 'Shipment Slots'` })
            .where("companyId", "=", f.companyId)
            .where("sourceDocument", "=", "Shipment")
            .where("sourceDocumentId", "=", shipBack.shipmentId)
            .where("type", "=", "Return Shipment")
            .execute();
        }
        expect(
          (await pick(ordinary.shipmentId, ordinary.shipmentLineId)).error
        ).toBeNull();
        // The draft owns the live tags. The posted ship-back still shows the
        // same physical serial in its original line and slot.
        const originalSlot = expect.objectContaining({
          id: unit!.id,
          readableId: unit!.readableId,
          attributes: expect.objectContaining({
            Shipment: shipBack.shipmentId,
            "Shipment Line": shipBack.shipmentLineId,
            "Shipment Line Index": 0
          })
        });
        const shipBackHistory = () =>
          getShipmentTracking(ctx, { shipmentId: shipBack.shipmentId }).then(
            unwrap
          );
        expect(await shipBackHistory()).toEqual([originalSlot]);
        await postPackedShipment(f, ordinary, f.assemblyId, unit!.id);
        expect(await shipBackHistory()).toEqual([originalSlot]);
      } finally {
        await f.cleanup();
      }
    }
  );
}
