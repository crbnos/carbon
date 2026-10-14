// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { type BatchMergeParent, buildBatchMergeRecords } from "./batch-merge";

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

it("merges two lots into one entity with the summed quantity", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 45 }),
      parent({ id: "p2", readableId: "LOT-B", quantity: 44 })
    ]
  });

  expect(records.mergedEntityInsert.quantity).toEqual(89);
  expect(records.mergedEntityInsert.status).toEqual("Available");
  expect(records.mergedEntityInsert.readableId).toEqual("LOT-M");
  expect(
    records.mergedEntityInsert.attributes["Merged From Entity IDs"]
  ).toEqual(["p1", "p2"]);
  expect(records.parentUpdates).toEqual([
    { id: "p1", status: "Consumed" },
    { id: "p2", status: "Consumed" }
  ]);
  expect(records.activityInsert.type).toEqual("Merge");
  expect(records.activityInputInserts.length).toEqual(2);
  expect(records.activityInputInserts[0]!.quantity).toEqual(45);
  expect(records.activityInputInserts[1]!.quantity).toEqual(44);
  expect(records.activityOutputInsert.trackedEntityId).toEqual("merged-1");
  expect(records.activityOutputInsert.quantity).toEqual(89);
});

it("ledger rows are net-zero and never move stock between bins", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({
        id: "p1",
        quantity: 45,
        receivedQuantity: 45,
        bin: { storageUnitId: "bin-1", locationId: "loc-1" }
      }),
      parent({
        id: "p2",
        quantity: 44,
        receivedQuantity: 44,
        bin: { storageUnitId: "bin-2", locationId: "loc-1" }
      })
    ]
  });

  expect(records.ledgerInserts.length).toEqual(4);
  const net = records.ledgerInserts.reduce((sum, l) => sum + l.quantity, 0);
  expect(net).toEqual(0);
  // Every bin nets to zero: the merged lot gets each parent's stock where it
  // already sits.
  const byBin = new Map<string, number>();
  for (const l of records.ledgerInserts) {
    byBin.set(
      l.storageUnitId ?? "",
      (byBin.get(l.storageUnitId ?? "") ?? 0) + l.quantity
    );
  }
  expect(byBin.get("bin-1")).toEqual(0);
  expect(byBin.get("bin-2")).toEqual(0);
  const merged = records.ledgerInserts.filter((l) => l.quantity > 0);
  expect(merged.map((l) => [l.storageUnitId, l.quantity])).toEqual([
    ["bin-1", 45],
    ["bin-2", 44]
  ]);
  for (const l of records.ledgerInserts) {
    expect(l.documentType).toEqual("Batch Merge");
  }
});

it("merged lot inherits the first parent's number when none is given", () => {
  const { readableId: _readableId, ...rest } = base;
  const records = buildBatchMergeRecords({
    ...rest,
    parents: [
      parent({ id: "p1", readableId: "LOT-A" }),
      parent({ id: "p2", readableId: "LOT-B" })
    ]
  });
  // An Available lot with a null number is unidentifiable on the floor; the
  // split builder's child inherits parent.readableId for the same reason.
  expect(records.mergedEntityInsert.readableId).toEqual("LOT-A");
});

it("earliest parent expiry wins", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", expirationDate: "2026-10-01" }),
      parent({ id: "p2", expirationDate: "2026-09-20" }),
      parent({ id: "p3", expirationDate: null })
    ]
  });
  expect(records.mergedEntityInsert.expirationDate).toEqual("2026-09-20");
});

it("attributes kept only where every parent agrees; pointer keys dropped", () => {
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
  expect(records.mergedEntityInsert.attributes.Supplier).toEqual("Acme");
  expect(records.mergedEntityInsert.attributes["Grow Room"]).toEqual(undefined);
  expect(records.mergedEntityInsert.attributes["Split From Entity ID"]).toEqual(
    undefined
  );
});

it("rejects mixed items", () => {
  expect(() =>
    buildBatchMergeRecords({
      ...base,
      parents: [
        parent({ id: "p1" }),
        parent({ id: "p2", itemId: "item-2", sourceDocumentId: "item-2" })
      ]
    })
  ).toThrow("same item");
});

it("rejects fewer than two lots", () => {
  expect(() =>
    buildBatchMergeRecords({ ...base, parents: [parent()] })
  ).toThrow("At least two");
});

it("rejects unavailable or empty parents", () => {
  expect(() =>
    buildBatchMergeRecords({
      ...base,
      parents: [parent(), parent({ id: "p2", status: "Consumed" })]
    })
  ).toThrow("not available");
  expect(() =>
    buildBatchMergeRecords({
      ...base,
      parents: [parent(), parent({ id: "p2", quantity: 0 })]
    })
  ).toThrow("no quantity");
});

it("ledger books the FK-enforced itemId, not the polymorphic sourceDocumentId", () => {
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
    expect(row.itemId).toEqual("item-1");
  }
});

it("unreceived parents contribute no ledger rows; receipts stay per job", () => {
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
  expect(records.ledgerInserts.length).toEqual(0);
  // identity level is untouched: the merged lot still carries all six units
  expect(records.mergedEntityInsert.quantity).toEqual(6);
});

it("partially received merge moves exactly the received balance", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 2, receivedQuantity: 2 }),
      parent({ id: "p2", quantity: 2, receivedQuantity: 0 })
    ]
  });
  const rows = records.ledgerInserts;
  expect(rows.length).toEqual(2);
  expect(rows[0]!.trackedEntityId).toEqual("p1");
  expect(rows[0]!.quantity).toEqual(-2);
  expect(rows[1]!.trackedEntityId).toEqual("merged-1");
  expect(rows[1]!.quantity).toEqual(2);
  expect(rows.reduce((acc, r) => acc + r.quantity, 0)).toEqual(0);
});

it("sums parents at the persist boundary: 0.1 + 0.2 => exactly 0.3", () => {
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: 0.1, receivedQuantity: 0.1 }),
      parent({
        id: "p2",
        readableId: "LOT-B",
        quantity: 0.2,
        receivedQuantity: 0.2
      })
    ]
  });
  expect(records.mergedEntityInsert.quantity).toEqual(0.3);
  expect(records.activityInsert.attributes["Merged Quantity"]).toEqual(0.3);
  expect(records.activityOutputInsert.quantity).toEqual(0.3);
  // The positive lands in one bin (both parents share it) and nets the negatives.
  const positives = records.ledgerInserts.filter((r) => r.quantity > 0);
  const negatives = records.ledgerInserts.filter((r) => r.quantity < 0);
  expect(positives.length).toEqual(1);
  expect(positives[0]!.quantity).toEqual(0.3);
  // Each row is a clean 5dp value; the pool balances (the raw float sum of
  // -0.1 + -0.2 + 0.3 carries ~5e-17 noise, which is not a stored value).
  expect(negatives.map((r) => r.quantity)).toEqual([-0.1, -0.2]);
  expect(
    Math.abs(records.ledgerInserts.reduce((acc, r) => acc + r.quantity, 0)) <
      1e-9
  ).toEqual(true);
});

it("rounds received quantity PER PARENT so the bin rows net to zero", () => {
  // Three parents sharing one bin, each holding a third of a unit. Rounding
  // only the bin total gives 1 against negatives of 0.33333 × 3 = 0.99999 —
  // the Batch Merge pair leaks a minor unit. Per-parent rounding nets exactly.
  const third = 1 / 3;
  const records = buildBatchMergeRecords({
    ...base,
    parents: [
      parent({ id: "p1", quantity: third, receivedQuantity: third }),
      parent({
        id: "p2",
        readableId: "LOT-B",
        quantity: third,
        receivedQuantity: third
      }),
      parent({
        id: "p3",
        readableId: "LOT-C",
        quantity: third,
        receivedQuantity: third
      })
    ]
  });
  const positives = records.ledgerInserts.filter((r) => r.quantity > 0);
  const negatives = records.ledgerInserts.filter((r) => r.quantity < 0);
  expect(negatives.map((r) => r.quantity)).toEqual([
    -0.33333, -0.33333, -0.33333
  ]);
  expect(positives.length).toEqual(1);
  expect(positives[0]!.quantity).toEqual(0.99999);
  expect(
    records.ledgerInserts.reduce((acc, r) => acc + r.quantity, 0) < 1e-9
  ).toEqual(true);
});
