// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  NO_CAP_WARNING,
  planRefurbishmentCompletion,
  type RefurbishmentChild,
  type RefurbishmentCompletionInput,
  type RefurbishmentLayer
} from "./plan";

const SERIAL = "te_sn0050";

const layer = (
  id: string,
  quantity: number,
  unitCost: number,
  extra: Partial<RefurbishmentLayer> = {}
): RefurbishmentLayer => ({
  id,
  quantity,
  remainingQuantity: quantity,
  cost: quantity * unitCost,
  trackedEntityId: null,
  postingDate: "2026-09-01",
  createdAt: "2026-09-01T08:00:00.000000",
  ...extra
});

const child = (
  id: string,
  appliesToCostLedgerId: string,
  quantity: number,
  cost: number
): RefurbishmentChild => ({
  id,
  appliesToCostLedgerId,
  quantity,
  remainingQuantity: quantity,
  cost,
  createdAt: "2026-09-02T08:00:00.000000"
});

const input = (
  extra: Partial<RefurbishmentCompletionInput>
): RefurbishmentCompletionInput => ({
  costingMethod: "FIFO",
  wipTotal: 200,
  serialId: SERIAL,
  openLayers: [layer("cl_a", 10, 100)],
  openChildren: [],
  onHandQuantity: 10,
  currentUnitCost: 100,
  cap: 1000,
  abnormalRework: false,
  ...extra
});

describe("planRefurbishmentCompletion", () => {
  it("splits one unit off the FIFO layer and capitalizes the WIP on it", () => {
    const plan = planRefurbishmentCompletion(input({}));

    expect(plan.treatment).toBe("Capitalize");
    expect(plan.serialLayerId).toBeNull();
    expect(plan.split).toEqual({
      sourceLayerId: "cl_a",
      sourceQuantity: 9,
      sourceRemainingQuantity: 9,
      sourceCost: 900,
      cost: 100
    });
    expect(plan.childMoves).toEqual([]);
    expect(plan.revaluation).toEqual({ cost: 200, attached: true });
    expect(plan.writeDown).toBe(0);
    expect(plan.newSerialUnitCost).toBe(300);
    expect(plan.capitalizedAmount).toBe(200);
    expect(plan.journal).toEqual([
      {
        account: "inventory",
        side: "debit",
        amount: 200,
        description: "Refurbishment"
      },
      {
        account: "workInProgress",
        side: "credit",
        amount: 200,
        description: "Refurbishment"
      }
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("splits from the newest layer under LIFO", () => {
    const plan = planRefurbishmentCompletion(
      input({
        costingMethod: "LIFO",
        openLayers: [
          layer("cl_old", 5, 90, { postingDate: "2026-08-01" }),
          layer("cl_new", 5, 110, { postingDate: "2026-09-01" })
        ]
      })
    );

    expect(plan.split?.sourceLayerId).toBe("cl_new");
    expect(plan.split?.cost).toBe(110);
    expect(plan.newSerialUnitCost).toBe(310);
  });

  it("moves one unit of the source layer's open child onto the serial", () => {
    const plan = planRefurbishmentCompletion(
      input({
        openLayers: [layer("cl_a", 10, 100)],
        openChildren: [child("cl_ppv", "cl_a", 5, 10)]
      })
    );

    expect(plan.childMoves).toEqual([
      {
        childId: "cl_ppv",
        quantity: 4,
        remainingQuantity: 4,
        cost: 8,
        movedQuantity: 1,
        movedCost: 2
      }
    ]);
    expect(plan.currentSerialUnitCost).toBe(102);
    expect(plan.newSerialUnitCost).toBe(302);
  });

  it("writes down the cost over the cap", () => {
    const plan = planRefurbishmentCompletion(input({ cap: 250 }));

    // 100.00 + 200.00 = 300.00 against a cap of 250.00.
    expect(plan.writeDown).toBe(50);
    expect(plan.newSerialUnitCost).toBe(250);
    expect(plan.journal).toEqual([
      expect.objectContaining({
        account: "inventory",
        side: "debit",
        amount: 200
      }),
      expect.objectContaining({
        account: "workInProgress",
        side: "credit",
        amount: 200
      }),
      expect.objectContaining({
        account: "inventoryAdjustmentVariance",
        side: "debit",
        amount: 50
      }),
      expect.objectContaining({
        account: "inventory",
        side: "credit",
        amount: 50
      })
    ]);
  });

  it("warns and writes nothing down when there is no cap", () => {
    const plan = planRefurbishmentCompletion(input({ cap: null }));

    expect(plan.writeDown).toBe(0);
    expect(plan.warnings).toEqual([NO_CAP_WARNING]);
    expect(plan.newSerialUnitCost).toBe(300);
  });

  it("posts abnormal rework to material variance with no child", () => {
    const plan = planRefurbishmentCompletion(input({ abnormalRework: true }));

    expect(plan.treatment).toBe("Material Variance");
    expect(plan.split).toBeNull();
    expect(plan.revaluation).toBeNull();
    expect(plan.capitalizedAmount).toBe(0);
    expect(plan.journal).toEqual([
      expect.objectContaining({
        account: "materialVariance",
        side: "debit",
        amount: 200
      }),
      expect.objectContaining({
        account: "workInProgress",
        side: "credit",
        amount: 200
      })
    ]);
  });

  it("re-averages the unit cost under Average", () => {
    const plan = planRefurbishmentCompletion(
      input({
        costingMethod: "Average",
        onHandQuantity: 10,
        currentUnitCost: 100
      })
    );

    expect(plan.averageUnitCost).toBe(120);
    expect(plan.split).toBeNull();
    // No layer of the serial's own: the child only keeps the cost history.
    expect(plan.revaluation).toEqual({ cost: 200, attached: false });
    expect(plan.journal.map((line) => line.account)).toEqual([
      "inventory",
      "workInProgress"
    ]);
  });

  it("posts the WIP to material variance under Standard", () => {
    const plan = planRefurbishmentCompletion(
      input({ costingMethod: "Standard" })
    );

    expect(plan.treatment).toBe("Material Variance");
    expect(plan.split).toBeNull();
    expect(plan.revaluation).toBeNull();
    expect(plan.averageUnitCost).toBeNull();
    expect(plan.journal).toEqual([
      expect.objectContaining({
        account: "materialVariance",
        side: "debit",
        amount: 200
      }),
      expect.objectContaining({
        account: "workInProgress",
        side: "credit",
        amount: 200
      })
    ]);
  });
});
