// Pure record builders for merging N same-item tracked entities into ONE new
// entity — the deliberate lot merge behind batch-completion outputs ("2 lots of
// the same item — merge into one?"). The inverse shape of buildBatchSplitRecords
// in ./batch-split.ts: parents become Consumed, a fresh entity carries the
// summed quantity, one Merge activity records inputs = each parent at its
// quantity and output = the merged entity, and the ledger gets net-zero Batch
// Merge rows (−q at each parent's bin, +Σq at the merged entity's bin).
//
// No imports — consumed from Deno edge functions AND node-side app code, so it
// must not touch lib/database.ts or any Deno API.
// See .ai/specs/2026-09-16-batch-materials-and-output-lots.md.

export type BatchMergeParent = {
  id: string;
  readableId: string | null;
  quantity: number;
  /** the parent's on-ledger balance (Σ itemLedger.quantity). A lot straight
   *  off a completed batch has 0 until its job is received — the merge is an
   *  identity operation and must only move stock that actually exists. */
  receivedQuantity: number;
  status: string;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  sourceDocumentReadableId: string | null;
  itemId: string | null;
  expirationDate: string | null;
  attributes: Record<string, unknown> | null;
  /** the parent's resolved bin — its −q ledger row books here */
  bin: { storageUnitId: string | null; locationId: string | null };
};

type MergeLedgerRecord = {
  postingDate: string;
  itemId: string | null;
  quantity: number;
  locationId: string | null;
  storageUnitId: string | null;
  entryType: "Negative Adjmt." | "Positive Adjmt.";
  documentType: "Batch Merge";
  documentId: string;
  trackedEntityId: string;
  createdBy: string;
  companyId: string;
};

type MergeActivityEdgeRecord = {
  trackedActivityId: string;
  trackedEntityId: string;
  quantity: number;
  companyId: string;
  createdBy: string;
};

// Pointer keys from the split convention never carry onto a merged entity —
// its provenance is the Merge activity plus "Merged From Entity IDs".
const POINTER_KEYS = ["Split Entity ID", "Split From Entity ID"];

export function buildBatchMergeRecords(input: {
  parents: BatchMergeParent[];
  /** caller-supplied nanoid for the merged entity */
  mergedId: string;
  /** caller-supplied nanoid for the Merge activity */
  mergeActivityId: string;
  /** the merged lot's batch number. Omitted/null inherits the FIRST parent's,
   *  matching buildBatchSplitRecords (a split child keeps parent.readableId).
   *  An Available lot with no number is unidentifiable on the floor. */
  readableId?: string | null;
  activitySourceDocument?: string;
  activitySourceDocumentId?: string;
  companyId: string;
  userId: string;
  /** yyyy-MM-dd */
  postingDate: string;
}): {
  mergedEntityInsert: {
    id: string;
    readableId: string | null;
    sourceDocument: string | null;
    sourceDocumentId: string | null;
    sourceDocumentReadableId: string | null;
    quantity: number;
    status: "Available";
    attributes: Record<string, unknown>;
    itemId: string | null;
    expirationDate: string | null;
    companyId: string;
    createdBy: string;
  };
  /** parents keep their quantity (historical record, like any consumption) and flip Consumed */
  parentUpdates: { id: string; status: "Consumed" }[];
  activityInsert: {
    id: string;
    type: "Merge";
    sourceDocument?: string;
    sourceDocumentId?: string;
    attributes: Record<string, unknown>;
    companyId: string;
    createdBy: string;
  };
  activityInputInserts: MergeActivityEdgeRecord[];
  activityOutputInsert: MergeActivityEdgeRecord;
  ledgerInserts: MergeLedgerRecord[];
} {
  const {
    parents,
    mergedId,
    mergeActivityId,
    readableId,
    activitySourceDocument,
    activitySourceDocumentId,
    companyId,
    userId,
    postingDate
  } = input;

  if (parents.length < 2) {
    throw new Error("At least two lots are required to merge");
  }
  for (const parent of parents) {
    if (parent.status !== "Available") {
      throw new Error(
        `Lot ${parent.readableId ?? parent.id} is not available to merge`
      );
    }
    if (!(parent.quantity > 0)) {
      throw new Error(
        `Lot ${parent.readableId ?? parent.id} has no quantity to merge`
      );
    }
    if (parent.receivedQuantity < 0) {
      throw new Error(
        `Lot ${parent.readableId ?? parent.id} has a negative ledger balance`
      );
    }
  }
  const itemOf = (p: BatchMergeParent) => p.itemId ?? p.sourceDocumentId;
  const firstItem = itemOf(parents[0]!);
  if (!firstItem || parents.some((p) => itemOf(p) !== firstItem)) {
    throw new Error("Only lots of the same item can be merged");
  }

  const totalQuantity = parents.reduce((sum, p) => sum + p.quantity, 0);
  const receivedTotal = parents.reduce(
    (acc, p) => acc + p.receivedQuantity,
    0
  );

  // Earliest parent expiry wins — the conservative policy for a blended lot.
  let expirationDate: string | null = null;
  for (const p of parents) {
    if (p.expirationDate && (!expirationDate || p.expirationDate < expirationDate)) {
      expirationDate = p.expirationDate;
    }
  }

  // Keep only the attributes every parent agrees on; anything contested is
  // dropped rather than guessed.
  const first = parents[0]!;
  const agreed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    (first.attributes ?? {}) as Record<string, unknown>
  )) {
    if (POINTER_KEYS.includes(key)) continue;
    const everyoneAgrees = parents.every(
      (p) =>
        JSON.stringify(
          ((p.attributes ?? {}) as Record<string, unknown>)[key]
        ) === JSON.stringify(value)
    );
    if (everyoneAgrees) agreed[key] = value;
  }

  return {
    mergedEntityInsert: {
      id: mergedId,
      readableId: readableId ?? first.readableId,
      sourceDocument: first.sourceDocument,
      sourceDocumentId: first.sourceDocumentId,
      sourceDocumentReadableId: first.sourceDocumentReadableId,
      quantity: totalQuantity,
      status: "Available",
      attributes: {
        ...agreed,
        "Merged From Entity IDs": parents.map((p) => p.id)
      },
      itemId: first.itemId,
      expirationDate,
      companyId,
      createdBy: userId
    },
    parentUpdates: parents.map((p) => ({ id: p.id, status: "Consumed" })),
    activityInsert: {
      id: mergeActivityId,
      type: "Merge",
      ...(activitySourceDocument
        ? { sourceDocument: activitySourceDocument }
        : {}),
      ...(activitySourceDocumentId
        ? { sourceDocumentId: activitySourceDocumentId }
        : {}),
      attributes: {
        "Merged Quantity": totalQuantity,
        "Merged From Entity IDs": parents.map((p) => p.id),
        "Merged Entity ID": mergedId
      },
      companyId,
      createdBy: userId
    },
    activityInputInserts: parents.map((p) => ({
      trackedActivityId: mergeActivityId,
      trackedEntityId: p.id,
      quantity: p.quantity,
      companyId,
      createdBy: userId
    })),
    activityOutputInsert: {
      trackedActivityId: mergeActivityId,
      trackedEntityId: mergedId,
      quantity: totalQuantity,
      companyId,
      createdBy: userId
    },
    // Ledger rows move only stock the parents actually had: each job's
    // receipt is still what brings its quantity into inventory (and lands on
    // the merged lot once the parent is consumed). A parent received in full
    // makes these net to zero, which is the old behaviour.
    ledgerInserts: [
      ...parents
        .filter((p) => p.receivedQuantity > 0)
        .map(
        (p): MergeLedgerRecord => ({
          postingDate,
          itemId: p.itemId ?? p.sourceDocumentId,
          quantity: -p.receivedQuantity,
          locationId: p.bin.locationId,
          storageUnitId: p.bin.storageUnitId,
          entryType: "Negative Adjmt.",
          documentType: "Batch Merge",
          documentId: mergeActivityId,
          trackedEntityId: p.id,
          createdBy: userId,
          companyId
        })
      ),
      ...(receivedTotal > 0
        ? [
      {
        postingDate,
        itemId: first.itemId ?? first.sourceDocumentId,
        quantity: receivedTotal,
        // The merged lot sits where the first parent sat; a later physical
        // move is an ordinary stock transfer.
        locationId: first.bin.locationId,
        storageUnitId: first.bin.storageUnitId,
        entryType: "Positive Adjmt.",
        documentType: "Batch Merge",
        documentId: mergeActivityId,
        trackedEntityId: mergedId,
        createdBy: userId,
        companyId
      } satisfies MergeLedgerRecord
          ]
        : [])
    ]
  };
}
