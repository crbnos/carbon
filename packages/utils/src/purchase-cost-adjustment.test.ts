// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  allocateVarianceAcrossLayers,
  type ReceiptLayerLike
} from "./purchase-cost-adjustment";

// Golden-master tests for the invoice-vs-receipt variance split. Scenarios
// mirror .ai/plans/2026-07-10-purchase-cost-layer-gl-consistency.md (S1–S3):
// on-hand units absorb their share of the variance into inventory via
// per-layer adjustments; consumed units send their share to PPV.

const layer = (
  id: string,
  quantity: number,
  remainingQuantity: number
): ReceiptLayerLike => ({ id, quantity, remainingQuantity });

it("S1: full coverage — all variance to inventory, one adjustment", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, 20);
  expect(result.inventoryShare).toEqual(20);
  expect(result.ppvShare).toEqual(0);
  expect(result.perLayer).toEqual([
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: 20 }
  ]);
});

it("S2: partial coverage — split between inventory and PPV", () => {
  // 2 received @30, 1 already consumed, invoice 2 @40 → variance 20
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 1)], 2, 20);
  expect(result.inventoryShare).toEqual(10);
  expect(result.ppvShare).toEqual(10);
  expect(result.perLayer).toEqual([
    { costLedgerId: "L1", appliedQuantity: 1, adjustmentCost: 10 }
  ]);
});

it("S3 second invoice: zero coverage — all variance to PPV", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 0)], 1, 10);
  expect(result.inventoryShare).toEqual(0);
  expect(result.ppvShare).toEqual(10);
  expect(result.perLayer).toEqual([]);
});

it("negative variance (credit) — full coverage writes inventory down", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, -20);
  expect(result.inventoryShare).toEqual(-20);
  expect(result.ppvShare).toEqual(0);
  expect(result.perLayer).toEqual([
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: -20 }
  ]);
});

it("multi-layer allocation in FIFO order", () => {
  // matched 5 @ perUnit 2; layer A has 1 remaining, layer B has 2 remaining
  const result = allocateVarianceAcrossLayers(
    [layer("A", 3, 1), layer("B", 2, 2)],
    5,
    10
  );
  expect(result.perLayer).toEqual([
    { costLedgerId: "A", appliedQuantity: 1, adjustmentCost: 2 },
    { costLedgerId: "B", appliedQuantity: 2, adjustmentCost: 4 }
  ]);
  expect(result.inventoryShare).toEqual(6);
  expect(result.ppvShare).toEqual(4);
});

it("immaterial variance — all zeros, no adjustments", () => {
  const result = allocateVarianceAcrossLayers([layer("L1", 2, 2)], 2, 0.004);
  expect(result.inventoryShare).toEqual(0);
  expect(result.ppvShare).toEqual(0);
  expect(result.perLayer).toEqual([]);
});

it("zero matched quantity — variance passes through to PPV", () => {
  const result = allocateVarianceAcrossLayers([], 0, 10);
  expect(result.inventoryShare).toEqual(0);
  expect(result.ppvShare).toEqual(10);
  expect(result.perLayer).toEqual([]);
});

it("coverage exceeding matched quantity is capped at matched", () => {
  // 5 remaining on the layer but only 2 matched by this invoice
  const result = allocateVarianceAcrossLayers([layer("L1", 5, 5)], 2, 10);
  expect(result.perLayer).toEqual([
    { costLedgerId: "L1", appliedQuantity: 2, adjustmentCost: 10 }
  ]);
  expect(result.inventoryShare).toEqual(10);
  expect(result.ppvShare).toEqual(0);
});
