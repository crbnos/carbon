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
import { invokePosting } from "../../app/modules/shared/shared.service";
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
      const options = await getShippedTrackedEntitiesForCustomer(
        client,
        f.companyId,
        f.customerId,
        f.assemblyId
      );
      expect(options.error).toBeNull();
      expect
        .soft(options.data?.map((row) => row.id).sort())
        .toEqual([cheap!.id, rich!.id].sort());
      const assign = (trackedEntityId: string) =>
        assignReceiptReturnEntity(ctx, {
          receiptId: rma.receiptId,
          receiptLineId: rma.receiptLineId,
          trackedEntityId,
          index: 0
        });
      for (const row of invalid)
        expect((await assign(row.id)).error).toBeTruthy();
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
