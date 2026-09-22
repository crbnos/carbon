import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildStockItemMap,
  classifyStockRow,
  isIsoDate,
  itemKey,
  type StockImportTable,
  type StockItemInfo,
  storageUnitKey,
  trackedKey,
} from "./classify-stock-row.ts";

const items = new Map<string, StockItemInfo>([
  [itemKey("PN-INV", "0"), { id: "inv-1", itemTrackingType: "Inventory", hasItemCost: true }],
  [itemKey("PN-INV", "B"), { id: "inv-b", itemTrackingType: "Inventory", hasItemCost: true }],
  [itemKey("PN-BATCH", "0"), { id: "bat-1", itemTrackingType: "Batch", hasItemCost: true }],
  [itemKey("PN-SER", "0"), { id: "ser-1", itemTrackingType: "Serial", hasItemCost: true }],
  [itemKey("PN-SER2", "0"), { id: "ser-2", itemTrackingType: "Serial", hasItemCost: true }],
  [itemKey("PN-SVC", "0"), { id: "svc-1", itemTrackingType: "Non-Inventory", hasItemCost: true }],
  [itemKey("PN-NOCOST", "0"), { id: "nc-1", itemTrackingType: "Inventory", hasItemCost: false }],
]);

const ctx = (overrides: Partial<Parameters<typeof classifyStockRow>[0]> = {}) => ({
  itemMap: items,
  locationIds: new Set(["loc-1", "loc-2"]),
  storageUnitMap: new Map([[storageUnitKey("loc-1", "Bin A"), "su-a"]]),
  existingTrackedKeys: new Set<string>(),
  seenTrackedKeys: new Set<string>(),
  ...overrides,
});

const classify = (
  table: StockImportTable,
  record: Record<string, string>,
  overrides: Partial<Parameters<typeof classifyStockRow>[0]> = {}
) => classifyStockRow({ ...ctx(overrides), table, record });

const reason = (d: ReturnType<typeof classifyStockRow>) =>
  d.action === "skip" ? `${d.category}: ${d.reason}` : "post";

Deno.test("inventory row resolves item, location, storage unit and quantity", () => {
  assertEquals(
    classify("inventoryQuantity", {
      readableId: " PN-INV ",
      revision: "",
      locationId: "loc-1",
      storageUnitName: "bin a",
      quantity: "12.5",
      comment: " opening balance ",
    }),
    {
      action: "post",
      row: {
        itemId: "inv-1",
        locationId: "loc-1",
        storageUnitId: "su-a",
        quantity: 12.5,
        readableId: null,
        expirationDate: null,
        comment: "opening balance",
        trackedKey: null,
      },
    }
  );
});

Deno.test("revision selects the matching item revision", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    revision: "B",
    locationId: "loc-1",
    quantity: "1",
  });
  assertEquals(d.action === "post" ? d.row.itemId : null, "inv-b");
});

Deno.test("blank storage unit posts to the location with no storage unit", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    locationId: "loc-2",
    quantity: "3",
  });
  assertEquals(d.action === "post" ? d.row.storageUnitId : "x", null);
});

Deno.test("missing part number and unknown item are errors", () => {
  assertEquals(
    reason(classify("inventoryQuantity", { locationId: "loc-1", quantity: "1" })),
    "error: Missing required Part Number"
  );
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "NOPE", revision: "C", locationId: "loc-1", quantity: "1" })),
    "error: Item NOPE rev C not found"
  );
});

Deno.test("tracking type mismatch points at the right import", () => {
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-BATCH", locationId: "loc-1", quantity: "1" })),
    "error: Item PN-BATCH rev 0 is Batch tracked; use the Batch Quantities import"
  );
  assertEquals(
    reason(classify("serialQuantity", { readableId: "PN-INV", locationId: "loc-1", serialNumber: "S1" })),
    "error: Item PN-INV rev 0 is Inventory tracked; use the Inventory Quantities import"
  );
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-SVC", locationId: "loc-1", quantity: "1" })),
    "error: Item PN-SVC rev 0 is Non-Inventory tracked and holds no stock"
  );
});

Deno.test("location must be present and belong to the company", () => {
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-INV", quantity: "1" })),
    "error: Missing required Location"
  );
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-INV", locationId: "other", quantity: "1" })),
    "error: Location not found"
  );
});

Deno.test("a named storage unit that is not in the row's location is an error", () => {
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-INV", locationId: "loc-2", storageUnitName: "Bin A", quantity: "1" })),
    'error: Storage unit "Bin A" not found in this location'
  );
});

Deno.test("quantity must be a positive number", () => {
  for (const quantity of ["", "0", "-2", "abc", "Infinity"]) {
    assertEquals(
      reason(classify("batchQuantity", { readableId: "PN-BATCH", locationId: "loc-1", batchNumber: "L1", quantity })),
      "error: Quantity must be a positive number"
    );
  }
});

Deno.test("serial rows are always one unit and ignore any quantity", () => {
  const d = classify("serialQuantity", {
    readableId: "PN-SER",
    locationId: "loc-1",
    serialNumber: "SN-1",
    quantity: "5",
  });
  assertEquals(d.action === "post" ? d.row.quantity : null, 1);
});

Deno.test("batch and serial numbers are required", () => {
  assertEquals(
    reason(classify("batchQuantity", { readableId: "PN-BATCH", locationId: "loc-1", quantity: "1" })),
    "error: Missing required Batch Number"
  );
  assertEquals(
    reason(classify("serialQuantity", { readableId: "PN-SER", locationId: "loc-1", serialNumber: " " })),
    "error: Missing required Serial Number"
  );
});

Deno.test("expiration date is optional and must be a real ISO date", () => {
  const base = { readableId: "PN-BATCH", locationId: "loc-1", batchNumber: "L1", quantity: "2" };
  const ok = classify("batchQuantity", { ...base, expirationDate: "2027-02-28" });
  assertEquals(ok.action === "post" ? ok.row.expirationDate : null, "2027-02-28");
  assertEquals(
    reason(classify("batchQuantity", { ...base, expirationDate: "2027-02-30" })),
    'error: Expiration Date "2027-02-30" is not a valid date (use YYYY-MM-DD)'
  );
  assertEquals(
    reason(classify("batchQuantity", { ...base, expirationDate: "02/01/2027" })),
    'error: Expiration Date "02/01/2027" is not a valid date (use YYYY-MM-DD)'
  );
});

Deno.test("isIsoDate handles leap years", () => {
  assertEquals(isIsoDate("2028-02-29"), true);
  assertEquals(isIsoDate("2027-02-29"), false);
  assertEquals(isIsoDate("2100-02-29"), false);
  assertEquals(isIsoDate("2000-02-29"), true);
  assertEquals(isIsoDate("2027-13-01"), false);
});

Deno.test("an item without an item cost record is an error", () => {
  assertEquals(
    reason(classify("inventoryQuantity", { readableId: "PN-NOCOST", locationId: "loc-1", quantity: "1" })),
    "error: Item PN-NOCOST rev 0 has no item cost record"
  );
});

Deno.test("a serial that already exists on the item is skipped", () => {
  assertEquals(
    reason(
      classify(
        "serialQuantity",
        { readableId: "PN-SER", locationId: "loc-1", serialNumber: "SN-1" },
        { existingTrackedKeys: new Set([trackedKey("ser-1", "SN-1")]) }
      )
    ),
    'skipped: Serial number "SN-1" already exists for this item'
  );
});

Deno.test("a serial repeated in the file is skipped; the same serial on another item posts", () => {
  const seenTrackedKeys = new Set<string>();
  const first = classify(
    "serialQuantity",
    { readableId: "PN-SER", locationId: "loc-1", serialNumber: "SN-1" },
    { seenTrackedKeys }
  );
  assertEquals(first.action, "post");
  if (first.action === "post") seenTrackedKeys.add(first.row.trackedKey!);

  assertEquals(
    reason(
      classify(
        "serialQuantity",
        { readableId: "PN-SER", locationId: "loc-2", serialNumber: "SN-1" },
        { seenTrackedKeys }
      )
    ),
    'skipped: Duplicate serial number "SN-1" for this item in file'
  );
  assertEquals(
    classify(
      "serialQuantity",
      { readableId: "PN-SER2", locationId: "loc-1", serialNumber: "SN-1" },
      { seenTrackedKeys }
    ).action,
    "post"
  );
});

Deno.test("an existing batch number on the item is skipped", () => {
  assertEquals(
    reason(
      classify(
        "batchQuantity",
        { readableId: "PN-BATCH", locationId: "loc-1", batchNumber: "L1", quantity: "4" },
        { existingTrackedKeys: new Set([trackedKey("bat-1", "L1")]) }
      )
    ),
    'skipped: Batch number "L1" already exists for this item'
  );
});

Deno.test("a batch repeated in the file for the same item is skipped; the same batch on another item posts", () => {
  const batchItems = new Map(items);
  batchItems.set(itemKey("PN-BATCH2", "0"), { id: "bat-2", itemTrackingType: "Batch", hasItemCost: true });
  const seenTrackedKeys = new Set<string>();
  const first = classify(
    "batchQuantity",
    { readableId: "PN-BATCH", locationId: "loc-1", batchNumber: "L1", quantity: "4" },
    { itemMap: batchItems, seenTrackedKeys }
  );
  assertEquals(first.action, "post");
  if (first.action === "post") seenTrackedKeys.add(first.row.trackedKey!);

  assertEquals(
    reason(
      classify(
        "batchQuantity",
        { readableId: "PN-BATCH", locationId: "loc-2", batchNumber: "L1", quantity: "2" },
        { itemMap: batchItems, seenTrackedKeys }
      )
    ),
    'skipped: Duplicate batch number "L1" for this item in file'
  );
  assertEquals(
    classify(
      "batchQuantity",
      { readableId: "PN-BATCH2", locationId: "loc-1", batchNumber: "L1", quantity: "2" },
      { itemMap: batchItems, seenTrackedKeys }
    ).action,
    "post"
  );
});

Deno.test("items sharing Part Number + Revision: the one matching the import's tracking type wins", () => {
  const candidates = [
    { id: "a-part", readableId: "X-100", revision: "0", itemTrackingType: "Batch", hasItemCost: true },
    { id: "b-tool", readableId: "X-100", revision: "0", itemTrackingType: "Inventory", hasItemCost: true },
  ];
  assertEquals(buildStockItemMap("inventoryQuantity", candidates).get(itemKey("X-100", "0"))?.id, "b-tool");
  assertEquals(buildStockItemMap("batchQuantity", candidates).get(itemKey("X-100", "0"))?.id, "a-part");
  // Neither matches: the first candidate in input order wins, so the row error
  // names a stable item.
  assertEquals(buildStockItemMap("serialQuantity", candidates).get(itemKey("X-100", "0"))?.id, "a-part");
  // A null revision keys as "0".
  assertEquals(
    buildStockItemMap("batchQuantity", [{ ...candidates[0], revision: null }]).get(itemKey("X-100", "0"))?.id,
    "a-part"
  );
});

Deno.test("inventory rows have no natural key: identical rows both post", () => {
  const record = { readableId: "PN-INV", locationId: "loc-1", quantity: "1" };
  const seenTrackedKeys = new Set<string>();
  assertEquals(classify("inventoryQuantity", record, { seenTrackedKeys }).action, "post");
  assertEquals(classify("inventoryQuantity", record, { seenTrackedKeys }).action, "post");
  assertEquals(seenTrackedKeys.size, 0);
});

Deno.test("inventory rows ignore an expiration date column", () => {
  const d = classify("inventoryQuantity", {
    readableId: "PN-INV",
    locationId: "loc-1",
    quantity: "1",
    expirationDate: "not a date",
  });
  assertEquals(d.action === "post" ? d.row.expirationDate : "x", null);
});
