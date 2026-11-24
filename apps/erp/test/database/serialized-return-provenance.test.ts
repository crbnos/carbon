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
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import { createPackedShipment } from "./fixtures/packout-shipment";
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
