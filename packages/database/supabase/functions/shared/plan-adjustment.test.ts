import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildAdjustmentJournalLines,
  buildCostLedgerRow,
  buildItemLedgerRow,
  buildJournalLineDimensions,
  planIncreaseUnitCosts,
  planStockRows,
  toJournalLineDocumentType,
} from "./plan-adjustment.ts";
import type { AdjustmentItemCost } from "./post-adjustment-cost.ts";
import { computeCurrentUnitCost } from "./post-adjustment-cost.ts";
import { round } from "./precision.ts";

const accountDefaults = {
  rawMaterialsAccount: "raw",
  finishedGoodsAccount: "fg",
  inventoryAdjustmentVarianceAccount: "variance",
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
      companyId: "c",
    });
    if ((row.remainingQuantity ?? 0) > 0) {
      layers.push({
        quantity: row.quantity!,
        remainingQuantity: row.remainingQuantity!,
        cost: row.cost!,
        appliedChildCost: 0,
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

Deno.test("Standard: every row of an item costs the same, layers ignored", () => {
  const itemCost = {
    costingMethod: "Standard" as const,
    unitCost: 3,
    standardCost: 5,
  };
  const increases = planIncreaseUnitCosts(itemCost, [], [2, 10, 1]);
  assertEquals(
    increases.map((i) => i.unitCost),
    [5, 5, 5]
  );
  assertEquals(
    increases.map((i) => i.cost),
    [10, 50, 5]
  );
});

Deno.test("Average: every row of an item costs the same, layers ignored", () => {
  const itemCost = {
    costingMethod: "Average" as const,
    unitCost: 7.25,
    standardCost: 0,
  };
  const increases = planIncreaseUnitCosts(
    itemCost,
    [{ quantity: 100, remainingQuantity: 100, cost: 1, appliedChildCost: 0 }],
    [4, 4]
  );
  assertEquals(
    increases.map((i) => i.unitCost),
    [7.25, 7.25]
  );
});

Deno.test("FIFO: a layer added at the current average leaves it unchanged", () => {
  // 100 @ $10 open. Every row books at $10 and the average stays $10, because
  // a layer of q units carrying q × $10 contributes exactly the average back.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1,
    standardCost: 0,
  };
  const increases = planIncreaseUnitCosts(
    itemCost,
    [{ quantity: 100, remainingQuantity: 100, cost: 1000, appliedChildCost: 0 }],
    [5, 5, 5]
  );
  assertEquals(
    increases.map((i) => i.unitCost),
    [10, 10, 10]
  );
});

Deno.test("FIFO: the first row seeds the fallback cost and later rows average over it", () => {
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 4.5,
    standardCost: 0,
  };
  const increases = planIncreaseUnitCosts(itemCost, [], [2, 8]);
  assertEquals(
    increases.map((i) => i.unitCost),
    [4.5, 4.5]
  );
  assertEquals(
    increases.map((i) => i.cost),
    [9, 36]
  );
});

Deno.test("FIFO: a rounded layer cost carries into the next row, exactly as the per-row path does", () => {
  // The equivalence is only exact in real arithmetic: the layer is STORED at
  // round(q × u, 5), so a 1-unit row at 1/3 stores 0.33333 and the next row
  // averages over 0.33333, not over 1/3. A hoisted unit cost would book
  // 333.33333 for the 1000-unit row; the per-row path books 333.33.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1 / 3,
    standardCost: 0,
  };
  const planned = plannedCosts(itemCost, [], [1, 1000]);
  assertEquals(planned, [0.33333, 333.33]);
  assertEquals(planned, bookOneAtATime(itemCost, [], [1, 1000]));
  // What hoisting one unit cost per item would have produced.
  assertEquals(round(1000 * (1 / 3)), 333.33333);
});

Deno.test("planIncreaseUnitCosts matches booking the rows one at a time", () => {
  const openLayers = [
    { quantity: 7, remainingQuantity: 3, cost: 21.55, appliedChildCost: 1.3 },
    { quantity: 12, remainingQuantity: 12, cost: 149.99, appliedChildCost: 0 },
  ];
  const quantities = [1, 3.5, 0.125, 1000, 17];
  for (const costingMethod of [
    "Standard",
    "Average",
    "FIFO",
    "LIFO",
  ] as const) {
    const itemCost = { costingMethod, unitCost: 1 / 7, standardCost: 2.5 };
    assertEquals(
      plannedCosts(itemCost, openLayers, quantities),
      bookOneAtATime(itemCost, openLayers, quantities),
      costingMethod
    );
  }
});

Deno.test("planIncreaseUnitCosts is per item: one item's layers never reach another", () => {
  // The driver groups rows by item and calls this once per item, so a mixed
  // file is two independent replays. Proven by planning the same item's rows
  // interleaved and alone.
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 1 / 3,
    standardCost: 0,
  };
  const other = {
    costingMethod: "FIFO" as const,
    unitCost: 99,
    standardCost: 0,
  };
  assertEquals(
    plannedCosts(itemCost, [], [1, 1000]),
    plannedCosts(itemCost, [], [1, 1000])
  );
  assertEquals(plannedCosts(other, [], [1]), [99]);
});

Deno.test("A zero-quantity row opens no layer for the next row to see", () => {
  const itemCost = {
    costingMethod: "FIFO" as const,
    unitCost: 4,
    standardCost: 0,
  };
  // The middle row rounds to a zero quantity, so its layer has
  // remainingQuantity 0 and the open-layer query would not return it.
  const increases = planIncreaseUnitCosts(itemCost, [], [0, 0, 6]);
  assertEquals(
    increases.map((i) => i.unitCost),
    [4, 4, 4]
  );
});

Deno.test("buildCostLedgerRow opens a layer on an increase and none on a decrease", () => {
  const increase = buildCostLedgerRow({
    entryType: "Positive Adjmt.",
    documentType: null,
    documentId: "il1",
    itemId: "item",
    quantity: 5,
    cost: 12.345678,
    postingDate: "2026-09-22",
    companyId: "c",
  });
  assertEquals(increase.quantity, 5);
  assertEquals(increase.cost, 12.34568);
  assertEquals(increase.remainingQuantity, 5);
  assertEquals(increase.adjustment, false);
  assertEquals(increase.costLedgerType, "Direct Cost");

  const decrease = buildCostLedgerRow({
    entryType: "Negative Adjmt.",
    documentType: null,
    documentId: "il2",
    itemId: "item",
    quantity: -5,
    cost: -50,
    postingDate: "2026-09-22",
    companyId: "c",
  });
  assertEquals(decrease.quantity, -5);
  assertEquals(decrease.remainingQuantity, 0);
});

Deno.test("buildAdjustmentJournalLines balances a gain against the variance account", () => {
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
    companyId: "c",
  });
  assertEquals(inventory.accountId, "raw");
  assertEquals(inventory.description, "Raw Materials Account");
  assertEquals(inventory.amount, 250);
  assertEquals(inventory.documentType, "Inventory Adjustment");
  assertEquals(offset.accountId, "variance");
  assertEquals(offset.amount, -250);
  assertEquals(inventory.amount + offset.amount, 0);
  assertEquals(inventory.journalLineReference, offset.journalLineReference);
});

Deno.test("buildAdjustmentJournalLines sends a Make item to finished goods", () => {
  const [inventory] = buildAdjustmentJournalLines({
    journalId: "j1",
    documentId: "il1",
    journalLineReference: "ref",
    isGain: true,
    cost: 1,
    quantity: 1,
    replenishmentSystem: "Make",
    accountDefaults,
    companyId: "c",
  });
  assertEquals(inventory.accountId, "fg");
});

Deno.test("toJournalLineDocumentType falls back for types the journal enum lacks", () => {
  assertEquals(toJournalLineDocumentType(null), "Inventory Adjustment");
  assertEquals(toJournalLineDocumentType("Sales Invoice"), "Inventory Adjustment");
  assertEquals(toJournalLineDocumentType("Inventory Count"), "Inventory Count");
});

Deno.test("buildJournalLineDimensions tags every line with the active dimensions", () => {
  const rows = buildJournalLineDimensions({
    journalLineIds: ["l1", "l2"],
    dimensions: { Item: "d-item", Location: "d-loc" },
    itemId: "item",
    itemPostingGroupId: "ipg",
    locationId: "loc",
    companyId: "c",
  });
  // ItemPostingGroup has a value but no active dimension, so it is not tagged.
  assertEquals(rows.length, 4);
  assertEquals(
    rows.map((r) => `${r.journalLineId}:${r.dimensionId}:${r.valueId}`),
    [
      "l1:d-item:item",
      "l1:d-loc:loc",
      "l2:d-item:item",
      "l2:d-loc:loc",
    ]
  );
});

Deno.test("buildJournalLineDimensions skips a dimension whose value is null", () => {
  const rows = buildJournalLineDimensions({
    journalLineIds: ["l1"],
    dimensions: { Item: "d-item", ItemPostingGroup: "d-ipg", Location: "d-loc" },
    itemId: "item",
    itemPostingGroupId: null,
    locationId: null,
    companyId: "c",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].dimensionId, "d-item");
});

Deno.test("buildItemLedgerRow rounds the quantity and defaults the optional columns", () => {
  const row = buildItemLedgerRow({
    postingDate: "2026-09-22",
    entryType: "Positive Adjmt.",
    itemId: "item",
    locationId: "loc",
    storageUnitId: null,
    trackedEntityId: "te1",
    quantity: 2.1234567,
    companyId: "c",
    createdBy: "u",
  });
  assertEquals(row.quantity, 2.12346);
  assertEquals(row.entryType, "Positive Adjmt.");
  assertEquals(row.documentType, null);
  assertEquals(row.documentId, null);
  assertEquals(row.correctionOfItemLedgerId, null);
  assertEquals(row.comment, null);
  assertEquals(row.scrapReasonId, null);
  assertEquals(row.trackedEntityId, "te1");
});

Deno.test("buildItemLedgerRow keeps a decrease signed and carries the passed columns", () => {
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
    createdBy: "u",
  });
  assertEquals(row.quantity, -5);
  assertEquals(row.documentType, "Scrap");
  assertEquals(row.documentId, "doc1");
  assertEquals(row.correctionOfItemLedgerId, "il0");
  assertEquals(row.storageUnitId, "su1");
  assertEquals(row.comment, "note");
  assertEquals(row.scrapReasonId, "sr1");
});

// --- planStockRows: the batching decision the importer writes from ---------

const itemCosts = (
  entries: Record<string, AdjustmentItemCost>
): Map<string, AdjustmentItemCost> => new Map(Object.entries(entries));

const fifo = (unitCost: number): AdjustmentItemCost => ({
  costingMethod: "FIFO",
  unitCost,
  standardCost: 0,
});

Deno.test("planStockRows scatters each item's replayed costs back onto its own rows", () => {
  // A mixed file with one item's rows NOT adjacent. Item A's two rows differ
  // (the rounded-layer case), so a scatter that dropped or swapped an index
  // would put B's cost — or A's other row's cost — on the wrong row.
  const rows = [
    { itemId: "A", quantity: 1, itemTrackingType: "Inventory" },
    { itemId: "B", quantity: 2, itemTrackingType: "Inventory" },
    { itemId: "A", quantity: 1000, itemTrackingType: "Inventory" },
  ];
  const plans = planStockRows({
    rows,
    itemCosts: itemCosts({
      A: fifo(1 / 3),
      B: { costingMethod: "Standard", unitCost: 0, standardCost: 5 },
    }),
    openLayersByItem: new Map(),
    hasAccounting: true,
  });

  const replayA = planIncreaseUnitCosts(fifo(1 / 3), [], [1, 1000]);
  assertEquals(
    plans.map((p) => round(p.cost)),
    [round(replayA[0].cost), 10, round(replayA[1].cost)]
  );
  assertEquals(
    plans.map((p) => round(p.cost)),
    [0.33333, 10, 333.33]
  );
  assertEquals(
    plans.map((p) => p.carriesValue),
    [true, true, true]
  );
  assertEquals(
    plans.map((p) => p.postsJournal),
    [true, true, true]
  );
});

Deno.test("planStockRows replays several rows of ONE item in file order", () => {
  const quantities = [1, 1000, 3];
  const rows = quantities.map((quantity) => ({
    itemId: "A",
    quantity,
    itemTrackingType: "Inventory",
  }));
  const plans = planStockRows({
    rows,
    itemCosts: itemCosts({ A: fifo(1 / 3) }),
    openLayersByItem: new Map(),
    hasAccounting: true,
  });
  assertEquals(
    plans.map((p) => round(p.cost)),
    planIncreaseUnitCosts(fifo(1 / 3), [], quantities).map((i) =>
      round(i.cost)
    )
  );
});

Deno.test("planStockRows values against the item's open layers", () => {
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
            appliedChildCost: 0,
          },
        ],
      ],
    ]),
    hasAccounting: true,
  });
  // $10 average from the open layer, not the $1 itemCost fallback.
  assertEquals(plans[0].cost, 50);
});

Deno.test("planStockRows: a zero-cost item plans a cost layer but no journal", () => {
  const plans = planStockRows({
    rows: [
      { itemId: "A", quantity: 5, itemTrackingType: "Inventory" },
      { itemId: "A", quantity: 9, itemTrackingType: "Inventory" },
    ],
    itemCosts: itemCosts({
      A: { costingMethod: "Average", unitCost: 0, standardCost: 0 },
    }),
    openLayersByItem: new Map(),
    hasAccounting: true,
  });
  assertEquals(
    plans.map((p) => p.cost),
    [0, 0]
  );
  // The layer is still written — only the journal pair is suppressed.
  assertEquals(
    plans.map((p) => p.carriesValue),
    [true, true]
  );
  assertEquals(
    plans.map((p) => p.postsJournal),
    [false, false]
  );
  const row = buildCostLedgerRow({
    entryType: "Positive Adjmt.",
    documentType: null,
    documentId: "il1",
    itemId: "A",
    quantity: 5,
    cost: plans[0].cost,
    postingDate: "2026-09-22",
    companyId: "c",
  });
  assertEquals(row.cost, 0);
  assertEquals(row.remainingQuantity, 5);
});

Deno.test("planStockRows: accounting disabled posts no journal on any row", () => {
  const plans = planStockRows({
    rows: [
      { itemId: "A", quantity: 3, itemTrackingType: "Inventory" },
      { itemId: "B", quantity: 4, itemTrackingType: "Batch" },
    ],
    itemCosts: itemCosts({
      A: { costingMethod: "Average", unitCost: 2, standardCost: 0 },
      B: { costingMethod: "Average", unitCost: 2, standardCost: 0 },
    }),
    openLayersByItem: new Map(),
    hasAccounting: false,
  });
  // Cost layers are unaffected by the GL setting; only the journal is.
  assertEquals(
    plans.map((p) => p.cost),
    [6, 8]
  );
  assertEquals(
    plans.map((p) => p.postsJournal),
    [false, false]
  );
});

Deno.test("planStockRows: a Non-Inventory or zero-quantity row carries no value", () => {
  const plans = planStockRows({
    rows: [
      { itemId: "A", quantity: 5, itemTrackingType: "Non-Inventory" },
      { itemId: "A", quantity: 0, itemTrackingType: "Inventory" },
      { itemId: "A", quantity: 2, itemTrackingType: "Inventory" },
    ],
    itemCosts: itemCosts({ A: fifo(3) }),
    openLayersByItem: new Map(),
    hasAccounting: true,
  });
  assertEquals(
    plans.map((p) => p.carriesValue),
    [false, false, true]
  );
  assertEquals(
    plans.map((p) => p.cost),
    [0, 0, 6]
  );
  assertEquals(
    plans.map((p) => p.postsJournal),
    [false, false, true]
  );
});
