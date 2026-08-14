import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  resolveAdjustmentPlan,
  type ResolveAdjustmentPlanInput,
  type TrackingQuantityRow,
} from "./resolve-adjustment-plan.ts";

const BIN = "bin-hq";

// The snapshot from the bug report: a Batch-tracked billet holding 2 under
// batch 55772 and 101 in the untracked legacy bucket left behind when the
// item's tracking type was switched to Batch after it already had stock.
const REPORTED_ROWS: TrackingQuantityRow[] = [
  {
    trackedEntityId: "te_55772",
    storageUnitId: BIN,
    quantity: 2,
    readableId: "55772",
  },
  {
    trackedEntityId: null,
    storageUnitId: BIN,
    quantity: 101,
    readableId: null,
  },
];

function plan(overrides: Partial<ResolveAdjustmentPlanInput> = {}) {
  let n = 0;
  return resolveAdjustmentPlan({
    adjustmentType: "Set Quantity",
    quantity: 1,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: null,
    itemTrackingType: "Batch",
    trackingRows: REPORTED_ROWS,
    newEntityId: () => `new_${++n}`,
    ...overrides,
  });
}

Deno.test("bin-level Set Quantity reduces to the target instead of adding", () => {
  // The reported failure: setting 1 against 103 on hand booked +1 (103 -> 104).
  const result = plan({ quantity: 1 });
  assertEquals(result, {
    ok: true,
    movements: [
      { kind: "untracked", entryType: "Negative Adjmt.", quantity: 101 },
      {
        kind: "entity",
        entryType: "Negative Adjmt.",
        quantity: 1,
        trackedEntityId: "te_55772",
        readableId: "55772",
        isNew: false,
        entityQuantityBefore: 2,
      },
    ],
  });
});

Deno.test("a client-minted trackedEntityId that matches nothing does not force a positive", () => {
  // The ERP modal used to send a fresh nanoid for every new adjustment. That id
  // must not be read as "this is a new entity, add the full quantity".
  const result = plan({ quantity: 1, trackedEntityId: "nanoid_never_seen" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.movements.every((m) => m.entryType === "Negative Adjmt."),
    true
  );
  assertEquals(
    result.movements.reduce((sum, m) => sum + m.quantity, 0),
    102
  );
});

Deno.test("bin-level Set Quantity above on hand books the difference only", () => {
  const result = plan({ quantity: 110 });
  assertEquals(result, {
    ok: true,
    movements: [
      { kind: "untracked", entryType: "Positive Adjmt.", quantity: 7 },
    ],
  });
});

Deno.test("bin-level Set Quantity equal to on hand is a no-op", () => {
  assertEquals(plan({ quantity: 103 }), { ok: true, movements: [] });
});

Deno.test("Set Quantity to zero drains every bucket in the bin", () => {
  const result = plan({ quantity: 0 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.movements.reduce((sum, m) => sum + m.quantity, 0),
    103
  );
});

Deno.test("negative adjustment for an unknown batch says batch, not serial", () => {
  // The reported toast said "Serial number not found" on a Batch item. With no
  // untracked stock to fall back on, the message must name the right entity.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Negative Adjmt.",
    quantity: 2,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: "994435",
    itemTrackingType: "Batch",
    trackingRows: [REPORTED_ROWS[0]],
    newEntityId: () => "new",
  });
  assertEquals(result, { ok: false, error: "Batch number not found" });
});

Deno.test("negative adjustment for an unknown serial still says serial", () => {
  const result = resolveAdjustmentPlan({
    adjustmentType: "Negative Adjmt.",
    quantity: 1,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: "SN-1",
    itemTrackingType: "Serial",
    trackingRows: [],
    newEntityId: () => "new",
  });
  assertEquals(result, { ok: false, error: "Serial number not found" });
});

Deno.test("an unmatched batch number falls back to untracked stock in the bin", () => {
  // Stock that predates the tracking-type switch has no batch number; typing
  // one that does not exist must not strand it.
  const result = plan({
    adjustmentType: "Negative Adjmt.",
    quantity: 5,
    readableId: "994435",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      { kind: "untracked", entryType: "Negative Adjmt.", quantity: 5 },
    ],
  });
});

Deno.test("a known batch number targets that batch", () => {
  const result = plan({
    adjustmentType: "Negative Adjmt.",
    quantity: 2,
    readableId: "55772",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Negative Adjmt.",
        quantity: 2,
        trackedEntityId: "te_55772",
        readableId: "55772",
        isNew: false,
        entityQuantityBefore: 2,
      },
    ],
  });
});

Deno.test("negative adjustment beyond the untracked bucket is refused", () => {
  // An untargeted negative comes out of one bucket only — it must not quietly
  // spill into a batch the user never named.
  const result = plan({ adjustmentType: "Negative Adjmt.", quantity: 102 });
  assertEquals(result, {
    ok: false,
    error: "Insufficient quantity for negative adjustment",
  });
});

Deno.test("untargeted negative across several batches stays ambiguous", () => {
  // Traceability guard, unchanged: with no untracked stock and more than one
  // batch holding quantity, picking one arbitrarily would misreport which
  // batch was consumed.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Negative Adjmt.",
    quantity: 1,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: null,
    itemTrackingType: "Batch",
    trackingRows: [
      REPORTED_ROWS[0],
      {
        trackedEntityId: "te_66544",
        storageUnitId: BIN,
        quantity: 3,
        readableId: "6654483",
      },
    ],
    newEntityId: () => "new",
  });
  assertEquals(result, {
    ok: false,
    error:
      "Multiple tracked entities in this storage unit — select a specific row to adjust",
  });
});

Deno.test("Set Quantity may cross buckets that an untargeted negative may not", () => {
  // The user stated the resulting total, so spending across batches to reach
  // it is the instruction rather than a guess.
  const result = plan({ quantity: 1 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.movements.length, 2);
});

Deno.test("positive adjustment with a new batch number creates that batch", () => {
  const result = plan({
    adjustmentType: "Positive Adjmt.",
    quantity: 4,
    readableId: "260114-SS-02",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Positive Adjmt.",
        quantity: 4,
        trackedEntityId: "new_1",
        readableId: "260114-SS-02",
        isNew: true,
        entityQuantityBefore: 0,
      },
    ],
  });
});

Deno.test("positive adjustment without a batch number joins the untracked bucket", () => {
  // Never mint a nameless tracked entity — those are the blank Tracking ID
  // rows the report is about.
  const result = plan({ adjustmentType: "Positive Adjmt.", quantity: 3 });
  assertEquals(result, {
    ok: true,
    movements: [
      { kind: "untracked", entryType: "Positive Adjmt.", quantity: 3 },
    ],
  });
});

Deno.test("positive adjustment onto an existing batch number adds to it", () => {
  const result = plan({
    adjustmentType: "Positive Adjmt.",
    quantity: 3,
    readableId: "55772",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Positive Adjmt.",
        quantity: 3,
        trackedEntityId: "te_55772",
        readableId: "55772",
        isNew: false,
        entityQuantityBefore: 2,
      },
    ],
  });
});

Deno.test("row-scoped Set Quantity still targets only that row", () => {
  const result = plan({ quantity: 5, trackedEntityId: "te_55772" });
  assertEquals(result, {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Positive Adjmt.",
        quantity: 3,
        trackedEntityId: "te_55772",
        readableId: "55772",
        isNew: false,
        entityQuantityBefore: 2,
      },
    ],
  });
});

Deno.test("row-scoped negative adjustment beyond the row is refused", () => {
  const result = plan({
    adjustmentType: "Negative Adjmt.",
    quantity: 3,
    trackedEntityId: "te_55772",
  });
  assertEquals(result, {
    ok: false,
    error: "Insufficient quantity for negative adjustment",
  });
});

Deno.test("fractional drawdown is not defeated by floating-point residue", () => {
  // 0.9 - 0.3 - 0.6 leaves ~1.1e-16, which a strict remaining > 0 check would
  // report as a shortage on an adjustment that in fact balances exactly.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Set Quantity",
    quantity: 0,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: null,
    itemTrackingType: "Batch",
    trackingRows: [
      {
        trackedEntityId: null,
        storageUnitId: BIN,
        quantity: 0.3,
        readableId: null,
      },
      {
        trackedEntityId: "te_a",
        storageUnitId: BIN,
        quantity: 0.6,
        readableId: "A",
      },
    ],
    newEntityId: () => "new",
  });
  assertEquals(result.ok, true);
});

Deno.test("drawdown order does not depend on snapshot order", () => {
  const rows: TrackingQuantityRow[] = [
    { trackedEntityId: "te_c", storageUnitId: BIN, quantity: 1, readableId: "C" },
    { trackedEntityId: "te_a", storageUnitId: BIN, quantity: 1, readableId: "A" },
    { trackedEntityId: "te_b", storageUnitId: BIN, quantity: 1, readableId: "B" },
  ];
  const batchesConsumed = (
    trackingRows: TrackingQuantityRow[]
  ): (string | null)[] => {
    const result = resolveAdjustmentPlan({
      adjustmentType: "Set Quantity",
      quantity: 1,
      storageUnitId: BIN,
      trackedEntityId: null,
      readableId: null,
      itemTrackingType: "Batch",
      trackingRows,
      newEntityId: () => "new",
    });
    if (!result.ok) throw new Error("expected a resolvable plan");
    return result.movements.map((m) =>
      m.kind === "entity" ? m.readableId : "untracked"
    );
  };
  // Same bin, two different query orders, same lots consumed.
  assertEquals(batchesConsumed(rows), ["A", "B"]);
  assertEquals(batchesConsumed([...rows].reverse()), ["A", "B"]);
});

Deno.test("a batch drawn down to zero is reused, not duplicated", () => {
  // Minting a second entity with the same readableId would split that batch's
  // history and break reconciliation by batch number.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Positive Adjmt.",
    quantity: 5,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: "55772",
    itemTrackingType: "Batch",
    trackingRows: [
      {
        trackedEntityId: "te_55772",
        storageUnitId: BIN,
        quantity: 0,
        readableId: "55772",
      },
    ],
    newEntityId: () => "should_not_be_used",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      {
        kind: "entity",
        entryType: "Positive Adjmt.",
        quantity: 5,
        trackedEntityId: "te_55772",
        readableId: "55772",
        isNew: false,
        entityQuantityBefore: 0,
      },
    ],
  });
});

Deno.test("an existing batch in another bin is reused rather than duplicated", () => {
  const result = resolveAdjustmentPlan({
    adjustmentType: "Positive Adjmt.",
    quantity: 2,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: "55772",
    itemTrackingType: "Batch",
    trackingRows: [
      {
        trackedEntityId: "te_55772",
        storageUnitId: "bin-other",
        quantity: 7,
        readableId: "55772",
      },
    ],
    newEntityId: () => "should_not_be_used",
  });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.movements[0], {
    kind: "entity",
    entryType: "Positive Adjmt.",
    quantity: 2,
    trackedEntityId: "te_55772",
    readableId: "55772",
    isNew: false,
    entityQuantityBefore: 7,
  });
});

Deno.test("a zero-quantity batch still cannot satisfy a negative adjustment", () => {
  // The positive path reuses a depleted batch; the negative path must not
  // pretend it has stock.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Negative Adjmt.",
    quantity: 1,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: "55772",
    itemTrackingType: "Batch",
    trackingRows: [
      {
        trackedEntityId: "te_55772",
        storageUnitId: BIN,
        quantity: 0,
        readableId: "55772",
      },
    ],
    newEntityId: () => "new",
  });
  assertEquals(result, { ok: false, error: "Batch number not found" });
});

Deno.test("a selected row resolves against the bin being adjusted", () => {
  // The snapshot groups by (storageUnitId, trackedEntityId), so one entity can
  // appear in several bins. entityQuantityBefore must describe this bin — it
  // drives the sufficiency check.
  const result = resolveAdjustmentPlan({
    adjustmentType: "Negative Adjmt.",
    quantity: 3,
    storageUnitId: BIN,
    trackedEntityId: "te_split",
    readableId: null,
    itemTrackingType: "Batch",
    trackingRows: [
      {
        trackedEntityId: "te_split",
        storageUnitId: "bin-other",
        quantity: 50,
        readableId: "SPLIT",
      },
      {
        trackedEntityId: "te_split",
        storageUnitId: BIN,
        quantity: 2,
        readableId: "SPLIT",
      },
    ],
    newEntityId: () => "new",
  });
  // Only 2 in this bin, so removing 3 is refused even though the entity holds
  // 52 in total.
  assertEquals(result, {
    ok: false,
    error: "Insufficient quantity for negative adjustment",
  });
});

Deno.test("rows in other bins are ignored", () => {
  const result = resolveAdjustmentPlan({
    adjustmentType: "Set Quantity",
    quantity: 0,
    storageUnitId: BIN,
    trackedEntityId: null,
    readableId: null,
    itemTrackingType: "Batch",
    trackingRows: [
      ...REPORTED_ROWS,
      {
        trackedEntityId: null,
        storageUnitId: "bin-other",
        quantity: 500,
        readableId: null,
      },
    ],
    newEntityId: () => "new",
  });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.movements.reduce((sum, m) => sum + m.quantity, 0),
    103
  );
});

Deno.test("a bin with no storage unit resolves against the null-bin rows", () => {
  const result = resolveAdjustmentPlan({
    adjustmentType: "Set Quantity",
    quantity: 10,
    storageUnitId: null,
    trackedEntityId: null,
    readableId: null,
    itemTrackingType: "Inventory",
    trackingRows: [
      {
        trackedEntityId: null,
        storageUnitId: null,
        quantity: 4,
        readableId: null,
      },
    ],
    newEntityId: () => "new",
  });
  assertEquals(result, {
    ok: true,
    movements: [
      { kind: "untracked", entryType: "Positive Adjmt.", quantity: 6 },
    ],
  });
});
