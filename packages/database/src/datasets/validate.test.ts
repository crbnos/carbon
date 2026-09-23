import { describe, expect, it } from "vitest";
import { datasetKeys, getDataset } from "./index.ts";
import type { Dataset } from "./types.ts";
import { validateDataset } from "./validate.ts";

describe("validateDataset", () => {
  for (const key of datasetKeys()) {
    it(`${key} is internally consistent`, () => {
      const dataset = getDataset(key);
      expect(dataset).toBeDefined();
      expect(validateDataset(dataset!)).toEqual([]);
    });
  }

  it("flags a BOM line naming an unknown item", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      items: {
        ...base.items,
        methods: [
          {
            ...base.items.methods[0]!,
            bom: [
              ...base.items.methods[0]!.bom,
              { component: "NOT-A-REAL-ITEM", quantity: 1, order: 999 }
            ]
          },
          ...base.items.methods.slice(1)
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'unknown item "NOT-A-REAL-ITEM"'
    );
  });

  it("flags an unbalanced journal entry", () => {
    const base = getDataset("robotics")!;
    const entry = base.accounting.journalEntries[0]!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        journalEntries: [
          {
            ...entry,
            lines: [
              { ...entry.lines[0]!, amount: entry.lines[0]!.amount + 100 },
              ...entry.lines.slice(1)
            ]
          }
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain("does not balance");
  });

  it("flags a taxonomy child naming an unknown substance", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      foundation: {
        ...base.foundation,
        materialTaxonomy: {
          ...base.foundation.materialTaxonomy,
          grades: [{ name: "Bad Grade", substance: "Unobtanium" }]
        }
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'unknown material substance "Unobtanium"'
    );
  });

  it("flags a dataset with no EUR supplier", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      foundation: {
        ...base.foundation,
        suppliers: base.foundation.suppliers.map((s) => ({
          ...s,
          currencyCode: undefined
        }))
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no supplier with currencyCode "EUR"'
    );
  });

  it("flags a supersession whose predecessor has no opening stock", () => {
    const base = getDataset("robotics")!;
    const pair = base.items.supersessions[0]!;
    const broken: Dataset = {
      ...base,
      inventory: {
        ...base.inventory,
        openingStock: base.inventory.openingStock.filter(
          (stock) => stock.item !== pair.predecessor
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      `predecessor "${pair.predecessor}" has no opening stock`
    );
  });

  it("flags a configuration on an item that is not a make part", () => {
    const base = getDataset("robotics")!;
    const buyPart = base.items.buyParts[0]!;
    const broken: Dataset = {
      ...base,
      items: {
        ...base.items,
        configuration: {
          ...base.items.configuration!,
          item: buyPart.readableId
        }
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "not a makePart readableId"
    );
  });

  it("flags a Transfer kanban whose shelves are the same bin", () => {
    const base = getDataset("robotics")!;
    const shelf = base.foundation.shelves.at(-1)!.name;
    const broken: Dataset = {
      ...base,
      inventory: {
        ...base.inventory,
        kanbanItems: [
          ...base.inventory.kanbanItems,
          {
            item: base.inventory.openingStock[0]!.item,
            qty: 5,
            replenishmentSystem: "Transfer",
            fromShelf: shelf,
            toShelf: shelf
          }
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "Transfer kanban's shelves must differ"
    );
  });

  it("flags a completed stock transfer that drains a bin below zero", () => {
    const base = getDataset("robotics")!;
    const stock = base.inventory.openingStock[0]!;
    const otherShelf = base.foundation.shelves.find(
      (shelf) => shelf.name !== stock.shelf && shelf.storageType !== "Rack"
    )!;
    const broken: Dataset = {
      ...base,
      inventory: {
        ...base.inventory,
        stockTransfers: [
          ...base.inventory.stockTransfers,
          {
            key: "st-overdraw",
            status: "Completed",
            fromShelf: stock.shelf,
            toShelf: otherShelf.name,
            dateOffset: -1,
            lines: [{ item: stock.item, quantity: stock.qty + 1000 }]
          }
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain("net on-hand");
  });

  it("flags a dropped required sales status (Lost quote removed)", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      sales: {
        ...base.sales,
        opportunities: base.sales.opportunities.map((spec) =>
          spec.quote?.status === "Lost" ? { ...spec, quote: undefined } : spec
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no quote with status "Lost"'
    );
  });

  it("flags a sales return with an unknown return reason", () => {
    const base = getDataset("robotics")!;
    const rma = base.sales.salesReturns[0]!;
    const broken: Dataset = {
      ...base,
      sales: {
        ...base.sales,
        salesReturns: [
          { ...rma, returnReason: "Not A Real Reason" },
          ...base.sales.salesReturns.slice(1)
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'returnReason "Not A Real Reason" is not a bootstrap return reason'
    );
  });

  it("flags a Posted receipt with no postedOffset", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      purchasing: {
        ...base.purchasing,
        purchaseOrders: base.purchasing.purchaseOrders.map((po) =>
          po.source === "direct" && po.receipt?.status === "Posted"
            ? {
                ...po,
                receipt: { ...po.receipt, postedOffset: undefined }
              }
            : po
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "Posted receipt has no postedOffset"
    );
  });

  it("flags a receipt lot number colliding with an on-hand tracked entity", () => {
    const base = getDataset("robotics")!;
    const existingLot =
      base.inventory.onHandTracked[0]!.entities[0]!.readableId;
    const broken: Dataset = {
      ...base,
      purchasing: {
        ...base.purchasing,
        purchaseOrders: base.purchasing.purchaseOrders.map((po) =>
          po.source === "direct" && po.receipt?.status === "Posted"
            ? {
                ...po,
                receipt: {
                  ...po.receipt,
                  lines: po.receipt.lines.map((line) =>
                    line.lotNumber !== undefined
                      ? { ...line, lotNumber: existingLot }
                      : line
                  )
                }
              }
            : po
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      `lotNumber "${existingLot}" collides`
    );
  });

  it("flags a job referencing a sales order that no spec registers", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      production: {
        ...base.production,
        jobs: [
          { ...base.production.jobs[0]!, salesOrder: "so:does-not-exist" },
          ...base.production.jobs.slice(1)
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'unknown sales order ref "so:does-not-exist"'
    );
  });

  it("flags a picking line whose item is not on the job's BOM tree", () => {
    const base = getDataset("satellite")!;
    const list = base.production.pickingLists[0]!;
    const broken: Dataset = {
      ...base,
      production: {
        ...base.production,
        pickingLists: [
          {
            ...list,
            lines: [
              // The supersession successor is guaranteed off every BOM (the
              // validator forbids authoring it there), so it can never be a
              // jobMaterial of any seeded job.
              { ...list.lines[0]!, item: "VLV-SOLENOID-LP2" },
              ...list.lines.slice(1)
            ]
          },
          ...base.production.pickingLists.slice(1)
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain("not a component of");
  });

  it("flags a Scrap quantity with a non-bootstrap scrap reason", () => {
    const base = getDataset("satellite")!;
    const job = base.production.jobs.find(
      (spec) => spec.key === base.production.eventsJobKey
    )!;
    const broken: Dataset = {
      ...base,
      production: {
        ...base.production,
        jobs: base.production.jobs.map((spec) =>
          spec === job
            ? {
                ...spec,
                quantities: (spec.quantities ?? []).map((quantity) =>
                  quantity.type === "Scrap"
                    ? { ...quantity, scrapReason: "Gremlins" }
                    : quantity
                )
              }
            : spec
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'scrapReason "Gremlins" is not a bootstrap scrap reason'
    );
  });

  it("flags an NCR sales order line that belongs to another customer", () => {
    const base = getDataset("satellite")!;
    const broken: Dataset = {
      ...base,
      quality: {
        ...base.quality,
        nonConformances: base.quality.nonConformances.map((ncr) =>
          ncr.salesOrderLine !== undefined
            ? { ...ncr, customer: "ORBSEC Defense" }
            : ncr
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'not the NCR\'s customer "ORBSEC Defense"'
    );
  });

  it("flags an inspection sample whose status its readings contradict", () => {
    const base = getDataset("robotics")!;
    const inspection = base.quality.inspection;
    const broken: Dataset = {
      ...base,
      quality: {
        ...base.quality,
        inspection: {
          ...inspection,
          samples: inspection.samples.map((sample) => ({
            ...sample,
            status: "Passed" as const
          }))
        }
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'status "Passed" but its readings derive "Failed"'
    );
  });

  it("flags a dataset missing a change order status", () => {
    const base = getDataset("motor")!;
    const broken: Dataset = {
      ...base,
      changeOrders: {
        changeOrders: base.changeOrders.changeOrders.filter(
          (co) => co.status !== "Cancelled"
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no changeOrder status "Cancelled"'
    );
  });

  it("flags a payment whose party is not the invoice's customer", () => {
    const base = getDataset("satellite")!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        payments: base.accounting.payments.map((p) =>
          p.key === "orbsec-ach" ? { ...p, customer: "PolarView Earth" } : p
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'party "PolarView Earth" does not match sinv:paid\'s "ORBSEC Defense"'
    );
  });

  it("flags a Partially Paid invoice that the payments settle in full", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        payments: base.accounting.payments.map((p) =>
          p.key === "kestrel-check"
            ? {
                ...p,
                amount: 4600,
                applies: [{ invoiceKey: "partial", amount: 4600 }]
              }
            : p
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "pinv:partial is Partially Paid but settled 4600 of 4600"
    );
  });

  it("flags a payment whose applications do not add up to its amount", () => {
    const base = getDataset("precision")!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        payments: base.accounting.payments.map((p) =>
          p.key === "cedar-ach" ? { ...p, amount: 400 } : p
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "applications total 345 but the payment is 400"
    );
  });

  it("flags a Reversed journal with no reversal entry", () => {
    const base = getDataset("motor")!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        journalEntries: base.accounting.journalEntries.map((e) =>
          e.status === "Reversed" ? { ...e, reversal: undefined } : e
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "a reversal entry is required exactly when status is Reversed"
    );
  });

  it("flags a Units of Production charge the app would not compute", () => {
    const base = getDataset("satellite")!;
    const broken: Dataset = {
      ...base,
      accounting: {
        ...base.accounting,
        fixedAssets: base.accounting.fixedAssets.map((a) =>
          a.key === "laser" ? { ...a, depreciationCharge: 1200 } : a
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "depreciationCharge 1200 but the app computes 1008"
    );
  });

  it("flags a completed dispatch that issues more spare parts than the shelf holds", () => {
    const base = getDataset("satellite")!;
    const broken: Dataset = {
      ...base,
      ops: {
        ...base.ops,
        maintenanceDispatches: base.ops.maintenanceDispatches.map((d) =>
          d.status === "Completed"
            ? {
                ...d,
                spareParts: [
                  { item: "CN-GREASE-001", quantity: 3, shelf: "A1-L3" }
                ]
              }
            : d
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      "net on-hand for CN-GREASE-001 @ A1-L3 is -1"
    );
  });

  it("flags a workflow run step whose node is not in the definition", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      workflows: {
        ...base.workflows,
        runs: base.workflows.runs.map((run) =>
          run.status === "Succeeded"
            ? {
                ...run,
                steps: [{ nodeId: "action_missing", status: "Succeeded" }]
              }
            : run
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'step nodeId "action_missing" is not an action node of "Assign new sales orders"'
    );
  });

  it("flags a dataset missing a maintenance dispatch status", () => {
    const base = getDataset("precision")!;
    const broken: Dataset = {
      ...base,
      ops: {
        ...base.ops,
        maintenanceDispatches: base.ops.maintenanceDispatches.filter(
          (d) => d.status !== "Cancelled"
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no maintenance dispatch with status "Cancelled"'
    );
  });

  it("flags overlapping time card entries", () => {
    const base = getDataset("motor")!;
    const broken: Dataset = {
      ...base,
      ops: {
        ...base.ops,
        timecards: [
          ...base.ops.timecards,
          { dayOffset: -3, clockIn: "12:00:00", clockOut: "13:00:00" }
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain("overlaps");
  });

  it("flags a dataset with no Scrapped lot", () => {
    const base = getDataset("satellite")!;
    const broken: Dataset = {
      ...base,
      inventory: {
        ...base.inventory,
        onHandTracked: base.inventory.onHandTracked.map((stock) => ({
          ...stock,
          entities: stock.entities.filter((e) => e.status !== "Scrapped")
        }))
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no tracked entity with status "Scrapped"'
    );
  });

  it("flags a scrapped lot that drains its shelf below zero", () => {
    const base = getDataset("robotics")!;
    const broken: Dataset = {
      ...base,
      inventory: {
        ...base.inventory,
        onHandTracked: base.inventory.onHandTracked.map((stock) => ({
          ...stock,
          entities: stock.entities.map((e) =>
            e.status === "Scrapped" ? { ...e, quantity: 1_000_000 } : e
          )
        }))
      }
    };
    expect(validateDataset(broken).join("\n")).toContain("MAT-AL6061-BIL");
  });

  it("flags a revision ladder with no Prototype rung", () => {
    const base = getDataset("precision")!;
    const broken: Dataset = {
      ...base,
      items: {
        ...base.items,
        revisionLadder: base.items.revisionLadder.map((rung) => ({
          ...rung,
          nextStatus: "Design" as const
        }))
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no rung with nextStatus "Prototype"'
    );
  });

  it("flags a dataset missing a Closed purchasing RFQ", () => {
    const base = getDataset("motor")!;
    const broken: Dataset = {
      ...base,
      purchasing: {
        ...base.purchasing,
        lifecycleRfqs: base.purchasing.lifecycleRfqs.filter(
          (rfq) => rfq.status !== "Closed"
        )
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'no purchasingRfq with status "Closed"'
    );
  });

  it("flags a lifecycle RFQ addressed to a supplier that is not Active", () => {
    const base = getDataset("satellite")!;
    const [draft, ...rest] = base.purchasing.lifecycleRfqs;
    const broken: Dataset = {
      ...base,
      purchasing: {
        ...base.purchasing,
        lifecycleRfqs: [
          {
            ...draft!,
            suppliers: [...draft!.suppliers, "BargainSat Components"]
          },
          ...rest
        ]
      }
    };
    expect(validateDataset(broken).join("\n")).toContain(
      'supplier "BargainSat Components" is not Active'
    );
  });
});
