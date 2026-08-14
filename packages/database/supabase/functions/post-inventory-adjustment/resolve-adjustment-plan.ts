// Pure stock-target resolver for manual inventory adjustments.
//
// Why this exists: the caller used to resolve the target inline against a
// single `currentQuantity` row, looked up by `trackedEntityId` when the payload
// carried one. The ERP modal always sent a client-minted nanoid for a NEW
// adjustment, so that lookup never matched, `currentQuantity` came back
// undefined, and every branch keyed off it fell through to the "brand new
// entity" path — a `Set Quantity` posted its full target as a Positive Adjmt.
// (setting 1 against 103 on hand booked +1, not -102), a `Negative Adjmt.`
// carrying a batch number that did not exist yet threw "Serial number not
// found" on a Batch-tracked item, and stock sitting in the untracked legacy
// bucket (quantity with no trackedEntityId, the residue of switching an item's
// tracking type after it already had stock) was unreachable from the modal.
//
// The resolver takes the bin snapshot and returns the exact movements to book.
// It has no imports so `deno test` type-checks it clean.

export type TrackingQuantityRow = {
  trackedEntityId: string | null;
  storageUnitId: string | null;
  quantity: number | null;
  readableId: string | null;
};

export type AdjustmentEntryType = "Positive Adjmt." | "Negative Adjmt.";

// One posting. `untracked` moves the legacy no-entity bucket; `entity` moves a
// tracked entity and carries the before-quantity so the caller can write the
// resulting `trackedEntity.quantity` without re-reading.
export type AdjustmentMovement =
  | {
      kind: "untracked";
      entryType: AdjustmentEntryType;
      quantity: number;
    }
  | {
      kind: "entity";
      entryType: AdjustmentEntryType;
      quantity: number;
      trackedEntityId: string;
      readableId: string | null;
      isNew: boolean;
      entityQuantityBefore: number;
    };

export type AdjustmentPlan =
  | { ok: true; movements: AdjustmentMovement[] }
  | { ok: false; error: string };

export type ResolveAdjustmentPlanInput = {
  adjustmentType: "Positive Adjmt." | "Negative Adjmt." | "Set Quantity";
  // Positive magnitude. Direction comes from adjustmentType, never the sign.
  quantity: number;
  storageUnitId: string | null;
  // Whatever the payload carried. An id that matches no row is treated as a
  // request to CREATE that entity, not as a selection of an existing one.
  trackedEntityId: string | null;
  readableId: string | null;
  itemTrackingType: string | null;
  trackingRows: TrackingQuantityRow[];
  // Id factory for entities the plan creates (nanoid at the call site).
  newEntityId: () => string;
};

const qty = (row: { quantity: number | null }) => Number(row.quantity) || 0;

// "Serial number not found" is only true for a Serial item; a Batch item must
// name batches. Anything else tracks no readable id at all.
function notFoundMessage(itemTrackingType: string | null): string {
  if (itemTrackingType === "Serial") return "Serial number not found";
  if (itemTrackingType === "Batch") return "Batch number not found";
  return "Tracked entity not found";
}

const INSUFFICIENT = "Insufficient quantity for negative adjustment";
const AMBIGUOUS =
  "Multiple tracked entities in this storage unit — select a specific row to adjust";

// Reconciling a bin total: draw `amount` out untracked-bucket first, then
// tracked rows in snapshot order. Multi-source on purpose — a bin holding 101
// untracked + 2 batch-tracked cannot be set to 1 without crossing both
// buckets, which is exactly the adjustment the old resolver refused. Only
// `Set Quantity` gets this: the user has stated the resulting total, so
// spending across batches to reach it is the instruction, not a guess.
function drawDownAcrossBin(
  amount: number,
  untrackedOnHand: number,
  trackedRows: TrackingQuantityRow[]
): AdjustmentPlan {
  const movements: AdjustmentMovement[] = [];
  let remaining = amount;

  if (untrackedOnHand > 0) {
    const take = Math.min(remaining, untrackedOnHand);
    movements.push({
      kind: "untracked",
      entryType: "Negative Adjmt.",
      quantity: take,
    });
    remaining -= take;
  }

  for (const row of trackedRows) {
    if (remaining <= 0) break;
    const available = qty(row);
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    movements.push({
      kind: "entity",
      entryType: "Negative Adjmt.",
      quantity: take,
      trackedEntityId: row.trackedEntityId as string,
      readableId: row.readableId,
      isNew: false,
      entityQuantityBefore: available,
    });
    remaining -= take;
  }

  if (remaining > 0) return { ok: false, error: INSUFFICIENT };
  return { ok: true, movements };
}

// An untargeted `Negative Adjmt.` — the user named no batch and picked no row,
// so it must come out of exactly one bucket. Consuming an arbitrary batch here
// would silently destroy traceability, so ambiguity is refused rather than
// guessed. Unchanged from the pre-existing resolver.
function drawDownSingleSource(
  amount: number,
  untrackedOnHand: number,
  trackedRows: TrackingQuantityRow[]
): AdjustmentPlan {
  if (untrackedOnHand > 0) {
    if (amount > untrackedOnHand) return { ok: false, error: INSUFFICIENT };
    return {
      ok: true,
      movements: [
        { kind: "untracked", entryType: "Negative Adjmt.", quantity: amount },
      ],
    };
  }

  const withStock = trackedRows.filter((r) => qty(r) > 0);
  if (withStock.length === 0) return { ok: false, error: INSUFFICIENT };
  if (withStock.length > 1) return { ok: false, error: AMBIGUOUS };

  const row = withStock[0];
  const available = qty(row);
  if (amount > available) return { ok: false, error: INSUFFICIENT };
  return {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Negative Adjmt.",
        quantity: amount,
        trackedEntityId: row.trackedEntityId as string,
        readableId: row.readableId,
        isNew: false,
        entityQuantityBefore: available,
      },
    ],
  };
}

export function resolveAdjustmentPlan(
  input: ResolveAdjustmentPlanInput
): AdjustmentPlan {
  const {
    adjustmentType,
    quantity,
    storageUnitId,
    trackedEntityId,
    readableId,
    itemTrackingType,
    trackingRows,
    newEntityId,
  } = input;

  // null == undefined is deliberate throughout — storageUnitId arrives as null
  // from the payload and undefined from some snapshot rows (ported behavior).
  const binRows = trackingRows.filter((r) => r.storageUnitId == storageUnitId);
  const untrackedRow = binRows.find((r) => r.trackedEntityId == null);
  const untrackedOnHand = untrackedRow ? qty(untrackedRow) : 0;
  const trackedBinRows = binRows.filter((r) => r.trackedEntityId != null);
  const binOnHand = binRows.reduce((sum, r) => sum + qty(r), 0);

  // Row-scoped when the payload's entity actually exists in the snapshot: the
  // user picked a row's "Adjust" action. An unmatched id means "create this".
  const selectedRow = trackedEntityId
    ? trackingRows.find((r) => r.trackedEntityId == trackedEntityId)
    : undefined;

  // A readable id the user typed that already names stock in this bin.
  const namedRow = readableId
    ? trackedBinRows.find((r) => r.readableId === readableId && qty(r) > 0)
    : undefined;

  if (adjustmentType === "Set Quantity") {
    if (selectedRow) {
      // Unchanged behavior: setting a specific tracked row's own quantity.
      const before = qty(selectedRow);
      const delta = quantity - before;
      if (delta === 0) return { ok: true, movements: [] };
      return {
        ok: true,
        movements: [
          {
            kind: "entity",
            entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
            quantity: Math.abs(delta),
            trackedEntityId: selectedRow.trackedEntityId as string,
            readableId: selectedRow.readableId,
            isNew: false,
            entityQuantityBefore: before,
          },
        ],
      };
    }

    // Bin-level "Set Quantity" — the modal's Update Inventory entry point.
    // The target is the bin TOTAL across tracked and untracked stock, which is
    // the number the user is reading off the page.
    const delta = quantity - binOnHand;
    if (delta === 0) return { ok: true, movements: [] };
    if (delta < 0) {
      return drawDownAcrossBin(-delta, untrackedOnHand, trackedBinRows);
    }

    return {
      ok: true,
      movements: [buildPositive(delta, namedRow, readableId, newEntityId)],
    };
  }

  if (adjustmentType === "Positive Adjmt.") {
    if (selectedRow) {
      return {
        ok: true,
        movements: [
          {
            kind: "entity",
            entryType: "Positive Adjmt.",
            quantity,
            trackedEntityId: selectedRow.trackedEntityId as string,
            readableId: selectedRow.readableId,
            isNew: false,
            entityQuantityBefore: qty(selectedRow),
          },
        ],
      };
    }
    return {
      ok: true,
      movements: [buildPositive(quantity, namedRow, readableId, newEntityId)],
    };
  }

  // Negative Adjmt.
  if (selectedRow) {
    const before = qty(selectedRow);
    if (quantity > before) return { ok: false, error: INSUFFICIENT };
    return {
      ok: true,
      movements: [
        {
          kind: "entity",
          entryType: "Negative Adjmt.",
          quantity,
          trackedEntityId: selectedRow.trackedEntityId as string,
          readableId: selectedRow.readableId,
          isNew: false,
          entityQuantityBefore: before,
        },
      ],
    };
  }

  if (readableId) {
    // Named stock wins. When the name matches nothing, fall back to the bin's
    // untracked bucket instead of hard-failing: on an item whose tracking type
    // was switched on after it had stock, the quantity the user is trying to
    // remove genuinely has no batch number, and refusing the adjustment leaves
    // that stock permanently unadjustable.
    if (namedRow) {
      const before = qty(namedRow);
      if (quantity > before) return { ok: false, error: INSUFFICIENT };
      return {
        ok: true,
        movements: [
          {
            kind: "entity",
            entryType: "Negative Adjmt.",
            quantity,
            trackedEntityId: namedRow.trackedEntityId as string,
            readableId: namedRow.readableId,
            isNew: false,
            entityQuantityBefore: before,
          },
        ],
      };
    }
    if (untrackedOnHand <= 0) {
      return { ok: false, error: notFoundMessage(itemTrackingType) };
    }
    if (quantity > untrackedOnHand) return { ok: false, error: INSUFFICIENT };
    return {
      ok: true,
      movements: [
        { kind: "untracked", entryType: "Negative Adjmt.", quantity },
      ],
    };
  }

  return drawDownSingleSource(quantity, untrackedOnHand, trackedBinRows);
}

// A positive movement lands on the entity the user named, or creates it. With
// no readable id the quantity joins the untracked bucket rather than minting a
// nameless tracked entity — nameless entities are exactly the rows that show a
// blank Tracking ID and cannot be reconciled afterwards.
function buildPositive(
  quantity: number,
  namedRow: TrackingQuantityRow | undefined,
  readableId: string | null,
  newEntityId: () => string
): AdjustmentMovement {
  if (namedRow) {
    return {
      kind: "entity",
      entryType: "Positive Adjmt.",
      quantity,
      trackedEntityId: namedRow.trackedEntityId as string,
      readableId: namedRow.readableId,
      isNew: false,
      entityQuantityBefore: qty(namedRow),
    };
  }
  if (readableId) {
    return {
      kind: "entity",
      entryType: "Positive Adjmt.",
      quantity,
      trackedEntityId: newEntityId(),
      readableId,
      isNew: true,
      entityQuantityBefore: 0,
    };
  }
  return { kind: "untracked", entryType: "Positive Adjmt.", quantity };
}
