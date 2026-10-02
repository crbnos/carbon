// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  type BatchSplitInput,
  buildBatchSplitRecords,
  buildMergeRecords,
  isFullDraw
} from "./batch-split";

const splitInput = (
  overrides: Partial<Omit<BatchSplitInput, "parent">> & {
    parent?: Partial<BatchSplitInput["parent"]>;
  } = {}
): BatchSplitInput =>
  ({
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
  }) as BatchSplitInput;

it("child (not parent) carries Split From Entity ID", () => {
  const r = buildBatchSplitRecords(splitInput());
  expect(r.childEntityInsert.attributes["Split From Entity ID"]).toEqual(
    "parent-1"
  );
  // Parent attributes are untouched — the update only decrements quantity.
  expect(r.parentUpdate).toEqual({ quantity: 7 });
});

it("child clones parent attributes minus stale pointer keys", () => {
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
  expect(r.childEntityInsert.attributes.Receipt).toEqual("receipt-1");
  expect(r.childEntityInsert.attributes["Split Entity ID"]).toEqual(undefined);
  expect(r.childEntityInsert.attributes["Split From Entity ID"]).toEqual(
    "parent-1"
  );
});

it("extra child attributes are applied on top of inherited ones", () => {
  const r = buildBatchSplitRecords(
    splitInput({
      extraChildAttributes: { "Job Operation Step": "step-1", Shipment: "sh-1" }
    })
  );
  expect(r.childEntityInsert.attributes["Job Operation Step"]).toEqual(
    "step-1"
  );
  expect(r.childEntityInsert.attributes.Shipment).toEqual("sh-1");
  expect(r.childEntityInsert.attributes.Receipt).toEqual("receipt-1");
});

it("child inherits identity fields and takes the drawn quantity", () => {
  const r = buildBatchSplitRecords(splitInput({ drawQuantity: 2.5 }));
  expect(r.childEntityInsert.id).toEqual("child-1");
  expect(r.childEntityInsert.readableId).toEqual("2026/09");
  expect(r.childEntityInsert.quantity).toEqual(2.5);
  expect(r.childEntityInsert.status).toEqual("Available");
  expect(r.childEntityInsert.itemId).toEqual("item-1");
  expect(r.childEntityInsert.expirationDate).toEqual("2026-12-31");
  expect(r.parentUpdate.quantity).toEqual(5.5);
});

it("exactly one activity output and it is the child", () => {
  const r = buildBatchSplitRecords(splitInput());
  expect(r.activityInputInsert.trackedEntityId).toEqual("parent-1");
  expect(r.activityInputInsert.quantity).toEqual(1);
  expect(r.activityOutputInsert.trackedEntityId).toEqual("child-1");
  expect(r.activityOutputInsert.quantity).toEqual(1);
  expect(r.activityInsert.type).toEqual("Split");
  expect(r.activityInsert.attributes).toEqual({
    "Original Quantity": 8,
    "Drawn Quantity": 1,
    "Remaining Quantity": 7,
    "Split Entity ID": "child-1"
  });
});

it("ledger rows net to zero: −q on parent, +q on child, at the parent's bin", () => {
  const r = buildBatchSplitRecords(splitInput());
  const [minus, plus] = r.ledgerInserts;
  expect(minus.quantity).toEqual(-1);
  expect(minus.trackedEntityId).toEqual("parent-1");
  expect(minus.entryType).toEqual("Negative Adjmt.");
  expect(plus.quantity).toEqual(1);
  expect(plus.trackedEntityId).toEqual("child-1");
  expect(plus.entryType).toEqual("Positive Adjmt.");
  expect(minus.quantity + plus.quantity).toEqual(0);
  for (const row of r.ledgerInserts) {
    expect(row.documentType).toEqual("Batch Split");
    expect(row.documentId).toEqual("split-1");
    expect(row.storageUnitId).toEqual("shelf-a");
    expect(row.locationId).toEqual("loc-1");
    expect(row.itemId).toEqual("item-1");
    expect(row.postingDate).toEqual("2026-08-04");
  }
});

it("throws on drawQuantity <= 0", () => {
  expect(() =>
    buildBatchSplitRecords(splitInput({ drawQuantity: 0 }))
  ).toThrow();
  expect(() =>
    buildBatchSplitRecords(splitInput({ drawQuantity: -1 }))
  ).toThrow();
});

it("throws on drawQuantity >= parent quantity (full draw is not a split)", () => {
  expect(() =>
    buildBatchSplitRecords(splitInput({ drawQuantity: 8 }))
  ).toThrow();
  expect(() =>
    buildBatchSplitRecords(splitInput({ drawQuantity: 9 }))
  ).toThrow();
});

it("merge: quantities move child → parent, edges are input child / output parent", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.5 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  expect(r.activityInsert.type).toEqual("Merge");
  expect(r.activityInputInsert.trackedEntityId).toEqual("child-1");
  expect(r.activityOutputInsert.trackedEntityId).toEqual("parent-1");
  expect(r.activityInputInsert.quantity).toEqual(0.5);
  expect(r.activityOutputInsert.quantity).toEqual(0.5);
  expect(r.parentUpdate).toEqual({ quantity: 7.5 });
});

it("merge: child is Consumed when drained to zero", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.5 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  expect(r.childUpdate).toEqual({ quantity: 0, status: "Consumed" });
});

it("merge: partial merge leaves the child Available with the remainder", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 2 },
    parent: { id: "parent-1", quantity: 7 },
    mergeQuantity: 0.5,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  expect(r.childUpdate).toEqual({ quantity: 1.5 });
});

it("merge: throws when mergeQuantity exceeds child quantity or is <= 0", () => {
  const base = {
    child: { id: "child-1", quantity: 1 },
    parent: { id: "parent-1", quantity: 7 },
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  };
  expect(() => buildMergeRecords({ ...base, mergeQuantity: 2 })).toThrow();
  expect(() => buildMergeRecords({ ...base, mergeQuantity: 0 })).toThrow();
});

// --- persist-boundary rounding (PR C) --------------------------------------

it("split: a float-residue draw persists clean 5dp quantities", () => {
  // Drawing 0.98 from 1 leaves 0.020000000000000018 in raw float; the parent,
  // child, ledger, edges and Split blob must all read the rounded values.
  const r = buildBatchSplitRecords(
    splitInput({ parent: { id: "parent-1", quantity: 1 }, drawQuantity: 0.98 })
  );
  expect(r.parentUpdate).toEqual({ quantity: 0.02 });
  expect(r.childEntityInsert.quantity).toEqual(0.98);
  expect(r.activityInsert.attributes).toEqual({
    "Original Quantity": 1,
    "Drawn Quantity": 0.98,
    "Remaining Quantity": 0.02,
    "Split Entity ID": "child-1"
  });
  expect(r.activityInputInsert.quantity).toEqual(0.98);
  expect(r.activityOutputInsert.quantity).toEqual(0.98);
  const [minus, plus] = r.ledgerInserts;
  expect(minus.quantity).toEqual(-0.98);
  expect(plus.quantity).toEqual(0.98);
  expect(minus.quantity + plus.quantity).toEqual(0);
});

it("merge: a 0.30000000000000004 child settles the parent to a clean quantity", () => {
  const r = buildMergeRecords({
    child: { id: "child-1", quantity: 0.1 + 0.2 },
    parent: { id: "parent-1", quantity: 0.1 },
    mergeQuantity: 0.1 + 0.2,
    mergeActivityId: "merge-1",
    companyId: "co-1",
    userId: "user-1"
  });
  expect(r.activityInputInsert.quantity).toEqual(0.3);
  expect(r.activityOutputInsert.quantity).toEqual(0.3);
  expect(r.parentUpdate).toEqual({ quantity: 0.4 });
  // Draining the whole (rounded) child flips it Consumed via an exact === 0.
  expect(r.childUpdate).toEqual({ quantity: 0, status: "Consumed" });
});

it("isFullDraw: an exact whole draw is full", () => {
  expect(isFullDraw(10, 10)).toEqual(true);
  expect(isFullDraw(0.02, 0.02)).toEqual(true);
});

it("isFullDraw: a residue draw is full, and would otherwise throw", () => {
  // The lot left after drawing 0.98 from 1 holds 0.020000000000000018. Drawing
  // 0.02 of it is the whole lot — a raw !== reads it as partial, and the
  // builder then refuses `draw >= parentQty` on a legitimate full pick.
  const residue = 1 - 0.98;
  expect(residue === 0.02).toEqual(false);
  expect(isFullDraw(residue, 0.02)).toEqual(true);
  expect(() =>
    buildBatchSplitRecords(
      splitInput({
        parent: { ...splitInput().parent, quantity: residue },
        drawQuantity: 0.02
      })
    )
  ).toThrow("a full draw is not a split");
});

it("isFullDraw: one minor unit of real stock is still a partial draw", () => {
  // 1e-5 is a storable difference at internal scale, not float noise.
  expect(isFullDraw(1, 0.99999)).toEqual(false);
  expect(isFullDraw(10, 9.99999)).toEqual(false);
});

it("isFullDraw: an over-draw is not reported as full", () => {
  expect(isFullDraw(1, 1.5)).toEqual(false);
});
