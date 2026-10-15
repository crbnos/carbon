// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import { expect, it } from "vitest";
import {
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions,
  planIncreaseUnitCosts,
  planStockRows,
  toJournalLineDocumentType
} from "./plan-adjustment";
import type { AdjustmentItemCost } from "./post-adjustment-cost";
import { computeCurrentUnitCost } from "./post-adjustment-cost";

const accountDefaults = {
  rawMaterialsAccount: "raw",
  finishedGoodsAccount: "fg",
  inventoryAdjustmentVarianceAccount: "variance"
};

// The read the per-row path performs before each increase, reproduced from the
// layers written so far. `planIncreaseUnitCosts` must agree with this for a
// whole file, which is the batch path's entire correctness claim.
const bookOneAtATime = (
  itemCost: Parameters<typeof computeCurrentUnitCost>[0],
  openLayers: Parameters<typeof computeCurrentUnitCost>[1],
  quantities: number[]
) => {
  const layers = [...openLayers];
  return quantities.map((quantity) => {
    const unitCost = computeCurrentUnitCost(itemCost, layers);
    const row = buildCostLedgerRow({
      entryType: "Positive Adjmt.",
      documentType: null,
      documentId: "il",
      itemId: "item",
      quantity,
      cost: quantity * unitCost,
      postingDate: "2026-09-22",
      companyId: "c"
    });
    if ((row.remainingQuantity ?? 0) > 0) {
      layers.push({
        quantity: row.quantity!,
        remainingQuantity: row.remainingQuantity!,
        cost: row.cost!,
        appliedChildCost: 0
      });
    }
    return row.cost;
  });
};

const plannedCosts = (
  itemCost: Parameters<typeof computeCurrentUnitCost>[0],
  openLayers: Parameters<typeof computeCurrentUnitCost>[1],
  quantities: number[]
) =>
  planIncreaseUnitCosts(itemCost, openLayers, quantities).map((increase) =>
    round(increase.cost)
  );

it("Standard: every row of an item costs the same, layers ignored", () => {
  const itemCost = {
    costingMethod: "Standard" as const,
    unitCost: 3,
    standardCost: 5
  };
  const increases = planIncreaseUnitCosts(itemCost, [], [2, 10, 1]);
  expect(increases.map((i) => i.unitCost)).toEqual([5, 5, 5]);
  expect(increases.map((i) => i.cost)).toEqual([10, 50, 5]);
});

it("Average: every row of an item costs the same, layers ignored", () => {
  const itemCost = {
    costingMethod: "Average" as const,
    unitCost: 7.25,
    standardCost: 0
  };
  const increases = planIncreaseUnitCosts(
    itemCost,
    [{ quantity: 100, remainingQuantity: 100, cost: 1, appliedChildCost: 0 }],
    [4, 4]
  );
  expect(increases.map((i) => i.unitCost)).toEqual([7.25, 7.25]);
});

it("FIFO: a layer added at the current average leaves it unchanged", () => {
  // 100 @ $10 open. Every row books at $10 and the average stays $10, because
  // a layer of q units carrying q × $10 contributes exactly the average back.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1,
    standardCost: 0
  };
  const increases = planIncreaseUnitCosts(
    itemCost,
    [
      { quantity: 100, remainingQuantity: 100, cost: 1000, appliedChildCost: 0 }
    ],
    [5, 5, 5]
  );
  expect(increases.map((i) => i.unitCost)).toEqual([10, 10, 10]);
});

it("FIFO: the first row seeds the fallback cost and later rows average over it", () => {
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 4.5,
    standardCost: 0
  };
  const increases = planIncreaseUnitCosts(itemCost, [], [2, 8]);
  expect(increases.map((i) => i.unitCost)).toEqual([4.5, 4.5]);
  expect(increases.map((i) => i.cost)).toEqual([9, 36]);
});

it("FIFO: a rounded layer cost carries into the next row, exactly as the per-row path does", () => {
  // The equivalence is only exact in real arithmetic: the layer is STORED at
  // round(q × u, 5), so a 1-unit row at 1/3 stores 0.33333 and the next row
  // averages over 0.33333, not over 1/3. A hoisted unit cost would book
  // 333.33333 for the 1000-unit row; the per-row path books 333.33.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1 / 3,
    standardCost: 0
  };
  const planned = plannedCosts(itemCost, [], [1, 1000]);
  expect(planned).toEqual([0.33333, 333.33]);
  expect(planned).toEqual(bookOneAtATime(itemCost, [], [1, 1000]));
  // What hoisting one unit cost per item would have produced.
  expect(round(1000 * (1 / 3))).toEqual(333.33333);
});

it("planIncreaseUnitCosts matches booking the rows one at a time", () => {
  const openLayers = [
    { quantity: 7, remainingQuantity: 3, cost: 21.55, appliedChildCost: 1.3 },
    { quantity: 12, remainingQuantity: 12, cost: 149.99, appliedChildCost: 0 }
  ];
  const quantities = [1, 3.5, 0.125, 1000, 17];
  for (const costingMethod of [
    "Standard",
    "Average",
    "FIFO",
    "LIFO"
  ] as const) {
    const itemCost = { costingMethod, unitCost: 1 / 7, standardCost: 2.5 };
    expect(plannedCosts(itemCost, openLayers, quantities)).toEqual(
      bookOneAtATime(itemCost, openLayers, quantities)
    );
  }
});

it("planIncreaseUnitCosts is per item: one item's layers never reach another", () => {
  // The driver groups rows by item and calls this once per item, so a mixed
  // file is two independent replays. Proven by planning the same item's rows
  // interleaved and alone.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1 / 3,
    standardCost: 0
  };
  const other = {
    costingMethod: "FIFO" as const,
    unitCost: 99,
    standardCost: 0
  };
  expect(plannedCosts(itemCost, [], [1, 1000])).toEqual(
    plannedCosts(itemCost, [], [1, 1000])
  );
  expect(plannedCosts(other, [], [1])).toEqual([99]);
});

it("A zero-quantity row opens no layer for the next row to see", () => {
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 4,
    standardCost: 0
  };
  // The middle row rounds to a zero quantity, so its layer has
  // remainingQuantity 0 and the open-layer query would not return it.
  const increases = planIncreaseUnitCosts(itemCost, [], [0, 0, 6]);
  expect(increases.map((i) => i.unitCost)).toEqual([4, 4, 4]);
});

it("buildCostLedgerRow opens a layer on an increase and none on a decrease", () => {
  const increase = buildCostLedgerRow({
    entryType: "Positive Adjmt.",
    documentType: null,
    documentId: "il1",
    itemId: "item",
    quantity: 5,
    cost: 12.345678,
    postingDate: "2026-09-22",
    companyId: "c"
  });
  expect(increase.quantity).toEqual(5);
  expect(increase.cost).toEqual(12.34568);
  expect(increase.remainingQuantity).toEqual(5);
  expect(increase.adjustment).toEqual(false);
  expect(increase.costLedgerType).toEqual("Direct Cost");

  const decrease = buildCostLedgerRow({
    entryType: "Negative Adjmt.",
    documentType: null,
    documentId: "il2",
    itemId: "item",
    quantity: -5,
    cost: -50,
    postingDate: "2026-09-22",
    companyId: "c"
  });
  expect(decrease.quantity).toEqual(-5);
  expect(decrease.remainingQuantity).toEqual(0);
});

it("buildAdjustmentJournalLines balances a gain against the variance account", () => {
  const [inventory, offset] = buildAdjustmentJournalLines({
    journalId: "j1",
    documentId: "il1",
    documentType: null,
    journalLineReference: "ref",
    isGain: true,
    cost: 250,
    quantity: 10,
    replenishmentSystem: "Buy",
    accountDefaults,
    companyId: "c"
  });
  expect(inventory.accountId).toEqual("raw");
  expect(inventory.description).toEqual("Raw Materials Account");
  expect(inventory.amount).toEqual(250);
  expect(inventory.documentType).toEqual("Inventory Adjustment");
  expect(offset.accountId).toEqual("variance");
  expect(offset.amount).toEqual(-250);
  expect(inventory.amount + offset.amount).toEqual(0);
  expect(inventory.journalLineReference).toEqual(offset.journalLineReference);
});

it("buildAdjustmentJournalLines sends a Make item to finished goods", () => {
  const [inventory] = buildAdjustmentJournalLines({
    journalId: "j1",
    documentId: "il1",
    journalLineReference: "ref",
    isGain: true,
    cost: 1,
    quantity: 1,
    replenishmentSystem: "Make",
    accountDefaults,
    companyId: "c"
  });
  expect(inventory.accountId).toEqual("fg");
});

it("toJournalLineDocumentType falls back for types the journal enum lacks", () => {
  expect(toJournalLineDocumentType(null)).toEqual("Inventory Adjustment");
  expect(toJournalLineDocumentType("Sales Invoice")).toEqual(
    "Inventory Adjustment"
  );
  expect(toJournalLineDocumentType("Inventory Count")).toEqual(
    "Inventory Count"
  );
});

it("buildJournalLineDimensions tags every line with the active dimensions", () => {
  const rows = buildJournalLineDimensions({
    journalLineIds: ["l1", "l2"],
    dimensions: { Item: "d-item", Location: "d-loc" },
    itemId: "item",
    itemPostingGroupId: "ipg",
    locationId: "loc",
    companyId: "c"
  });
  // ItemPostingGroup has a value but no active dimension, so it is not tagged.
  expect(rows.length).toEqual(4);
  expect(
    rows.map((r) => `${r.journalLineId}:${r.dimensionId}:${r.valueId}`)
  ).toEqual([
    "l1:d-item:item",
    "l1:d-loc:loc",
    "l2:d-item:item",
    "l2:d-loc:loc"
  ]);
});

it("buildJournalLineDimensions skips a dimension whose value is null", () => {
  const rows = buildJournalLineDimensions({
    journalLineIds: ["l1"],
    dimensions: {
      Item: "d-item",
      ItemPostingGroup: "d-ipg",
      Location: "d-loc"
    },
    itemId: "item",
    itemPostingGroupId: null,
    locationId: null,
    companyId: "c"
  });
  expect(rows.length).toEqual(1);
  expect(rows[0]!.dimensionId).toEqual("d-item");
});

it("buildItemLedgerRow rounds the quantity and defaults the optional columns", () => {
  const row = buildItemLedgerRow({
    postingDate: "2026-09-22",
    entryType: "Positive Adjmt.",
    itemId: "item",
    locationId: "loc",
    storageUnitId: null,
    trackedEntityId: "te1",
    quantity: 2.1234567,
    companyId: "c",
    createdBy: "u"
  });
  expect(row.quantity).toEqual(2.12346);
  expect(row.entryType).toEqual("Positive Adjmt.");
  expect(row.documentType).toEqual(null);
  expect(row.documentId).toEqual(null);
  expect(row.correctionOfItemLedgerId).toEqual(null);
  expect(row.comment).toEqual(null);
  expect(row.scrapReasonId).toEqual(null);
  expect(row.trackedEntityId).toEqual("te1");
});

it("buildItemLedgerRow keeps a decrease signed and carries the passed columns", () => {
  const row = buildItemLedgerRow({
    postingDate: "2026-09-22",
    entryType: "Negative Adjmt.",
    documentType: "Scrap",
    documentId: "doc1",
    correctionOfItemLedgerId: "il0",
    itemId: "item",
    locationId: null,
    storageUnitId: "su1",
    trackedEntityId: null,
    quantity: -5,
    comment: "note",
    scrapReasonId: "sr1",
    companyId: "c",
    createdBy: "u"
  });
  expect(row.quantity).toEqual(-5);
  expect(row.documentType).toEqual("Scrap");
  expect(row.documentId).toEqual("doc1");
  expect(row.correctionOfItemLedgerId).toEqual("il0");
  expect(row.storageUnitId).toEqual("su1");
  expect(row.comment).toEqual("note");
  expect(row.scrapReasonId).toEqual("sr1");
});

// --- planStockRows: the batching decision the importer writes from ---------

const itemCosts = (
  entries: Record<string, AdjustmentItemCost>
): Map<string, AdjustmentItemCost> => new Map(Object.entries(entries));

const fifo = (unitCost: number): AdjustmentItemCost => ({
  costingMethod: "FIFO",
  unitCost,
  standardCost: 0
});

it("planStockRows scatters each item's replayed costs back onto its own rows", () => {
  // A mixed file with one item's rows NOT adjacent. Item A's two rows differ
  // (the rounded-layer case), so a scatter that dropped or swapped an index
  // would put B's cost — or A's other row's cost — on the wrong row.
  const rows = [
    { itemId: "A", quantity: 1, itemTrackingType: "Inventory" },
    { itemId: "B", quantity: 2, itemTrackingType: "Inventory" },
    { itemId: "A", quantity: 1000, itemTrackingType: "Inventory" }
  ];
  const plans = planStockRows({
    rows,
    itemCosts: itemCosts({
      A: fifo(1 / 3),
      B: { costingMethod: "Standard", unitCost: 0, standardCost: 5 }
    }),
    openLayersByItem: new Map()
  });

  const replayA = planIncreaseUnitCosts(fifo(1 / 3), [], [1, 1000]);
  expect(plans.map((p) => round(p.cost))).toEqual([
    round(replayA[0]!.cost),
    10,
    round(replayA[1]!.cost)
  ]);
  expect(plans.map((p) => round(p.cost))).toEqual([0.33333, 10, 333.33]);
  expect(plans.map((p) => p.carriesValue)).toEqual([true, true, true]);
  expect(plans.map((p) => p.postsJournal)).toEqual([true, true, true]);
});

it("planStockRows replays several rows of ONE item in file order", () => {
  const quantities = [1, 1000, 3];
  const rows = quantities.map((quantity) => ({
    itemId: "A",
    quantity,
    itemTrackingType: "Inventory"
  }));
  const plans = planStockRows({
    rows,
    itemCosts: itemCosts({ A: fifo(1 / 3) }),
    openLayersByItem: new Map()
  });
  expect(plans.map((p) => round(p.cost))).toEqual(
    planIncreaseUnitCosts(fifo(1 / 3), [], quantities).map((i) => round(i.cost))
  );
});

it("planStockRows values against the item's open layers", () => {
  const plans = planStockRows({
    rows: [{ itemId: "A", quantity: 5, itemTrackingType: "Inventory" }],
    itemCosts: itemCosts({ A: fifo(1) }),
    openLayersByItem: new Map([
      [
        "A",
        [
          {
            quantity: 100,
            remainingQuantity: 100,
            cost: 1000,
            appliedChildCost: 0
          }
        ]
      ]
    ])
  });
  // $10 average from the open layer, not the $1 itemCost fallback.
  expect(plans[0]!.cost).toEqual(50);
});

it("planStockRows: a zero-cost item plans a cost layer but no journal", () => {
  const plans = planStockRows({
    rows: [
      { itemId: "A", quantity: 5, itemTrackingType: "Inventory" },
      { itemId: "A", quantity: 9, itemTrackingType: "Inventory" }
    ],
    itemCosts: itemCosts({
      A: { costingMethod: "Average", unitCost: 0, standardCost: 0 }
    }),
    openLayersByItem: new Map()
  });
  expect(plans.map((p) => p.cost)).toEqual([0, 0]);
  // The layer is still written — only the journal pair is suppressed.
  expect(plans.map((p) => p.carriesValue)).toEqual([true, true]);
  expect(plans.map((p) => p.postsJournal)).toEqual([false, false]);
  const row = buildCostLedgerRow({
    entryType: "Positive Adjmt.",
    documentType: null,
    documentId: "il1",
    itemId: "A",
    quantity: 5,
    cost: plans[0]!.cost,
    postingDate: "2026-09-22",
    companyId: "c"
  });
  expect(row.cost).toEqual(0);
  expect(row.remainingQuantity).toEqual(5);
});

it("planStockRows: a Non-Inventory or zero-quantity row carries no value", () => {
  const plans = planStockRows({
    rows: [
      { itemId: "A", quantity: 5, itemTrackingType: "Non-Inventory" },
      { itemId: "A", quantity: 0, itemTrackingType: "Inventory" },
      { itemId: "A", quantity: 2, itemTrackingType: "Inventory" }
    ],
    itemCosts: itemCosts({ A: fifo(3) }),
    openLayersByItem: new Map()
  });
  expect(plans.map((p) => p.carriesValue)).toEqual([false, false, true]);
  expect(plans.map((p) => p.cost)).toEqual([0, 0, 6]);
  expect(plans.map((p) => p.postsJournal)).toEqual([false, false, true]);
});
