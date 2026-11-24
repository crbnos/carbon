// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database; skipped without it.

// A new shipment line for an untracked item names a bin that holds the stock,
// so the post takes it from there. Before, a warehouse transfer line with no
// From bin and every return order line posted at "no storage unit", which went
// negative while the real bin kept its stock. A return draws held units
// (quarantine, rejected) first: returned and rejected stock is set aside there.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { invokeCreate } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER,
  unwrap
} from "./fixtures/always-post";
import { handlesOf } from "./fixtures/handles";
import { databaseTest, hasLocalDatabase } from "./fixtures/local-database";

describe.skipIf(!hasLocalDatabase)("shipment create source bins", () => {
  let f: Fixture;
  let binA: string;
  let binB: string;
  let quarantine: string;
  let otherBin: string;

  beforeAll(async () => {
    f = await alwaysPostFixture();
    binA = `${f.prefix}-a`;
    binB = `${f.prefix}-b`;
    quarantine = `${f.prefix}-q`;
    otherBin = `${f.prefix}-other`;
    await seed(f, (trx) =>
      trx
        .insertInto("storageUnit")
        .values([
          ...[binA, binB].map((id) => ({
            id,
            name: id,
            locationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          })),
          {
            id: quarantine,
            name: quarantine,
            locationId: f.locationId,
            nettable: false,
            effectiveNettable: false,
            companyId: f.companyId,
            createdBy: USER
          },
          {
            id: otherBin,
            name: otherBin,
            locationId: f.otherLocationId,
            companyId: f.companyId,
            createdBy: USER
          }
        ])
        .execute()
    );
  });

  afterAll(async () => {
    await f?.cleanup();
  });

  const newItem = async (key: string) => {
    const id = `${f.prefix}-item-${key}`;
    await seed(f, (trx) =>
      trx
        .insertInto("item")
        .values({
          id,
          readableId: id,
          name: id,
          type: "Part",
          itemTrackingType: "Inventory",
          replenishmentSystem: "Buy",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute()
    );
    return id;
  };

  const stock = (
    itemId: string,
    rows: {
      storageUnitId: string | null;
      quantity: number;
      locationId?: string;
      projectId?: string;
    }[]
  ) =>
    seed(f, (trx) =>
      trx
        .insertInto("itemLedger")
        .values(
          rows.map((row) => ({
            entryType: "Positive Adjmt." as const,
            documentType: "Direct Transfer" as const,
            itemId,
            locationId: row.locationId ?? f.locationId,
            storageUnitId: row.storageUnitId,
            projectId: row.projectId ?? null,
            quantity: row.quantity,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute()
    );

  const shipmentLineBins = async (shipmentId: string) =>
    (
      await f.db
        .selectFrom("shipmentLine")
        .select(["itemId", "storageUnitId", "shippedQuantity"])
        .where("shipmentId", "=", shipmentId)
        .where("companyId", "=", f.companyId)
        // Lines inserted together share a createdAt: order by quantity.
        .orderBy("shippedQuantity", "desc")
        .execute()
    ).map((line) => line.storageUnitId);

  const shipWarehouseTransfer = async (
    key: string,
    lines: { itemId: string; quantity: number; fromStorageUnitId?: string }[]
  ) => {
    const warehouseTransferId = `${f.prefix}-wt-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("warehouseTransfer")
        .values({
          id: warehouseTransferId,
          transferId: `WT-${key}`,
          fromLocationId: f.otherLocationId,
          toLocationId: f.locationId,
          status: "To Ship and Receive",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("warehouseTransferLine")
        .values(
          lines.map((line) => ({
            transferId: warehouseTransferId,
            itemId: line.itemId,
            quantity: line.quantity,
            fromLocationId: f.otherLocationId,
            fromStorageUnitId: line.fromStorageUnitId ?? null,
            toLocationId: f.locationId,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromWarehouseTransfer",
        warehouseTransferId
      })
    ) as { id: string };
    return shipmentLineBins(shipment.id);
  };

  const shipPurchaseReturn = async (
    key: string,
    lines: { itemId: string; quantity: number; purchaseOrderLineId?: string }[],
    beforeCreate?: (returnLineIds: string[]) => Promise<void>
  ) => {
    const returnId = `${f.prefix}-pro-${key}`;
    const returnLineIds = lines.map((_, i) => `${returnId}-line-${i}`);
    await seed(f, async (trx) => {
      await trx
        .insertInto("purchaseReturnOrder")
        .values({
          id: returnId,
          purchaseReturnOrderId: `PRO-${key}`,
          supplierId: f.supplierId,
          currencyCode: "USD",
          orderDate: f.today,
          locationId: f.locationId,
          status: "To Ship",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("purchaseReturnOrderLine")
        .values(
          lines.map((line, i) => ({
            id: returnLineIds[i],
            purchaseReturnOrderId: returnId,
            itemId: line.itemId,
            quantity: line.quantity,
            purchaseOrderLineId: line.purchaseOrderLineId ?? null,
            lineNumber: i + 1,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    await beforeCreate?.(returnLineIds);
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromPurchaseReturnOrder",
        purchaseReturnOrderId: returnId,
        locationId: f.locationId
      })
    ) as { id: string };
    return shipmentLineBins(shipment.id);
  };

  const shipSalesReturn = async (
    key: string,
    lines: { itemId: string; quantityReceived: number }[]
  ) => {
    const returnId = `${f.prefix}-rma-${key}`;
    await seed(f, async (trx) => {
      await trx
        .insertInto("salesReturnOrder")
        .values({
          id: returnId,
          salesReturnOrderId: `RMA-${key}`,
          customerId: f.customerId,
          currencyCode: "USD",
          orderDate: f.today,
          locationId: f.locationId,
          status: "Completed",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesReturnOrderLine")
        .values(
          lines.map((line) => ({
            salesReturnOrderId: returnId,
            itemId: line.itemId,
            quantity: line.quantityReceived,
            quantityReceived: line.quantityReceived,
            returnType: "Return to Stock" as const,
            disposition: "Return to Customer" as const,
            companyId: f.companyId,
            createdBy: USER
          }))
        )
        .execute();
    });
    const shipment = unwrap(
      await invokeCreate(handlesOf(f.ctx), {
        type: "shipmentFromSalesReturnOrder",
        salesReturnOrderId: returnId,
        locationId: f.locationId
      })
    ) as { id: string };
    return shipmentLineBins(shipment.id);
  };

  databaseTest(
    "a warehouse transfer line with no From bin ships from the bin that holds the stock",
    async () => {
      const item = await newItem("wt-no-bin");
      await stock(item, [
        { storageUnitId: otherBin, quantity: 5, locationId: f.otherLocationId },
        // Stock at the To location is not the From location's.
        { storageUnitId: binA, quantity: 50 }
      ]);
      expect(
        await shipWarehouseTransfer("no-bin", [{ itemId: item, quantity: 3 }])
      ).toEqual([otherBin]);
    }
  );

  databaseTest("a warehouse transfer line keeps the From bin it names", async () => {
    const item = await newItem("wt-named");
    await stock(item, [
      { storageUnitId: otherBin, quantity: 5, locationId: f.otherLocationId }
    ]);
    expect(
      await shipWarehouseTransfer("named", [
        { itemId: item, quantity: 3, fromStorageUnitId: binA }
      ])
    ).toEqual([binA]);
  });

  databaseTest(
    "two warehouse transfer lines of one item do not count the same stock",
    async () => {
      const item = await newItem("wt-two");
      await stock(item, [
        { storageUnitId: otherBin, quantity: 3, locationId: f.otherLocationId },
        { storageUnitId: null, quantity: 2, locationId: f.otherLocationId }
      ]);
      expect(
        await shipWarehouseTransfer("two", [
          { itemId: item, quantity: 3 },
          { itemId: item, quantity: 2 }
        ])
      ).toEqual([otherBin, null]);
    }
  );

  databaseTest(
    "a purchase return line ships from the quarantine unit before a fuller nettable bin",
    async () => {
      const item = await newItem("pro-held");
      await stock(item, [
        { storageUnitId: quarantine, quantity: 2 },
        { storageUnitId: binA, quantity: 20 }
      ]);
      expect(
        await shipPurchaseReturn("held", [{ itemId: item, quantity: 2 }])
      ).toEqual([quarantine]);
    }
  );

  databaseTest(
    "a purchase return line short in every held unit takes a bin that covers it",
    async () => {
      const item = await newItem("pro-short");
      await stock(item, [
        { storageUnitId: quarantine, quantity: 1 },
        { storageUnitId: binA, quantity: 2 },
        { storageUnitId: binB, quantity: 6 }
      ]);
      expect(
        await shipPurchaseReturn("short", [{ itemId: item, quantity: 4 }])
      ).toEqual([binB]);
    }
  );

  databaseTest(
    "a purchase return line with nothing in stock names no bin",
    async () => {
      const item = await newItem("pro-empty");
      expect(
        await shipPurchaseReturn("empty", [{ itemId: item, quantity: 2 }])
      ).toEqual([null]);
    }
  );

  databaseTest(
    "a purchase return line takes the stock of the project its purchase order line received into",
    async () => {
      const item = await newItem("pro-project");
      const projectId = `${f.prefix}-project`;
      const purchaseOrderId = `${f.prefix}-po-project`;
      const purchaseOrderLineId = `${f.prefix}-pol-project`;
      await seed(f, async (trx) => {
        await trx
          .insertInto("project")
          .values({
            id: projectId,
            name: "Stocked project",
            identifier: "SP",
            status: "Released",
            costTreatment: "Expense",
            projectStock: true,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: f.supplierId, companyId: f.companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("purchaseOrder")
          .values({
            id: purchaseOrderId,
            purchaseOrderId: "PO-project",
            supplierId: f.supplierId,
            supplierInteractionId: interaction.id,
            currencyCode: "USD",
            exchangeRate: 1,
            status: "To Receive and Invoice",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("purchaseOrderLine")
          .values({
            id: purchaseOrderLineId,
            purchaseOrderId,
            purchaseOrderLineType: "Part",
            itemId: item,
            purchaseQuantity: 10,
            supplierUnitPrice: 10,
            exchangeRate: 1,
            conversionFactor: 1,
            inventoryUnitOfMeasureCode: "EA",
            locationId: f.locationId,
            projectId,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
      });
      // Common stock in quarantine; the project's own stock in bin B.
      await stock(item, [
        { storageUnitId: quarantine, quantity: 10 },
        { storageUnitId: binB, quantity: 3, projectId }
      ]);
      expect(
        await shipPurchaseReturn("project", [
          { itemId: item, quantity: 2, purchaseOrderLineId }
        ])
      ).toEqual([binB]);
    }
  );

  databaseTest(
    "a purchase return line whose stock an inspection reject wrote off names no bin",
    async () => {
      const item = await newItem("pro-write-off");
      const inspectionId = `${f.prefix}-lot-write-off`;
      const ncrId = `${f.prefix}-ncr-write-off`;
      await stock(item, [{ storageUnitId: binA, quantity: 20 }]);
      const bins = await shipPurchaseReturn(
        "write-off",
        [{ itemId: item, quantity: 2 }],
        (returnLineIds) =>
          seed(f, async (trx) => {
            const type = await trx
              .insertInto("nonConformanceType")
              .values({
                name: `${f.prefix} write-off`,
                companyId: f.companyId,
                createdBy: USER
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            await trx
              .insertInto("nonConformance")
              .values({
                id: ncrId,
                nonConformanceId: `NCR-${f.prefix}`,
                name: "Rejected at receipt",
                source: "Internal",
                locationId: f.locationId,
                nonConformanceTypeId: type.id,
                openDate: f.today,
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            await trx
              .insertInto("inspection")
              .values({
                id: inspectionId,
                inspectionId: `${f.prefix}-INS-WO`,
                itemId: item,
                lotSize: 2,
                samplingStandard: "ANSI_Z1_4",
                samplingPlanType: "All",
                sampleSize: 2,
                acceptanceNumber: 0,
                rejectionNumber: 1,
                sourceDocument: "Receipt",
                sourceDocumentId: `${f.prefix}-receipt-wo`,
                sourceDocumentLineId: `${f.prefix}-receipt-line-wo`,
                storageUnitId: quarantine,
                status: "Failed",
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            await trx
              .insertInto("nonConformanceInspection")
              .values({
                nonConformanceId: ncrId,
                inspectionId,
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            await trx
              .insertInto("nonConformancePurchaseReturnOrderLine")
              .values({
                nonConformanceId: ncrId,
                purchaseReturnOrderId: `${f.prefix}-pro-write-off`,
                purchaseReturnOrderLineId: returnLineIds[0]!,
                purchaseReturnOrderReadableId: "PRO-write-off",
                quantity: 2,
                companyId: f.companyId,
                createdBy: USER
              })
              .execute();
            // The reject received 2 into quarantine and wrote them off there.
            await trx
              .insertInto("itemLedger")
              .values(
                [2, -2].map((quantity) => ({
                  entryType:
                    quantity > 0
                      ? ("Positive Adjmt." as const)
                      : ("Negative Adjmt." as const),
                  documentType: "Inbound Inspection" as const,
                  documentId: inspectionId,
                  itemId: item,
                  locationId: f.locationId,
                  storageUnitId: quarantine,
                  quantity,
                  companyId: f.companyId,
                  createdBy: USER
                }))
              )
              .execute();
          })
      );
      // The post puts the write-off back at no storage unit and ships from
      // the line's bin: both must be no storage unit, or they never net.
      expect(bins).toEqual([null]);
    }
  );

  databaseTest(
    "a sales return line ships from the unit the returned stock is held in",
    async () => {
      const item = await newItem("rma-held");
      await stock(item, [
        { storageUnitId: quarantine, quantity: 2 },
        { storageUnitId: binA, quantity: 20 }
      ]);
      expect(
        await shipSalesReturn("held", [{ itemId: item, quantityReceived: 2 }])
      ).toEqual([quarantine]);
    }
  );

  databaseTest(
    "a sales return line with nothing in stock names no bin",
    async () => {
      const item = await newItem("rma-empty");
      expect(
        await shipSalesReturn("empty", [{ itemId: item, quantityReceived: 2 }])
      ).toEqual([null]);
    }
  );
});
