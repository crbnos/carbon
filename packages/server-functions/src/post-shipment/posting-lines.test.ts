// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The shipment journal builders: the lines `post-shipment` writes and the
// legacy backfill rebuilds, from plain facts.

import { describe, expect, it } from "vitest";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import {
  buildReturnShipmentJournal,
  buildSalesShipmentJournal,
  type SalesShipmentLine,
  shippedQuantityByItem
} from "./posting-lines";

const defaults = {
  costOfGoodsSoldAccount: "COGS",
  goodsReceivedNotInvoicedAccount: "GRNI",
  rawMaterialsAccount: "RAW",
  finishedGoodsAccount: "FG"
};

const line = (
  overrides: Partial<SalesShipmentLine> & { shipmentLineId: string }
): SalesShipmentLine => ({
  itemId: "item-a",
  shippedQuantity: 1,
  itemTrackingType: "Inventory",
  replenishmentSystem: "Buy",
  itemPostingGroupId: "ipg-1",
  locationId: "loc-1",
  ...overrides
});

const salesShipment = (
  lines: SalesShipmentLine[],
  relievedCostByItem: Map<string, number>
) =>
  buildSalesShipmentJournal({
    shipmentId: "shp-1",
    shipmentReadableId: "SHP-001",
    externalDocumentId: "PO-77",
    customerId: "cust-1",
    customerTypeId: "ctype-1",
    defaults,
    lines,
    relievedCostByItem,
    fixedAssetSales: []
  });

describe("buildSalesShipmentJournal", () => {
  it("shares an item's relieved cost across its lines by quantity, the last line taking the remainder", () => {
    const lines = [
      line({ shipmentLineId: "sl-1", shippedQuantity: 1 }),
      line({ shipmentLineId: "sl-2", shippedQuantity: 2 })
    ];
    expect(shippedQuantityByItem(lines)).toEqual(new Map([["item-a", 3]]));

    const journal = salesShipment(lines, new Map([["item-a", 10]]));

    expect(journal.description).toBe("Sales Shipment SHP-001");
    expect(journal.sourceType).toBe("Sales Shipment");
    expect(
      journal.lines.map((l) => [
        l.documentLineReference,
        l.accountId,
        l.amount,
        l.quantity
      ])
    ).toEqual([
      ["shipment:sl-1", "COGS", 3.33333, 1],
      ["shipment:sl-1", "RAW", -3.33333, 1],
      ["shipment:sl-2", "COGS", 6.66667, 2],
      ["shipment:sl-2", "RAW", -6.66667, 2]
    ]);
    // Each pair shares one reference; the pairs do not.
    const [a, b, c, d] = journal.lines;
    expect(a!.journalLineReference).toBe(b!.journalLineReference);
    expect(c!.journalLineReference).toBe(d!.journalLineReference);
    expect(a!.journalLineReference).not.toBe(c!.journalLineReference);
    for (const l of journal.lines) {
      expect(l).toMatchObject({
        documentType: "Sales Shipment",
        documentId: "shp-1",
        externalDocumentId: "PO-77",
        dimensions: {
          Customer: "cust-1",
          CustomerType: "ctype-1",
          Item: "item-a",
          ItemPostingGroup: "ipg-1",
          Location: "loc-1"
        }
      });
    }
  });

  it("writes the pair at zero cost, and no pair for a Non-Inventory, unshipped or itemless line", () => {
    const journal = salesShipment(
      [
        line({
          shipmentLineId: "sl-1",
          itemId: "item-made",
          replenishmentSystem: "Make"
        }),
        line({
          shipmentLineId: "sl-2",
          itemId: "item-service",
          itemTrackingType: "Non-Inventory"
        }),
        line({ shipmentLineId: "sl-3", shippedQuantity: 0 }),
        line({ shipmentLineId: "sl-4", itemId: null })
      ],
      new Map([["item-made", 0]])
    );

    expect(
      journal.lines.map((l) => [l.accountId, l.description, l.amount])
    ).toEqual([
      ["COGS", "Cost of Goods Sold", 0],
      ["FG", "Finished Goods Account", 0]
    ]);
  });

  it("removes a sold fixed asset after the item pairs", () => {
    const journal = buildSalesShipmentJournal({
      shipmentId: "shp-1",
      shipmentReadableId: "SHP-001",
      externalDocumentId: null,
      customerId: "cust-1",
      customerTypeId: null,
      defaults,
      lines: [line({ shipmentLineId: "sl-1" })],
      relievedCostByItem: new Map([["item-a", 4]]),
      fixedAssetSales: [
        {
          salesOrderLineId: "sol-9",
          acquisitionCost: 1000,
          accumulatedDepreciation: 400,
          assetAccountId: "ASSET",
          accumulatedDepreciationAccountId: "ACCDEP",
          writeOffAccountId: "CLEARING",
          locationId: "loc-2",
          fixedAssetClassId: "fac-1"
        }
      ]
    });

    expect(
      journal.lines.map((l) => [
        l.documentLineReference,
        l.accountId,
        l.amount,
        l.quantity
      ])
    ).toEqual([
      ["shipment:sl-1", "COGS", 4, 1],
      ["shipment:sl-1", "RAW", -4, 1],
      ["shipment:sol-9", "ACCDEP", 400, 1],
      ["shipment:sol-9", "CLEARING", 600, 1],
      ["shipment:sol-9", "ASSET", -1000, 1]
    ]);
    expect(journal.lines[4]!.dimensions).toEqual({
      Customer: "cust-1",
      CustomerType: null,
      Location: "loc-2",
      FixedAssetClass: "fac-1"
    });
  });
});

describe("buildReturnShipmentJournal", () => {
  const items = [
    {
      itemId: "item-a",
      quantity: 2,
      cost: 7.5,
      replenishmentSystem: "Buy" as const,
      itemPostingGroupId: "ipg-1"
    },
    {
      itemId: "item-b",
      quantity: 1,
      cost: 0,
      replenishmentSystem: "Make" as const,
      itemPostingGroupId: null
    }
  ];
  const returnShipment = (
    sourceDocument: "Sales Return Order" | "Purchase Return Order"
  ) =>
    buildReturnShipmentJournal({
      sourceDocument,
      shipmentId: "shp-2",
      shipmentReadableId: "SHP-002",
      locationId: "loc-1",
      partyId: "party-1",
      partyTypeId: "ptype-1",
      defaults,
      items
    });

  it("debits COGS against inventory for a sales return, one pair per item, at zero cost too", () => {
    const journal = returnShipment("Sales Return Order");

    expect(journal.description).toBe("Return Shipment SHP-002");
    expect(journal.sourceType).toBe("Sales Return Shipment");
    expect(
      journal.lines.map((l) => [l.accountId, l.amount, l.quantity])
    ).toEqual([
      ["COGS", 7.5, 2],
      ["RAW", -7.5, 2],
      ["COGS", 0, 1],
      ["FG", 0, 1]
    ]);
    for (const l of journal.lines) {
      expect(l).toMatchObject({
        documentType: "Return Order",
        documentId: "shp-2",
        documentLineReference: "shipment:shp-2"
      });
    }
    expect(journal.lines[0]!.journalLineReference).toBe(
      journal.lines[1]!.journalLineReference
    );
    expect(journal.lines[0]!.dimensions).toEqual({
      Item: "item-a",
      ItemPostingGroup: "ipg-1",
      Location: "loc-1",
      Customer: "party-1",
      CustomerType: "ptype-1"
    });
  });

  it("debits GR/IR against inventory for a purchase return", () => {
    const journal = returnShipment("Purchase Return Order");

    expect(journal.description).toBe("Purchase Return Shipment SHP-002");
    expect(journal.sourceType).toBe("Purchase Return Shipment");
    expect(
      journal.lines.map((l) => [l.accountId, l.description, l.amount])
    ).toEqual([
      ["GRNI", "Goods Received Not Invoiced", -7.5],
      ["RAW", "Raw Materials Account", -7.5],
      ["GRNI", "Goods Received Not Invoiced", 0],
      ["FG", "Finished Goods Account", 0]
    ]);
    expect(journal.lines[0]!.dimensions).toEqual({
      Item: "item-a",
      ItemPostingGroup: "ipg-1",
      Location: "loc-1",
      Supplier: "party-1",
      SupplierType: "ptype-1"
    });
  });
});

describe("journalLineDimensionRows of a shipment journal", () => {
  it("writes a value only for an active dimension, in the line's order", () => {
    const journal = salesShipment(
      [line({ shipmentLineId: "sl-1", itemPostingGroupId: null })],
      new Map([["item-a", 1]])
    );
    const rows = journalLineDimensionRows({
      journalLineIds: ["jl-1", "jl-2"],
      lines: journal.lines,
      dimensionIdByEntity: new Map([
        ["Item", "dim-item"],
        ["Customer", "dim-customer"],
        ["ItemPostingGroup", "dim-ipg"]
      ]),
      companyId: "co-1"
    });

    expect(rows).toEqual([
      {
        journalLineId: "jl-1",
        dimensionId: "dim-customer",
        valueId: "cust-1",
        companyId: "co-1"
      },
      {
        journalLineId: "jl-1",
        dimensionId: "dim-item",
        valueId: "item-a",
        companyId: "co-1"
      },
      {
        journalLineId: "jl-2",
        dimensionId: "dim-customer",
        valueId: "cust-1",
        companyId: "co-1"
      },
      {
        journalLineId: "jl-2",
        dimensionId: "dim-item",
        valueId: "item-a",
        companyId: "co-1"
      }
    ]);
  });
});
