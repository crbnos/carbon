import { describe, expect, it } from "vitest";

import type { NetSuiteSnapshot } from "../extract/run.ts";
import { mapAccountType } from "./account-type.ts";
import { mapSnapshotToPlan } from "./index.ts";
import { mapItemType } from "./item-type.ts";

function snapshot(overrides: Partial<NetSuiteSnapshot> = {}): NetSuiteSnapshot {
  return {
    accountId: "1234567",
    sandbox: false,
    extractedAt: "2026-09-12T00:00:00.000Z",
    subsidiaryId: null,
    probe: {
      oneWorld: false,
      subsidiaries: [],
      addressTables: {
        book: "customeraddressbook",
        address: "customeraddressbookentityaddress",
        entityColumn: "entity"
      },
      inventoryTable: "inventorybalance",
      bomComponentTable: "bomrevisioncomponentmember",
      unitsOfMeasureTable: "unitstypeuom",
      notes: []
    },
    currencies: [],
    unitsOfMeasure: [],
    paymentTerms: [],
    shippingMethods: [],
    locations: [],
    departments: [],
    accounts: [],
    customerCategories: [],
    vendorCategories: [],
    customers: [],
    customerAddresses: [],
    vendors: [],
    vendorAddresses: [],
    contacts: [],
    items: [],
    itemVendors: [],
    itemPrices: [],
    bomLines: [],
    inventoryBalances: [],
    salesOrderLines: [],
    purchaseOrderLines: [],
    gapCounts: {},
    notes: [],
    ...overrides
  };
}

describe("mapItemType", () => {
  it("makes an assembly a Make part", () => {
    const mapping = mapItemType("Assembly", { isLot: false, isSerial: false });
    expect(mapping).toEqual({
      type: "Part",
      itemTrackingType: "Inventory",
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order"
    });
  });

  it("takes tracking from the lot/serial flags, not the type name", () => {
    expect(
      mapItemType("InvtPart", { isLot: true, isSerial: false })
        ?.itemTrackingType
    ).toBe("Batch");
    expect(
      mapItemType("InvtPart", { isLot: false, isSerial: true })
        ?.itemTrackingType
    ).toBe("Serial");
    // Serial wins when an account somehow flags both.
    expect(
      mapItemType("InvtPart", { isLot: true, isSerial: true })?.itemTrackingType
    ).toBe("Serial");
  });

  it("never stocks a non-inventory or service item", () => {
    expect(
      mapItemType("NonInvtPart", { isLot: false, isSerial: false })
    ).toMatchObject({
      type: "Consumable",
      itemTrackingType: "Non-Inventory"
    });
    expect(
      mapItemType("Service", { isLot: false, isSerial: false })
    ).toMatchObject({
      type: "Service",
      itemTrackingType: "Non-Inventory"
    });
  });

  it("skips kits, transaction-line devices and anything unrecognized", () => {
    for (const type of [
      "Kit",
      "Group",
      "Discount",
      "Subtotal",
      "SomethingNew"
    ]) {
      expect(
        mapItemType(type, { isLot: false, isSerial: false }),
        type
      ).toBeNull();
    }
  });
});

describe("mapAccountType", () => {
  it("classifies the posting types", () => {
    expect(mapAccountType("COGS")).toEqual({
      class: "Expense",
      incomeBalance: "Income Statement",
      accountType: "Cost of Goods Sold"
    });
    expect(mapAccountType("AcctРec")).toBeNull(); // a typo must not resolve
    expect(mapAccountType("AcctRec")?.accountType).toBe("Accounts Receivable");
  });

  it("returns null for non-posting and statistical accounts", () => {
    expect(mapAccountType("NonPosting")).toBeNull();
    expect(mapAccountType("Stat")).toBeNull();
    expect(mapAccountType(null)).toBeNull();
  });
});

describe("mapSnapshotToPlan", () => {
  it("reads the ISO code from the currency's symbol column, not its name", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        currencies: [
          {
            id: "1",
            symbol: "usd",
            name: "US Dollar",
            currencyprecision: "2",
            isinactive: "F"
          }
        ]
      })
    );
    expect(plan.currencies[0]).toMatchObject({
      code: "USD",
      decimalPlaces: 2,
      active: true
    });
  });

  it("collapses two units types that both define the same code", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        unitsOfMeasure: [
          { id: "1", unitname: "Each", abbreviation: "ea", unitstype: "1" },
          { id: "2", unitname: "Each", abbreviation: "EA", unitstype: "2" }
        ]
      })
    );
    expect(plan.unitsOfMeasure).toHaveLength(1);
  });

  it("derives units from the items when the unit tables could not be read", () => {
    const { plan, notes } = mapSnapshotToPlan(
      snapshot({
        items: [
          {
            id: "10",
            itemid: "P-1",
            itemtype: "InvtPart",
            stock_unit: "KG",
            purchase_unit: "KG",
            sale_unit: "EA"
          }
        ]
      })
    );
    expect(plan.unitsOfMeasure.map((u) => u.code).sort()).toEqual(["EA", "KG"]);
    expect(notes.join(" ")).toContain("derived from the items");
  });

  it("treats a date-driven payment term as Day of Month", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        paymentTerms: [
          {
            id: "1",
            name: "Net 30",
            daysuntilnetdue: "30",
            datedriven: "F",
            isinactive: "F"
          },
          {
            id: "2",
            name: "15th",
            dayofmonthnetdue: "15",
            datedriven: "T",
            isinactive: "F"
          },
          {
            id: "3",
            name: "Old",
            daysuntilnetdue: "10",
            datedriven: "F",
            isinactive: "T"
          }
        ]
      })
    );
    expect(plan.paymentTerms).toHaveLength(2);
    expect(plan.paymentTerms[0]).toMatchObject({
      calculationMethod: "Net",
      daysDue: 30
    });
    expect(plan.paymentTerms[1]).toMatchObject({
      calculationMethod: "Day of Month",
      daysDue: 15
    });
  });

  it("recognizes the carriers it can and calls the rest Other", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        shippingMethods: [
          { id: "1", displayname: "UPS Ground", isinactive: "F" },
          { id: "2", displayname: "Our own truck", isinactive: "F" }
        ]
      })
    );
    expect(plan.shippingMethods.map((m) => m.carrier)).toEqual([
      "UPS",
      "Other"
    ]);
  });

  it("attaches addresses and contacts to their party", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        customers: [
          { id: "100", companyname: "Acme", entityid: "C100", isinactive: "F" }
        ],
        customerAddresses: [
          {
            entity_id: "100",
            label: "Billing",
            address_id: "900",
            addr1: "1 Main St",
            city: "Austin",
            state: "TX",
            zip: "78701",
            country: "US",
            defaultbilling: "T"
          }
        ],
        contacts: [
          {
            id: "500",
            company: "100",
            firstname: "Dana",
            lastname: "Reed",
            email: "d@acme.test"
          },
          { id: "501", company: "999", firstname: "Nobody", lastname: "Else" }
        ]
      })
    );

    const customer = plan.customers[0];
    expect(customer?.addresses).toHaveLength(1);
    expect(customer?.addresses[0]).toMatchObject({
      name: "Billing",
      countryCode: "US"
    });
    expect(customer?.contacts.map((c) => c.firstName)).toEqual(["Dana"]);
    expect(customer?.statusName).toBe("Active");
  });

  it("takes a customer's name from whichever column NetSuite filled in", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        customers: [
          { id: "1", companyname: "Acme" },
          { id: "2", isperson: "T", firstname: "Dana", lastname: "Reed" },
          { id: "3", entityid: "C003" }
        ]
      })
    );
    expect(plan.customers.map((c) => c.name)).toEqual([
      "Acme",
      "Dana Reed",
      "C003"
    ]);
  });

  it("uses the base price level and ignores quantity breaks", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        items: [
          { id: "10", itemid: "P-1", itemtype: "InvtPart", stock_unit: "EA" }
        ],
        itemPrices: [
          { item: "10", pricelevel: "1", qty_break: "0", unitprice: "9.5" },
          { item: "10", pricelevel: "1", qty_break: "100", unitprice: "7.5" }
        ]
      })
    );
    expect(plan.items[0]?.unitSalePrice).toBe(9.5);
  });

  it("records the skipped item types as gap examples rather than losing them", () => {
    const { plan, gaps } = mapSnapshotToPlan(
      snapshot({
        items: [
          { id: "1", itemid: "K-1", itemtype: "Kit" },
          { id: "2", itemid: "K-2", itemtype: "Kit" },
          { id: "3", itemid: "P-1", itemtype: "InvtPart" }
        ]
      })
    );
    expect(plan.items).toHaveLength(1);
    const kitGap = gaps.find((gap) => gap.id === "NS-ITM-002");
    expect(kitGap?.examples).toEqual(["2× Kit"]);
  });

  it("drops a BOM line whose component was not migrated", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        items: [
          { id: "1", itemid: "ASM", itemtype: "Assembly" },
          { id: "2", itemid: "CMP", itemtype: "InvtPart" }
        ],
        bomLines: [
          {
            assembly_item_id: "1",
            revision_id: "50",
            line_no: "1",
            component_item_id: "2",
            qty_per: "3"
          },
          {
            assembly_item_id: "1",
            revision_id: "50",
            line_no: "2",
            component_item_id: "99",
            qty_per: "1"
          }
        ]
      })
    );
    expect(plan.billsOfMaterial).toHaveLength(1);
    expect(plan.billsOfMaterial[0]?.lines).toEqual([
      {
        componentItemExternalId: "2",
        quantity: 3,
        order: 1,
        scrapPercentage: null
      }
    ]);
  });

  it("groups an order's lines under one header", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        customers: [{ id: "100", companyname: "Acme" }],
        items: [{ id: "10", itemid: "P-1", itemtype: "InvtPart" }],
        salesOrderLines: [
          {
            id: "7000",
            tranid: "SO1042",
            trandate: "2026-08-01",
            entity: "100",
            currency_code: "USD",
            line_id: "1",
            item: "10",
            quantity: "10",
            quantityshiprecv: "4",
            rate: "25"
          },
          {
            id: "7000",
            tranid: "SO1042",
            trandate: "2026-08-01",
            entity: "100",
            line_id: "2",
            item: null,
            line_memo: "Rush",
            quantity: "0"
          }
        ]
      })
    );

    expect(plan.salesOrders).toHaveLength(1);
    const order = plan.salesOrders[0];
    expect(order?.salesOrderId).toBe("SO1042");
    expect(order?.orderDate).toBe("2026-08-01");
    expect(order?.lines).toHaveLength(2);
    // The loader ships the remainder, so the mapper must carry both numbers.
    expect(order?.lines[0]).toMatchObject({ quantity: 10, quantityShipped: 4 });
    expect(order?.lines[1]?.isComment).toBe(true);
  });

  it("leaves an ambiguous order date blank rather than guessing the format", () => {
    const { plan, notes } = mapSnapshotToPlan(
      snapshot({
        customers: [{ id: "100", companyname: "Acme" }],
        salesOrderLines: [
          {
            id: "1",
            tranid: "SO1",
            trandate: "05/06/2026",
            entity: "100",
            line_id: "1",
            quantity: "1"
          }
        ]
      })
    );
    expect(plan.salesOrders[0]?.orderDate).toBeNull();
    expect(notes.join(" ")).toContain("ambiguously");
  });

  it("resolves an unambiguous DD/MM date", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        customers: [{ id: "100", companyname: "Acme" }],
        salesOrderLines: [
          {
            id: "1",
            tranid: "SO1",
            trandate: "25/06/2026",
            entity: "100",
            line_id: "1",
            quantity: "1"
          }
        ]
      })
    );
    expect(plan.salesOrders[0]?.orderDate).toBe("2026-06-25");
  });

  it("only migrates stock for items that came across, and never a negative", () => {
    const { plan } = mapSnapshotToPlan(
      snapshot({
        items: [{ id: "10", itemid: "P-1", itemtype: "InvtPart" }],
        inventoryBalances: [
          { item: "10", location: "3", quantityonhand: "42" },
          { item: "10", location: "4", quantityonhand: "-2" },
          { item: "99", location: "3", quantityonhand: "5" }
        ]
      })
    );
    expect(plan.openingStock).toEqual([
      {
        itemExternalId: "10",
        locationExternalId: "3",
        quantity: 42,
        unitCost: null
      }
    ]);
  });
});
