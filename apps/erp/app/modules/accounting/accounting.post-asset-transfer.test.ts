// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import {
  postAssetTransferInput,
  resolveCapitalizationCost,
  resolveCapitalizationStock,
  statusAfterCostAdjustment
} from "./accounting.service";

describe("resolveCapitalizationStock", () => {
  it("nets every bin and picks the bin that holds the unit", () => {
    // A picked unit: the warehouse bin nets to 0, lineside holds it, and the
    // warehouse row comes first and must not win.
    expect(
      resolveCapitalizationStock([
        { storageUnitId: "bin_warehouse", onHand: 0 },
        { storageUnitId: "bin_lineside", onHand: 1 }
      ])
    ).toEqual({ onHand: 1, storageUnitId: "bin_lineside" });
  });

  it("reads NUMERIC strings and the unassigned bin", () => {
    expect(
      resolveCapitalizationStock([
        { storageUnitId: null, onHand: "1" },
        { storageUnitId: "bin_2", onHand: "0" }
      ])
    ).toEqual({ onHand: 1, storageUnitId: null });
  });

  it("uses the caller's bin only when nothing nets positive", () => {
    expect(resolveCapitalizationStock([], "bin_caller")).toEqual({
      onHand: 0,
      storageUnitId: "bin_caller"
    });
    expect(
      resolveCapitalizationStock(
        [{ storageUnitId: "bin_actual", onHand: 1 }],
        "bin_caller"
      )
    ).toEqual({ onHand: 1, storageUnitId: "bin_actual" });
  });

  it("reports a unit that is no longer on hand", () => {
    expect(
      resolveCapitalizationStock([
        { storageUnitId: "bin_1", onHand: 1 },
        { storageUnitId: "bin_1", onHand: -1 }
      ]).onHand
    ).toBe(0);
  });
});

describe("resolveCapitalizationCost", () => {
  const cost = (carried: number, entered: number | null) =>
    resolveCapitalizationCost({
      carried,
      entered,
      serial: "SN-1",
      itemReadableId: "RW"
    });

  it("takes the inventory cost when the unit carries one", () => {
    expect(cost(60, null)).toEqual({ cost: 60, source: "inventory" });
  });

  it("takes the entered cost for a unit carried at zero", () => {
    expect(cost(0, 4200)).toEqual({ cost: 4200, source: "entered" });
  });

  it.each([
    ["an entered cost for a unit that carries one", 60, 90],
    ["a unit carried at zero with no entered cost", 0, null]
  ])("refuses %s, naming the serial", (_, carried, entered) => {
    expect(cost(carried, entered)).toEqual({
      error: expect.stringContaining("SN-1")
    });
  });
});

it.each([
  [0, false],
  [-5, false],
  [1250, true]
])("adjustCost with amount %d is accepted: %s", (amount, accepted) => {
  expect(
    postAssetTransferInput.safeParse({
      type: "adjustCost",
      fixedAssetId: "fa_1",
      locationId: "loc_1",
      transferDate: "2026-10-08",
      offsetAccountId: "acc_re",
      amount
    }).success
  ).toBe(accepted);
});

describe("statusAfterCostAdjustment", () => {
  it.each([
    // A zero-cost asset a run marked Fully Depreciated, now worth 1,000 with a
    // 200 residual: 800 left to depreciate.
    ["Fully Depreciated", 0, 20, "Active"],
    // Raised, but net book value 200 is at its residual: nothing left.
    ["Fully Depreciated", 800, 20, "Fully Depreciated"],
    ["Active", 0, 0, "Active"]
  ] as const)(
    "%s asset with 1000 cost, %d depreciated, %d%% residual becomes %s",
    (status, accumulatedDepreciation, residualValuePercent, expected) => {
      expect(
        statusAfterCostAdjustment({
          status,
          acquisitionCost: 1000,
          accumulatedDepreciation,
          residualValuePercent
        })
      ).toBe(expected);
    }
  );
});
