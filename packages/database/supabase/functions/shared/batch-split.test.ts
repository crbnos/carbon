import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  type BatchSplitInput,
  buildBatchSplitRecords,
  buildMergeRecords,
  isFullDraw
} from "./batch-split.ts";

const splitInput = (
  overrides: Partial<BatchSplitInput> = {}
): BatchSplitInput => ({
  parent: {
    id: "parent-1",
    readableId: "2026/09",
    quantity: 8,
    sourceDocument: "Item",
    sourceDocumentId: "item-1",
    sourceDocumentReadableId: "SD08810001",
    itemId: "item-1",
    expirationDate: "2026-12-31",
    attributes: { Receipt: "receipt-1", Supplier: "supplier-1" },
    ...(overrides.parent ?? {})
  },
  drawQuantity: 1,
  childId: "child-1",
  splitActivityId: "split-1",
  activitySourceDocument: "Picking List",
  activitySourceDocumentId: "pl-1",
  bin: { storageUnitId: "shelf-a", locationId: "loc-1" },
  itemLedgerItemId: "item-1",
  companyId: "co-1",
  userId: "user-1",
  postingDate: "2026-08-04",
  childStatus: "Available",
  ...overrides
});

Deno.test("child (not parent) carries Split From Entity ID", () => {
  const r = buildBatchSplitRecords(splitInput());
  assertEquals(r.childEntityInsert.attributes["Split From Entity ID"], "parent-1");
  // Parent attributes are untouched — the update only decrements quantity.
  assertEquals(r.parentUpdate, { quantity: 7 });
});

Deno.test("child clones parent attributes minus stale pointer keys", () => {
  const r = buildBatchSplitRecords(
    splitInput({
      parent: {
        id: "parent-1",
        readableId: "2026/09",
        quantity: 8,
        sourceDocument: "Item",
        sourceDocumentId: "item-1",
        sourceDocumentReadableId: "SD08810001",
        itemId: "item-1",
        expirationDate: null,
        attributes: {
          Receipt: "receipt-1",
          "Split Entity ID": "old-forward",
          "Split From Entity ID": "old-back"
        }
      }
    })
  );
  assertEquals(r.childEntityInsert.attributes.Receipt, "receipt-1");
  assertEquals(r.childEntityInsert.attributes["Split Entity ID"], undefined);
  assertEquals(
    r.childEntityInsert.attributes["Split From Entity ID"],
    "parent-1"
  );
});

Deno.test("extra child attributes are applied on top of inherited ones", () => {
  const r = buildBatchSplitRecords(
    splitInput({
      extraChildAttributes: { "Job Operation Step": "step-1", Shipment: "sh-1" }
    })
  );
  assertEquals(r.childEntityInsert.attributes["Job Operation Step"], "step-1");
  assertEquals(r.childEntityInsert.attributes.Shipment, "sh-1");
  assertEquals(r.childEntityInsert.attributes.Receipt, "receipt-1");
});

Deno.test("child inherits identity fields and takes the drawn quantity", () => {
  const r = buildBatchSplitRecords(splitInput({ drawQuantity: 2.5 }));
  assertEquals(r.childEntityInsert.id, "child-1");
  assertEquals(r.childEntityInsert.readableId, "2026/09");
  assertEquals(r.childEntityInsert.quantity, 2.5);
  assertEquals(r.childEntityInsert.status, "Available");
  assertEquals(r.childEntityInsert.itemId, "item-1");
  assertEquals(r.childEntityInsert.expirationDate, "2026-12-31");
  assertEquals(r.parentUpdate.quantity, 5.5);
});

Deno.test("exactly one activity output and it is the child", () => {
  const r = buildBatchSplitRecords(splitInput());
  assertEquals(r.activityInputInsert.trackedEntityId, "parent-1");
  assertEquals(r.activityInputInsert.quantity, 1);
  assertEquals(r.activityOutputInsert.trackedEntityId, "child-1");
  assertEquals(r.activityOutputInsert.quantity, 1);
  assertEquals(r.activityInsert.type, "Split");
  assertEquals(r.activityInsert.attributes, {
    "Original Quantity": 8,
    "Drawn Quantity": 1,
    "Remaining Quantity": 7,
    "Split Entity ID": "child-1"
  });
});

Deno.test("ledger rows net to zero: −q on parent, +q on child, at the parent's bin", () => {
  const r = buildBatchSplitRecords(splitInput());
  const [minus, plus] = r.ledgerInserts;
  assertEquals(minus.quantity, -1);
  assertEquals(minus.trackedEntityId, "parent-1");
  assertEquals(minus.entryType, "Negative Adjmt.");
  assertEquals(plus.quantity, 1);
  assertEquals(plus.trackedEntityId, "child-1");
  assertEquals(plus.entryType, "Positive Adjmt.");
  assertEquals(minus.quantity + plus.quantity, 0);
  for (const row of r.ledgerInserts) {
    assertEquals(row.documentType, "Batch Split");
    assertEquals(row.documentId, "split-1");
    assertEquals(row.storageUnitId, "shelf-a");
    assertEquals(row.locationId, "loc-1");
    assertEquals(row.itemId, "item-1");
    assertEquals(row.postingDate, "2026-08-04");
  }
});

Deno.test("throws on drawQuantity <= 0", () => {
  assertThrows(() => buildBatchSplitRecords(splitInput({ drawQuantity: 0 })));
  assertThrows(() => buildBatchSplitRecords(splitInput({ drawQuantity: -1 })));
});

Deno.test("throws on drawQuantity >= parent quantity (full draw is not a split)", () => {
  assertThrows(() => buildBatchSplitRecords(splitInput({ drawQuantity: 8 })));
  assertThrows(() => buildBatchSplitRecords(splitInput({ drawQuantity: 9 })));
});

Deno.test("merge: quantities move child → parent, edges are input child / output parent", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.5 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  assertEquals(r.activityInsert.type, "Merge");
  assertEquals(r.activityInputInsert.trackedEntityId, "child-1");
  assertEquals(r.activityOutputInsert.trackedEntityId, "parent-1");
  assertEquals(r.activityInputInsert.quantity, 0.5);
  assertEquals(r.activityOutputInsert.quantity, 0.5);
  assertEquals(r.parentUpdate, { quantity: 7.5 });
});

Deno.test("merge: child is Consumed when drained to zero", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.5 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  assertEquals(r.childUpdate, { quantity: 0, status: "Consumed" });
});

Deno.test("merge: partial merge leaves the child Available with the remainder", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 2 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  assertEquals(r.childUpdate, { quantity: 1.5 });
});

Deno.test("merge: throws when mergeQuantity exceeds child quantity or is <= 0", () => {
  const base = {
    child: { id: "child-1", quantity: 1 },
    parent: { id: "parent-1", quantity: 7 },
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  };
  assertThrows(() => buildMergeRecords({ ...base, mergeQuantity: 2 }));
  assertThrows(() => buildMergeRecords({ ...base, mergeQuantity: 0 }));
});

// --- persist-boundary rounding (PR C) --------------------------------------

Deno.test("split: a float-residue draw persists clean 5dp quantities", () => {
  // Drawing 0.98 from 1 leaves 0.020000000000000018 in raw float; the parent,
  // child, ledger, edges and Split blob must all read the rounded values.
  const r = buildBatchSplitRecords(
    splitInput({ parent: { id: "parent-1", quantity: 1 }, drawQuantity: 0.98 })
  );
  assertEquals(r.parentUpdate, { quantity: 0.02 });
  assertEquals(r.childEntityInsert.quantity, 0.98);
  assertEquals(r.activityInsert.attributes, {
    "Original Quantity": 1,
    "Drawn Quantity": 0.98,
    "Remaining Quantity": 0.02,
    "Split Entity ID": "child-1"
  });
  assertEquals(r.activityInputInsert.quantity, 0.98);
  assertEquals(r.activityOutputInsert.quantity, 0.98);
  const [minus, plus] = r.ledgerInserts;
  assertEquals(minus.quantity, -0.98);
  assertEquals(plus.quantity, 0.98);
  assertEquals(minus.quantity + plus.quantity, 0);
});

Deno.test("merge: a 0.30000000000000004 child settles the parent to a clean quantity", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.1 + 0.2 },
    parent: { id: "parent-1", quantity: 0.1 },
    mergeQuantity: 0.1 + 0.2,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  assertEquals(r.activityInputInsert.quantity, 0.3);
  assertEquals(r.activityOutputInsert.quantity, 0.3);
  assertEquals(r.parentUpdate, { quantity: 0.4 });
  // Draining the whole (rounded) child flips it Consumed via an exact === 0.
  assertEquals(r.childUpdate, { quantity: 0, status: "Consumed" });
});

Deno.test("isFullDraw: an exact whole draw is full", () => {
  assertEquals(isFullDraw(10, 10), true);
  assertEquals(isFullDraw(0.02, 0.02), true);
});

Deno.test("isFullDraw: a residue draw is full, and would otherwise throw", () => {
  // The lot left after drawing 0.98 from 1 holds 0.020000000000000018. Drawing
  // 0.02 of it is the whole lot — a raw !== reads it as partial, and the
  // builder then refuses `draw >= parentQty` on a legitimate full pick.
  const residue = 1 - 0.98;
  assertEquals(residue === 0.02, false);
  assertEquals(isFullDraw(residue, 0.02), true);
  assertThrows(
    () =>
      buildBatchSplitRecords(splitInput({
        parent: { ...splitInput().parent, quantity: residue },
        drawQuantity: 0.02
      })),
    Error,
    "a full draw is not a split"
  );
});

Deno.test("isFullDraw: one minor unit of real stock is still a partial draw", () => {
  // 1e-5 is a storable difference at internal scale, not float noise.
  assertEquals(isFullDraw(1, 0.99999), false);
  assertEquals(isFullDraw(10, 9.99999), false);
});

Deno.test("isFullDraw: an over-draw is not reported as full", () => {
  assertEquals(isFullDraw(1, 1.5), false);
});
