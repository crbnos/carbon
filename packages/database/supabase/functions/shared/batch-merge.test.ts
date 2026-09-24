import {
  assertEquals,
  assertThrows
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { type BatchMergeParent, buildBatchMergeRecords } from "./batch-merge.ts";

function parent(overrides: Partial<BatchMergeParent> = {}): BatchMergeParent {
  return {
    id: "p1",
    readableId: "LOT-A",
    quantity: 10,
    receivedQuantity: 10,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentId: "item-1",
    sourceDocumentReadableId: "SALAD-01",
    itemId: "item-1",
    expirationDate: null,
    attributes: null,
    bin: { storageUnitId: "bin-1", locationId: "loc-1" },
    ...overrides
  };
}

const base = {
  mergedId: "merged-1",
  mergeActivityId: "act-1",
  readableId: "LOT-M",
  companyId: "co",
  userId: "user",
  postingDate: "2026-09-16"
};

Deno.test("merges two lots into one entity with the summed quantity", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 45 }),
      parent({ id: "p2", readableId: "LOT-B", quantity: 44 })
    ]
  });

  assertEquals(records.mergedEntityInsert.quantity, 89);
  assertEquals(records.mergedEntityInsert.status, "Available");
  assertEquals(records.mergedEntityInsert.readableId, "LOT-M");
  assertEquals(records.mergedEntityInsert.attributes["Merged From Entity IDs"], [
    "p1",
    "p2"
  ]);
  assertEquals(records.parentUpdates, [
    { id: "p1", status: "Consumed" },
    { id: "p2", status: "Consumed" }
  ]);
  assertEquals(records.activityInsert.type, "Merge");
  assertEquals(records.activityInputInserts.length, 2);
  assertEquals(records.activityInputInserts[0].quantity, 45);
  assertEquals(records.activityInputInserts[1].quantity, 44);
  assertEquals(records.activityOutputInsert.trackedEntityId, "merged-1");
  assertEquals(records.activityOutputInsert.quantity, 89);
});

Deno.test("ledger rows are net-zero and never move stock between bins", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 45, receivedQuantity: 45, bin: { storageUnitId: "bin-1", locationId: "loc-1" } }),
      parent({ id: "p2", quantity: 44, receivedQuantity: 44, bin: { storageUnitId: "bin-2", locationId: "loc-1" } })
    ]
  });

  assertEquals(records.ledgerInserts.length, 4);
  const net = records.ledgerInserts.reduce((sum, l) => sum + l.quantity, 0);
  assertEquals(net, 0);
  // Every bin nets to zero: the merged lot gets each parent's stock where it
  // already sits.
  const byBin = new Map<string, number>();
  for (const l of records.ledgerInserts) {
    byBin.set(l.storageUnitId ?? "", (byBin.get(l.storageUnitId ?? "") ?? 0) + l.quantity);
  }
  assertEquals(byBin.get("bin-1"), 0);
  assertEquals(byBin.get("bin-2"), 0);
  const merged = records.ledgerInserts.filter((l) => l.quantity > 0);
  assertEquals(
    merged.map((l) => [l.storageUnitId, l.quantity]),
    [["bin-1", 45], ["bin-2", 44]]
  );
  for (const l of records.ledgerInserts) {
    assertEquals(l.documentType, "Batch Merge");
  }
});

Deno.test("merged lot inherits the first parent's number when none is given", () => {
  const { readableId, ...rest } = base;
  const records = buildBatchMergeRecords({
    ...rest,
    parents: [
      parent({ id: "p1", readableId: "LOT-A" }),
      parent({ id: "p2", readableId: "LOT-B" })
    ]
  });
  // An Available lot with a null number is unidentifiable on the floor; the
  // split builder's child inherits parent.readableId for the same reason.
  assertEquals(records.mergedEntityInsert.readableId, "LOT-A");
});

Deno.test("earliest parent expiry wins", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", expirationDate: "2026-10-01" }),
      parent({ id: "p2", expirationDate: "2026-09-20" }),
      parent({ id: "p3", expirationDate: null })
    ]
  });
  assertEquals(records.mergedEntityInsert.expirationDate, "2026-09-20");
});

Deno.test("attributes kept only where every parent agrees; pointer keys dropped", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({
        id: "p1",
        attributes: {
          Supplier: "Acme",
          "Grow Room": "R1",
          "Split From Entity ID": "old"
        }
      }),
      parent({
        id: "p2",
        attributes: { Supplier: "Acme", "Grow Room": "R2" }
      })
    ]
  });
  assertEquals(records.mergedEntityInsert.attributes.Supplier, "Acme");
  assertEquals(records.mergedEntityInsert.attributes["Grow Room"], undefined);
  assertEquals(
    records.mergedEntityInsert.attributes["Split From Entity ID"],
    undefined
  );
});

Deno.test("rejects mixed items", () => {
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [
          parent({ id: "p1" }),
          parent({ id: "p2", itemId: "item-2", sourceDocumentId: "item-2" })
        ]
      }),
    Error,
    "same item"
  );
});

Deno.test("rejects fewer than two lots", () => {
  assertThrows(
    () => buildBatchMergeRecords({ ...base, parents: [parent()] }),
    Error,
    "At least two"
  );
});

Deno.test("rejects unavailable or empty parents", () => {
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [parent(), parent({ id: "p2", status: "Consumed" })]
      }),
    Error,
    "not available"
  );
  assertThrows(
    () =>
      buildBatchMergeRecords({
        ...base,
        parents: [parent(), parent({ id: "p2", quantity: 0 })]
      }),
    Error,
    "no quantity"
  );
});

Deno.test("ledger books the FK-enforced itemId, not the polymorphic sourceDocumentId", () => {
  // sourceDocumentId is legacy and polymorphic — on a WIP output entity it can
  // point at a jobMakeMethod, or be "". The ledger must book the same item the
  // same-item check validated.
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", itemId: "item-1", sourceDocumentId: "jmm-1" }),
      parent({ id: "p2", itemId: "item-1", sourceDocumentId: "" })
    ]
  });

  for (const row of records.ledgerInserts) {
    assertEquals(row.itemId, "item-1");
  }
});

Deno.test("unreceived parents contribute no ledger rows; receipts stay per job", () => {
  // Lots straight off a completed batch: nothing received yet. The merge is
  // identity-only — no stock exists to move, so no ledger rows at all.
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 2, receivedQuantity: 0 }),
      parent({ id: "p2", quantity: 2, receivedQuantity: 0 }),
      parent({ id: "p3", quantity: 2, receivedQuantity: 0 })
    ]
  });
  assertEquals(records.ledgerInserts.length, 0);
  // identity level is untouched: the merged lot still carries all six units
  assertEquals(records.mergedEntityInsert.quantity, 6);
});

Deno.test("partially received merge moves exactly the received balance", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 2, receivedQuantity: 2 }),
      parent({ id: "p2", quantity: 2, receivedQuantity: 0 })
    ]
  });
  const rows = records.ledgerInserts;
  assertEquals(rows.length, 2);
  assertEquals(rows[0].trackedEntityId, "p1");
  assertEquals(rows[0].quantity, -2);
  assertEquals(rows[1].trackedEntityId, "merged-1");
  assertEquals(rows[1].quantity, 2);
  assertEquals(
    rows.reduce((acc, r) => acc + r.quantity, 0),
    0
  );
});

Deno.test("sums parents at the persist boundary: 0.1 + 0.2 => exactly 0.3", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 0.1, receivedQuantity: 0.1 }),
      parent({ id: "p2", readableId: "LOT-B", quantity: 0.2, receivedQuantity: 0.2 })
    ]
  });
  assertEquals(records.mergedEntityInsert.quantity, 0.3);
  assertEquals(records.activityInsert.attributes["Merged Quantity"], 0.3);
  assertEquals(records.activityOutputInsert.quantity, 0.3);
  // The positive lands in one bin (both parents share it) and nets the negatives.
  const positives = records.ledgerInserts.filter((r) => r.quantity > 0);
  const negatives = records.ledgerInserts.filter((r) => r.quantity < 0);
  assertEquals(positives.length, 1);
  assertEquals(positives[0].quantity, 0.3);
  // Each row is a clean 5dp value; the pool balances (the raw float sum of
  // -0.1 + -0.2 + 0.3 carries ~5e-17 noise, which is not a stored value).
  assertEquals(negatives.map((r) => r.quantity), [-0.1, -0.2]);
  assertEquals(
    Math.abs(records.ledgerInserts.reduce((acc, r) => acc + r.quantity, 0)) <
      1e-9,
    true
  );
});

Deno.test("rounds received quantity PER PARENT so the bin rows net to zero", () => {
  // Three parents sharing one bin, each holding a third of a unit. Rounding
  // only the bin total gives 1 against negatives of 0.33333 × 3 = 0.99999 —
  // the Batch Merge pair leaks a minor unit. Per-parent rounding nets exactly.
  const third = 1 / 3;
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: third, receivedQuantity: third }),
      parent({ id: "p2", readableId: "LOT-B", quantity: third, receivedQuantity: third }),
      parent({ id: "p3", readableId: "LOT-C", quantity: third, receivedQuantity: third })
    ]
  });
  const positives = records.ledgerInserts.filter((r) => r.quantity > 0);
  const negatives = records.ledgerInserts.filter((r) => r.quantity < 0);
  assertEquals(negatives.map((r) => r.quantity), [-0.33333, -0.33333, -0.33333]);
  assertEquals(positives.length, 1);
  assertEquals(positives[0].quantity, 0.99999);
  assertEquals(
    records.ledgerInserts.reduce((acc, r) => acc + r.quantity, 0) < 1e-9,
    true
  );
});
