// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  buildStockItemMap,
  classifyStockRow,
  isIsoDate,
  itemKey,
  type StockImportTable,
  type StockItemInfo,
  storageUnitKey,
  trackedKey
} from "./classify-stock-row";

const items = new Map<string, StockItemInfo>([
  [
    itemKey("PN-INV", "0"),
    { id: "inv-1", itemTrackingType: "Inventory", hasItemCost: true }
  ],
  [
    itemKey("PN-INV", "B"),
    { id: "inv-b", itemTrackingType: "Inventory", hasItemCost: true }
  ],
  [
    itemKey("PN-BATCH", "0"),
    { id: "bat-1", itemTrackingType: "Batch", hasItemCost: true }
  ],
  [
    itemKey("PN-SER", "0"),
    { id: "ser-1", itemTrackingType: "Serial", hasItemCost: true }
  ],
  [
    itemKey("PN-SER2", "0"),
    { id: "ser-2", itemTrackingType: "Serial", hasItemCost: true }
  ],
  [
    itemKey("PN-SVC", "0"),
    { id: "svc-1", itemTrackingType: "Non-Inventory", hasItemCost: true }
  ],
  [
    itemKey("PN-NOCOST", "0"),
    { id: "nc-1", itemTrackingType: "Inventory", hasItemCost: false }
  ]
]);

const ctx = (
  overrides: Partial<Parameters<typeof classifyStockRow>[0]> = {}
) => ({
  itemMap: items,
  locationIds: new Set(["loc-1", "loc-2"]),
  storageUnitMap: new Map([[storageUnitKey("loc-1", "Bin A"), "su-a"]]),
  existingTrackedKeys: new Set<string>(),
  seenTrackedKeys: new Set<string>(),
  ...overrides
});

const classify = (
  table: StockImportTable,
  record: Record<string, string>,
  overrides: Partial<Parameters<typeof classifyStockRow>[0]> = {}
) => classifyStockRow({ ...ctx(overrides), table, record });

const reason = (d: ReturnType<typeof classifyStockRow>) =>
  d.action === "skip" ? `${d.category}: ${d.reason}` : "post";

it("inventory row resolves item, location, storage unit and quantity", () => {
  expect(
    classify("inventoryQuantity", {
      readableId: " PN-INV ",
      revision: "",
      locationId: "loc-1",
      storageUnitName: "bin a",
      quantity: "12.5",
      comment: " opening balance "
    })
  ).toEqual({
    action: "post",
    row: {
      itemId: "inv-1",
      locationId: "loc-1",
      storageUnitId: "su-a",
      quantity: 12.5,
      readableId: null,
      expirationDate: null,
      comment: "opening balance",
      trackedKey: null
    }
  });
});

it("revision selects the matching item revision", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    revision: "B",
    locationId: "loc-1",
    quantity: "1"
  });
  expect(d.action === "post" ? d.row.itemId : null).toEqual("inv-b");
});

it("blank storage unit posts to the location with no storage unit", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    locationId: "loc-2",
    quantity: "3"
  });
  expect(d.action === "post" ? d.row.storageUnitId : "x").toEqual(null);
});

it("missing part number and unknown item are errors", () => {
  expect(
    reason(
      classify("inventoryQuantity", { locationId: "loc-1", quantity: "1" })
    )
  ).toEqual("error: Missing required Part Number");
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "NOPE",
        revision: "C",
        locationId: "loc-1",
        quantity: "1"
      })
    )
  ).toEqual("error: Item NOPE rev C not found");
});

it("tracking type mismatch points at the right import", () => {
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-BATCH",
        locationId: "loc-1",
        quantity: "1"
      })
    )
  ).toEqual(
    "error: Item PN-BATCH rev 0 is Batch tracked; use the Batch Quantities import"
  );
  expect(
    reason(
      classify("serialQuantity", {
        readableId: "PN-INV",
        locationId: "loc-1",
        serialNumber: "S1"
      })
    )
  ).toEqual(
    "error: Item PN-INV rev 0 is Inventory tracked; use the Inventory Quantities import"
  );
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-SVC",
        locationId: "loc-1",
        quantity: "1"
      })
    )
  ).toEqual(
    "error: Item PN-SVC rev 0 is Non-Inventory tracked and holds no stock"
  );
});

it("location must be present and belong to the company", () => {
  expect(
    reason(
      classify("inventoryQuantity", { readableId: "PN-INV", quantity: "1" })
    )
  ).toEqual("error: Missing required Location");
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-INV",
        locationId: "other",
        quantity: "1"
      })
    )
  ).toEqual("error: Location not found");
});

it("a named storage unit that is not in the row's location is an error", () => {
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-INV",
        locationId: "loc-2",
        storageUnitName: "Bin A",
        quantity: "1"
      })
    )
  ).toEqual('error: Storage unit "Bin A" not found in this location');
});

it("quantity must be a positive number", () => {
  for (const quantity of ["", "0", "-2", "abc", "Infinity"]) {
    expect(
      reason(
        classify("batchQuantity", {
          readableId: "PN-BATCH",
          locationId: "loc-1",
          batchNumber: "L1",
          quantity
        })
      )
    ).toEqual("error: Quantity must be a positive number");
  }
});

it("serial rows are always one unit and ignore any quantity", () => {
  const d = classify("serialQuantity", {
    readableId: "PN-SER",
    locationId: "loc-1",
    serialNumber: "SN-1",
    quantity: "5"
  });
  expect(d.action === "post" ? d.row.quantity : null).toEqual(1);
});

it("batch and serial numbers are required", () => {
  expect(
    reason(
      classify("batchQuantity", {
        readableId: "PN-BATCH",
        locationId: "loc-1",
        quantity: "1"
      })
    )
  ).toEqual("error: Missing required Batch Number");
  expect(
    reason(
      classify("serialQuantity", {
        readableId: "PN-SER",
        locationId: "loc-1",
        serialNumber: " "
      })
    )
  ).toEqual("error: Missing required Serial Number");
});

it("expiration date is optional and must be a real ISO date", () => {
  const base = {
    readableId: "PN-BATCH",
    locationId: "loc-1",
    batchNumber: "L1",
    quantity: "2"
  };
  const ok = classify("batchQuantity", {
    ...base,
    expirationDate: "2027-02-28"
  });
  expect(ok.action === "post" ? ok.row.expirationDate : null).toEqual(
    "2027-02-28"
  );
  expect(
    reason(classify("batchQuantity", { ...base, expirationDate: "2027-02-30" }))
  ).toEqual(
    'error: Expiration Date "2027-02-30" is not a valid date (use YYYY-MM-DD)'
  );
  expect(
    reason(classify("batchQuantity", { ...base, expirationDate: "02/01/2027" }))
  ).toEqual(
    'error: Expiration Date "02/01/2027" is not a valid date (use YYYY-MM-DD)'
  );
});

it("isIsoDate handles leap years", () => {
  expect(isIsoDate("2028-02-29")).toEqual(true);
  expect(isIsoDate("2027-02-29")).toEqual(false);
  expect(isIsoDate("2100-02-29")).toEqual(false);
  expect(isIsoDate("2000-02-29")).toEqual(true);
  expect(isIsoDate("2027-13-01")).toEqual(false);
});

it("an item without an item cost record is an error", () => {
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-NOCOST",
        locationId: "loc-1",
        quantity: "1"
      })
    )
  ).toEqual("error: Item PN-NOCOST rev 0 has no item cost record");
});

it("a serial that already exists on the item is skipped", () => {
  expect(
    reason(
      classify(
        "serialQuantity",
        { readableId: "PN-SER", locationId: "loc-1", serialNumber: "SN-1" },
        { existingTrackedKeys: new Set([trackedKey("ser-1", "SN-1")]) }
      )
    )
  ).toEqual('skipped: Serial number "SN-1" already exists for this item');
});

it("a serial repeated in the file is skipped; the same serial on another item posts", () => {
  const seenTrackedKeys = new Set<string>();
  const first = classify(
    "serialQuantity",
    { readableId: "PN-SER", locationId: "loc-1", serialNumber: "SN-1" },
    { seenTrackedKeys }
  );
  expect(first.action).toEqual("post");
  if (first.action === "post") seenTrackedKeys.add(first.row.trackedKey!);

  expect(
    reason(
      classify(
        "serialQuantity",
        { readableId: "PN-SER", locationId: "loc-2", serialNumber: "SN-1" },
        { seenTrackedKeys }
      )
    )
  ).toEqual('skipped: Duplicate serial number "SN-1" for this item in file');
  expect(
    classify(
      "serialQuantity",
      { readableId: "PN-SER2", locationId: "loc-1", serialNumber: "SN-1" },
      { seenTrackedKeys }
    ).action
  ).toEqual("post");
});

it("an existing batch number on the item is skipped", () => {
  expect(
    reason(
      classify(
        "batchQuantity",
        {
          readableId: "PN-BATCH",
          locationId: "loc-1",
          batchNumber: "L1",
          quantity: "4"
        },
        { existingTrackedKeys: new Set([trackedKey("bat-1", "L1")]) }
      )
    )
  ).toEqual('skipped: Batch number "L1" already exists for this item');
});

it("a batch repeated in the file for the same item is skipped; the same batch on another item posts", () => {
  const batchItems = new Map(items);
  batchItems.set(itemKey("PN-BATCH2", "0"), {
    id: "bat-2",
    itemTrackingType: "Batch",
    hasItemCost: true
  });
  const seenTrackedKeys = new Set<string>();
  const first = classify(
    "batchQuantity",
    {
      readableId: "PN-BATCH",
      locationId: "loc-1",
      batchNumber: "L1",
      quantity: "4"
    },
    { itemMap: batchItems, seenTrackedKeys }
  );
  expect(first.action).toEqual("post");
  if (first.action === "post") seenTrackedKeys.add(first.row.trackedKey!);

  expect(
    reason(
      classify(
        "batchQuantity",
        {
          readableId: "PN-BATCH",
          locationId: "loc-2",
          batchNumber: "L1",
          quantity: "2"
        },
        { itemMap: batchItems, seenTrackedKeys }
      )
    )
  ).toEqual('skipped: Duplicate batch number "L1" for this item in file');
  expect(
    classify(
      "batchQuantity",
      {
        readableId: "PN-BATCH2",
        locationId: "loc-1",
        batchNumber: "L1",
        quantity: "2"
      },
      { itemMap: batchItems, seenTrackedKeys }
    ).action
  ).toEqual("post");
});

it("items sharing Part Number + Revision: the one matching the import's tracking type wins", () => {
  const candidates = [
    {
      id: "a-part",
      readableId: "X-100",
      revision: "0",
      itemTrackingType: "Batch",
      hasItemCost: true
    },
    {
      id: "b-tool",
      readableId: "X-100",
      revision: "0",
      itemTrackingType: "Inventory",
      hasItemCost: true
    }
  ];
  expect(
    buildStockItemMap("inventoryQuantity", candidates).get(
      itemKey("X-100", "0")
    )?.id
  ).toEqual("b-tool");
  expect(
    buildStockItemMap("batchQuantity", candidates).get(itemKey("X-100", "0"))
      ?.id
  ).toEqual("a-part");
  // Neither matches: the first candidate in input order wins, so the row error
  // names a stable item.
  expect(
    buildStockItemMap("serialQuantity", candidates).get(itemKey("X-100", "0"))
      ?.id
  ).toEqual("a-part");
  // A null revision keys as "0".
  expect(
    buildStockItemMap("batchQuantity", [
      { ...candidates[0]!, revision: null }
    ]).get(itemKey("X-100", "0"))?.id
  ).toEqual("a-part");
});

it("two items of the import's tracking type share the identity: rows are rejected", () => {
  const candidates = [
    {
      id: "a-part",
      readableId: "X-100",
      revision: "0",
      itemTrackingType: "Inventory",
      hasItemCost: true
    },
    {
      id: "b-tool",
      readableId: "X-100",
      revision: "0",
      itemTrackingType: "Inventory",
      hasItemCost: true
    }
  ];
  const itemMap = buildStockItemMap("inventoryQuantity", candidates);
  expect(itemMap.get(itemKey("X-100", "0"))?.ambiguous).toEqual(true);
  expect(
    reason(
      classify(
        "inventoryQuantity",
        { readableId: "X-100", locationId: "loc-1", quantity: "5" },
        { itemMap }
      )
    )
  ).toEqual(
    "error: More than one item is Inventory tracked with part number X-100 rev 0"
  );
  // One match plus one of another tracking type is still unambiguous.
  const mixed = buildStockItemMap("inventoryQuantity", [
    candidates[0]!,
    { ...candidates[1]!, itemTrackingType: "Batch" }
  ]);
  expect(mixed.get(itemKey("X-100", "0"))?.ambiguous).toEqual(undefined);
  expect(mixed.get(itemKey("X-100", "0"))?.id).toEqual("a-part");
});

it("quantity is rounded to posting precision before it is validated", () => {
  // Rounds to 0 at the ledger's scale, so it would post a movement that adds
  // nothing: rejected instead.
  expect(
    reason(
      classify("inventoryQuantity", {
        readableId: "PN-INV",
        locationId: "loc-1",
        quantity: "0.000001"
      })
    )
  ).toEqual("error: Quantity must be a positive number");
  // A quantity finer than the scale carries the ROUNDED value, so the tracked
  // entity and the item ledger agree.
  const decision = classify("batchQuantity", {
    readableId: "PN-BATCH",
    locationId: "loc-1",
    batchNumber: "L-ROUND",
    quantity: "1.0000049"
  });
  expect(decision.action === "post" ? decision.row.quantity : null).toEqual(
    1.0
  );
});

it("inventory rows have no natural key: identical rows both post", () => {
  const record = { readableId: "PN-INV", locationId: "loc-1", quantity: "1" };
  const seenTrackedKeys = new Set<string>();
  expect(
    classify("inventoryQuantity", record, { seenTrackedKeys }).action
  ).toEqual("post");
  expect(
    classify("inventoryQuantity", record, { seenTrackedKeys }).action
  ).toEqual("post");
  expect(seenTrackedKeys.size).toEqual(0);
});

it("inventory rows ignore an expiration date column", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    locationId: "loc-1",
    quantity: "1",
    expirationDate: "not a date"
  });
  expect(d.action === "post" ? d.row.expirationDate : "x").toEqual(null);
});
