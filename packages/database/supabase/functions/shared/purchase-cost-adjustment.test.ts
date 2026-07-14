import {
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  allocateVarianceAcrossLayers,
  type ReceiptLayerLike,
} from "./purchase-cost-adjustment.ts";

// Golden-master tests for the invoice-vs-receipt variance split. Scenarios
// mirror .ai/plans/2026-07-10-purchase-cost-layer-gl-consistency.md (S1–S3):
// on-hand units absorb their share of the variance into inventory via
// per-layer adjustments; consumed units send their share to PPV.

const layer = (
  id: string,
  quantity: number,
  remainingQuantity: number
): ReceiptLayerLike => ({ id, quantity, remainingQuantity });

Deno.test("S1: full coverage — all variance to inventory, one adjustment", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, 20);
  assertEquals(result.inventoryShare, 20);
  assertEquals(result.ppvShare, 0);
  assertEquals(result.perLayer, [
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: 20 },
  ]);
});

Deno.test("S2: partial coverage — split between inventory and PPV", () => {
  // 2 received @30, 1 already consumed, invoice 2 @40 → variance 20
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 1)], 2, 20);
  assertEquals(result.inventoryShare, 10);
  assertEquals(result.ppvShare, 10);
  assertEquals(result.perLayer, [
    { costLedgerId: "L1", appliedQuantity: 1, adjustmentCost: 10 },
  ]);
});

Deno.test("S3 second invoice: zero coverage — all variance to PPV", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 0)], 1, 10);
  assertEquals(result.inventoryShare, 0);
  assertEquals(result.ppvShare, 10);
  assertEquals(result.perLayer, []);
});

Deno.test("negative variance (credit) — full coverage writes inventory down", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, -20);
  assertEquals(result.inventoryShare, -20);
  assertEquals(result.ppvShare, 0);
  assertEquals(result.perLayer, [
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: -20 },
  ]);
});

Deno.test("multi-layer allocation in FIFO order", () => {
  // matched 5 @ perUnit 2; layer A has 1 remaining, layer B has 2 remaining
  const result = allocateVarianceAcrossLayers(
    [layer("A", 3, 1), layer("B", 2, 2)],
    5,
    10
  );
  assertEquals(result.perLayer, [
    { costLedgerId: "A", appliedQuantity: 1, adjustmentCost: 2 },
    { costLedgerId: "B", appliedQuantity: 2, adjustmentCost: 4 },
  ]);
  assertEquals(result.inventoryShare, 6);
  assertEquals(result.ppvShare, 4);
});

Deno.test("immaterial variance — all zeros, no adjustments", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, 0.004);
  assertEquals(result.inventoryShare, 0);
  assertEquals(result.ppvShare, 0);
  assertEquals(result.perLayer, []);
});

Deno.test("zero matched quantity — variance passes through to PPV", () => {
  const result = allocateVarianceAcrossLayers([], 0, 10);
  assertEquals(result.inventoryShare, 0);
  assertEquals(result.ppvShare, 10);
  assertEquals(result.perLayer, []);
});

Deno.test("coverage exceeding matched quantity is capped at matched", () => {
  // 5 remaining on the layer but only 2 matched by this invoice
  const result = allocateVarianceAcrossLayers([layer("L1", 5, 5)], 2, 10);
  assertEquals(result.perLayer, [
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: 10 },
  ]);
  assertEquals(result.inventoryShare, 10);
  assertEquals(result.ppvShare, 0);
});
