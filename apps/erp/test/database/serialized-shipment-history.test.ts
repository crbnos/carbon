// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { loadPackingSlipDocument } from "@carbon/lib/packing-slip-document.server";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { expect } from "vitest";
import {
  assignReceiptReturnEntity,
  assignShipmentLineEntity,
  getShipmentTracking
} from "../../app/modules/inventory/inventory.server";
import {
  postReceipt,
  postShipment
} from "../../app/modules/inventory/inventory.service";
import { setSalesReturnOrderLineDisposition } from "../../app/modules/sales/sales.server";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  stampCutover,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import { createPackedShipment } from "./fixtures/packout-shipment";
import {
  createLinkedSerialReturn,
  shipNormalAndWarranty,
  stockSerials
} from "./fixtures/serialized-sale";

postgrestTest(
  "a posted shipment keeps its line serials while a fresh draft picks a returned unit",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const [rich, cheap] = await stockSerials(f);
      const sale = await shipNormalAndWarranty(
        f,
        f.assemblyId,
        cheap!.id,
        rich!.id
      );
      const rma = await createLinkedSerialReturn(
        f,
        f.assemblyId,
        sale.shipmentLineId
      );
      const ctx = operationContext(f, client, USER);
      expect(
        (
          await assignReceiptReturnEntity(ctx, {
            receiptId: rma.receiptId,
            receiptLineId: rma.receiptLineId,
            trackedEntityId: cheap!.id,
            index: 0
          })
        ).error
      ).toBeNull();
      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "post-receipt",
          { type: "post", receiptId: rma.receiptId },
          postReceipt
        )
      );
      expect(
        (
          await setSalesReturnOrderLineDisposition(ctx, {
            lineId: rma.returnLineId,
            disposition: "Use As Is"
          })
        ).error
      ).toBeNull();
      const draft = await createPackedShipment(f, f.assemblyId, "resale");
      const read = async (shipmentId: string) => {
        const tracking = await getShipmentTracking(ctx, { shipmentId });
        expect(tracking.error).toBeNull();
        const slip = await loadPackingSlipDocument({
          client, serviceRole: client, companyId: f.companyId, shipmentId, locale: "en"
        });
        const byLine = (units: typeof slip.pdfProps.trackedEntities) =>
          Object.fromEntries(units.map((unit) => {
            const tags = unit.attributes as TrackedEntityAttributes;
            return [
              tags["Shipment Line"],
              [unit.id, unit.readableId, tags["Shipment Line Index"]]
            ];
          }));
        const saved = byLine(tracking.data ?? []);
        expect(byLine(slip.pdfProps.trackedEntities)).toEqual(saved);
        return saved;
      };
      const original = {
        [sale.shipmentLineId]: [cheap!.id, "SN-22", 0],
        [sale.warrantyLineId]: [rich!.id, "SN-40", 0]
      };
      expect(await read(sale.shipmentId)).toEqual(original);
      expect(
        (
          await assignShipmentLineEntity(ctx, {
            shipmentId: draft.shipmentId,
            shipmentLineId: draft.shipmentLineId,
            trackingType: "serial",
            trackedEntityId: cheap!.id,
            index: 0
          })
        ).error
      ).toBeNull();
      expect(await read(draft.shipmentId)).toEqual({
        [draft.shipmentLineId]: [cheap!.id, "SN-22", 0]
      });
      expect(await read(sale.shipmentId)).toEqual(original);
      const debits = await f.db
        .selectFrom("itemLedger")
        .select(["documentLineId", "trackedEntityId"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", sale.shipmentId)
        .where("documentType", "=", "Sales Shipment")
        .where("quantity", "=", -1)
        .execute();
      expect(debits).toHaveLength(2);
      expect(debits).toEqual(
        expect.arrayContaining([
          { documentLineId: sale.shipmentLineId, trackedEntityId: cheap!.id },
          { documentLineId: sale.warrantyLineId, trackedEntityId: rich!.id }
        ])
      );

      // Historical postings omitted the line. The unchanged warranty pick
      // identifies one line, leaving just one possible slot for the $22 unit.
      await f.db
        .updateTable("itemLedger")
        .set({ documentLineId: null })
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", sale.shipmentId)
        .where("documentType", "=", "Sales Shipment")
        .execute();
      expect(await read(sale.shipmentId)).toEqual(original);
      // Lose both legacy tags: neither same-SKU line can claim either debit.
      await f.db
        .updateTable("trackedEntity")
        .set({ attributes: {} })
        .where("companyId", "=", f.companyId)
        .where("id", "=", rich!.id)
        .execute();
      expect(await read(sale.shipmentId)).toEqual({});
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a multi-unit line preserves the clerk's scan slots in posted debit order",
  async (client) => {
    const f = await alwaysPostFixture();
    try {
      await stampCutover(f);
      const units = await stockSerials(f);
      const sale = await createPackedShipment(f, f.assemblyId, "two", "", 2);
      const ctx = operationContext(f, client, USER);
      // Pick the newer $22 unit in slot zero, the older $40 unit in slot one.
      for (const [index, unit] of [
        [1, units[0]!],
        [0, units[1]!]
      ] as const) {
        expect(
          (
            await assignShipmentLineEntity(ctx, {
              shipmentId: sale.shipmentId,
              shipmentLineId: sale.shipmentLineId,
              trackingType: "serial",
              trackedEntityId: unit.id,
              index
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
      const debits = await f.db
        .selectFrom("itemLedger")
        .select(["trackedEntityId", "documentLineId"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", sale.shipmentId)
        .where("documentType", "=", "Sales Shipment")
        .where("quantity", "=", -1)
        .orderBy("entryNumber")
        .execute();
      expect(debits).toEqual(
        [units[1]!, units[0]!].map((unit) => ({
          trackedEntityId: unit.id,
          documentLineId: sale.shipmentLineId
        }))
      );
      await f.db
        .updateTable("trackedEntity")
        .set({ attributes: {} })
        .where("companyId", "=", f.companyId)
        .where(
          "id",
          "in",
          units.map((u) => u.id)
        )
        .execute();
      const tracking = await getShipmentTracking(ctx, { shipmentId: sale.shipmentId });
      expect(tracking.error).toBeNull();
      expect(
        tracking.data?.map((u) => [
          u.id,
          u.readableId,
          (u.attributes as TrackedEntityAttributes)["Shipment Line Index"]
        ])
      ).toEqual([
        [units[1]!.id, "SN-22", 0],
        [units[0]!.id, "SN-40", 1]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
