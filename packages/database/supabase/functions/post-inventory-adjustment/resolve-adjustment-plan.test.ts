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
