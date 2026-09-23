// Pure record builders for the batch split/merge convention. Consumed from Deno
// edge functions AND node-side app code (ERP quality-disposition), so it must
// not touch lib/database.ts or any Deno API — its only dependency is the
// sibling precision module (itself dependency-free, re-exported through
// @carbon/utils for the node side), so quantities round at THIS persist
// boundary and every caller inherits it.
//
// Convention (spec .ai/specs/2026-08-04-batch-split-identity-flip.md): on a
// partial draw of quantity q from a parent batch, the PARENT KEEPS its id and
// is decremented; a NEW child entity departs with q, tagged
// "Split From Entity ID": parent.id. The Split activity records input
// parent@q → output child@q (never a survivor self-loop), and the ledger gets
// exactly two net-zero Batch Split rows (−q parent, +q child) at the parent's
// resolved bin. Returns MERGE quantity back into the parent (Merge activity).

import { equals, round } from "./precision.ts";

/**
 * The ONE split gate: is this draw the entity's whole quantity?
 *
 * Every caller decides "split or take the whole entity" with this, so the gate
 * and `buildBatchSplitRecords`' own `draw < parentQty` guard can never
 * disagree. A raw `===`/`<` on two float quantities can: a residue draw (an
 * entity left holding 0.020000000000000018 after an earlier split, drawn for
 * 0.02) reads as a PARTIAL draw, and the builder then throws `draw >= parentQty`
 * on what the operator sees as a legitimate full pick — or mints a phantom
 * child holding 1.8e-17. Both sides round to internal scale first, so two 5dp
 * quantities that differ by real stock (one minor unit, 1e-5) still split.
 */
export function isFullDraw(entityQuantity: number, drawQuantity: number): boolean {
  return equals(round(entityQuantity), round(drawQuantity));
}

export type BatchSplitInput = {
  parent: {
    id: string;
    readableId: string | null;
    quantity: number;
    sourceDocument: string | null;
    sourceDocumentId: string | null;
    sourceDocumentReadableId: string | null;
    itemId: string | null;
    expirationDate: string | null;
    attributes: Record<string, unknown> | null;
  };
  /** q — must be > 0 and < parent.quantity (full draws never split) */
  drawQuantity: number;
  /** caller-supplied nanoid for the departing child entity */
  childId: string;
  /** caller-supplied nanoid for the Split activity */
  splitActivityId: string;
  /** e.g. "Picking List" */
  activitySourceDocument: string;
  activitySourceDocumentId: string;
  /** the parent's resolved bin — both ledger rows book here */
  bin: { storageUnitId: string | null; locationId: string | null };
  /** itemId for the ledger rows */
  itemLedgerItemId: string | null;
  companyId: string;
  userId: string;
  /** yyyy-MM-dd */
  postingDate: string;
  childStatus: "Available" | "Consumed" | "Scrapped";
  extraChildAttributes?: Record<string, unknown>;
};

type LedgerRecord = {
  postingDate: string;
  itemId: string | null;
  quantity: number;
  locationId: string | null;
  storageUnitId: string | null;
  entryType: "Negative Adjmt." | "Positive Adjmt.";
  documentType: "Batch Split";
  documentId: string;
  trackedEntityId: string;
  createdBy: string;
  companyId: string;
};

type ActivityEdgeRecord = {
  trackedActivityId: string;
  trackedEntityId: string;
  quantity: number;
  companyId: string;
  createdBy: string;
};

export function buildBatchSplitRecords(input: BatchSplitInput): {
  childEntityInsert: {
    id: string;
    readableId: string | null;
    sourceDocument: string | null;
    sourceDocumentId: string | null;
    sourceDocumentReadableId: string | null;
    quantity: number;
    status: "Available" | "Consumed" | "Scrapped";
    attributes: Record<string, unknown>;
    itemId: string | null;
    expirationDate: string | null;
    companyId: string;
    createdBy: string;
  };
  parentUpdate: { quantity: number };
  activityInsert: {
    id: string;
    type: "Split";
    sourceDocument: string;
    sourceDocumentId: string;
    attributes: Record<string, unknown>;
    companyId: string;
    createdBy: string;
  };
  activityInputInsert: ActivityEdgeRecord;
  activityOutputInsert: ActivityEdgeRecord;
  ledgerInserts: [LedgerRecord, LedgerRecord];
} {
  const {
    parent,
    drawQuantity,
    childId,
    splitActivityId,
    activitySourceDocument,
    activitySourceDocumentId,
    bin,
    itemLedgerItemId,
    companyId,
    userId,
    postingDate,
    childStatus,
    extraChildAttributes
  } = input;

  // Round at the persist boundary so a float-residue draw (0.98 from 1.0 leaves
  // 0.020000000000000018, not 0.02) never reaches storage. The child departs
  // with `draw`, the parent keeps `remaining`, and both ledger rows book `draw`
  // — all derived from the same rounded values so the two stay net-zero.
  const draw = round(drawQuantity);
  const parentQty = round(parent.quantity);
  const remaining = round(parentQty - draw);

  // The callers' split gates (full draws take the no-split fast path, compared
  // with equals() at scale) should make these unreachable — loud beats silent.
  if (draw <= 0) {
    throw new Error(
      `buildBatchSplitRecords: drawQuantity must be > 0, got ${drawQuantity}`
    );
  }
  if (draw >= parentQty) {
    throw new Error(
      `buildBatchSplitRecords: drawQuantity (${drawQuantity}) must be < parent quantity (${parent.quantity}) — a full draw is not a split`
    );
  }

  // Clone the parent's attributes minus any stale pointer keys; the child
  // carries the one true back-pointer to its parent.
  const {
    "Split Entity ID": _staleForwardPointer,
    "Split From Entity ID": _staleBackPointer,
    ...inheritedAttributes
  } = (parent.attributes ?? {}) as Record<string, unknown>;

  return {
    childEntityInsert: {
      id: childId,
      readableId: parent.readableId,
      sourceDocument: parent.sourceDocument,
      sourceDocumentId: parent.sourceDocumentId,
      sourceDocumentReadableId: parent.sourceDocumentReadableId,
      quantity: draw,
      status: childStatus,
      attributes: {
        ...inheritedAttributes,
        "Split From Entity ID": parent.id,
        ...extraChildAttributes
      },
      itemId: parent.itemId,
      expirationDate: parent.expirationDate,
      companyId,
      createdBy: userId
    },
    parentUpdate: { quantity: remaining },
    activityInsert: {
      id: splitActivityId,
      type: "Split",
      sourceDocument: activitySourceDocument,
      sourceDocumentId: activitySourceDocumentId,
      attributes: {
        "Original Quantity": parentQty,
        "Drawn Quantity": draw,
        "Remaining Quantity": remaining,
        "Split Entity ID": childId
      },
      companyId,
      createdBy: userId
    },
    activityInputInsert: {
      trackedActivityId: splitActivityId,
      trackedEntityId: parent.id,
      quantity: draw,
      companyId,
      createdBy: userId
    },
    activityOutputInsert: {
      trackedActivityId: splitActivityId,
      trackedEntityId: childId,
      quantity: draw,
      companyId,
      createdBy: userId
    },
    ledgerInserts: [
      {
        postingDate,
        itemId: itemLedgerItemId,
        quantity: -draw,
        locationId: bin.locationId,
        storageUnitId: bin.storageUnitId,
        entryType: "Negative Adjmt.",
        documentType: "Batch Split",
        documentId: splitActivityId,
        trackedEntityId: parent.id,
        createdBy: userId,
        companyId
      },
      {
        postingDate,
        itemId: itemLedgerItemId,
        quantity: draw,
        locationId: bin.locationId,
        storageUnitId: bin.storageUnitId,
        entryType: "Positive Adjmt.",
        documentType: "Batch Split",
        documentId: splitActivityId,
        trackedEntityId: childId,
        createdBy: userId,
        companyId
      }
    ]
  };
}

export function buildMergeRecords(input: {
  child: { id: string; quantity: number };
  parent: { id: string; quantity: number };
  mergeQuantity: number;
  mergeActivityId: string;
  companyId: string;
  userId: string;
}): {
  activityInsert: {
    id: string;
    type: "Merge";
    attributes: Record<string, unknown>;
    companyId: string;
    createdBy: string;
  };
  activityInputInsert: ActivityEdgeRecord;
  activityOutputInsert: ActivityEdgeRecord;
  parentUpdate: { quantity: number };
  childUpdate: { quantity: number; status?: "Consumed" };
} {
  const { child, parent, mergeQuantity, mergeActivityId, companyId, userId } =
    input;

  // Round at the persist boundary: a merge of a 0.30000000000000004 float
  // child settles the parent back to a clean quantity and lets the drain-to-
  // zero short-circuit compare exactly.
  const merge = round(mergeQuantity);
  const childQty = round(child.quantity);

  if (merge <= 0) {
    throw new Error(
      `buildMergeRecords: mergeQuantity must be > 0, got ${mergeQuantity}`
    );
  }
  if (merge > childQty) {
    throw new Error(
      `buildMergeRecords: mergeQuantity (${mergeQuantity}) exceeds child quantity (${child.quantity})`
    );
  }

  const childRemaining = round(childQty - merge);

  return {
    activityInsert: {
      id: mergeActivityId,
      type: "Merge",
      attributes: {
        "Merged Quantity": merge,
        "Merged From Entity ID": child.id
      },
      companyId,
      createdBy: userId
    },
    activityInputInsert: {
      trackedActivityId: mergeActivityId,
      trackedEntityId: child.id,
      quantity: merge,
      companyId,
      createdBy: userId
    },
    activityOutputInsert: {
      trackedActivityId: mergeActivityId,
      trackedEntityId: parent.id,
      quantity: merge,
      companyId,
      createdBy: userId
    },
    parentUpdate: { quantity: round(round(parent.quantity) + merge) },
    // childRemaining is already rounded, so `=== 0` is exact here — but go
    // through the shared drain rule so a merge that empties a lot settles the
    // same way every other quantity writer does.
    childUpdate:
      childRemaining <= 0
        ? { quantity: 0, status: "Consumed" as const }
        : { quantity: childRemaining }
  };
}
