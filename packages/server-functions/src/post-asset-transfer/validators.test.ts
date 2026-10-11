// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  CLOSED_JOB_STATUSES,
  postAssetTransferInput,
  RETURNABLE_ASSET_STATUSES,
  resolveCapitalizationCost,
  resolveCapitalizationStock,
  statusAfterCostAdjustment
} from "./validators";

it("capitalize accepts the inventory payload with its optional fields absent", () => {
  const parsed = postAssetTransferInput.parse({
    type: "capitalize",
    fixedAssetClassId: "class_fleet",
    itemId: "item_1",
    trackedEntityId: "te_1",
    locationId: "loc_1",
    transferDate: "2026-09-22"
  });
  expect(parsed.type).toEqual("capitalize");
  if (parsed.type === "capitalize") {
    expect(parsed.storageUnitId).toEqual(undefined);
    expect(parsed.name).toEqual(undefined);
    expect(parsed.fixedAssetId).toEqual(undefined);
  }
});

it("capitalize carries an existing Draft asset id and a name when given", () => {
  const parsed = postAssetTransferInput.parse({
    type: "capitalize",
    fixedAssetClassId: "class_fleet",
    itemId: "item_1",
    trackedEntityId: "te_1",
    locationId: "loc_1",
    storageUnitId: "bin_1",
    transferDate: "2026-09-22",
    name: "Van VIN-001",
    fixedAssetId: "fa_draft"
  });
  if (parsed.type !== "capitalize") throw new Error("wrong variant");
  expect(parsed.fixedAssetId).toEqual("fa_draft");
  expect(parsed.name).toEqual("Van VIN-001");
  expect(parsed.storageUnitId).toEqual("bin_1");
});

it("return needs the asset, the location and the transfer date", () => {
  const parsed = postAssetTransferInput.parse({
    type: "return",
    fixedAssetId: "fa_1",
    locationId: "loc_1",
    transferDate: "2027-01-15"
  });
  expect(parsed.type).toEqual("return");
  expect(() =>
    postAssetTransferInput.parse({
      type: "return",
      fixedAssetId: "fa_1",
      transferDate: "2027-01-15"
    })
  ).toThrow();
});

it("attachJob needs only the asset and the job", () => {
  const parsed = postAssetTransferInput.parse({
    type: "attachJob",
    fixedAssetId: "fa_cip",
    jobId: "job_1"
  });
  expect(parsed.type).toEqual("attachJob");
  expect(() =>
    postAssetTransferInput.parse({
      type: "attachJob",
      fixedAssetId: "fa_cip"
    })
  ).toThrow();
});

it("capitalizeCip needs the target class and an in-service date", () => {
  const parsed = postAssetTransferInput.parse({
    type: "capitalizeCip",
    fixedAssetId: "fa_cip",
    toClassId: "class_machinery",
    inServiceDate: "2026-11-01"
  });
  expect(parsed.type).toEqual("capitalizeCip");
  expect(() =>
    postAssetTransferInput.parse({
      type: "capitalizeCip",
      fixedAssetId: "fa_cip",
      toClassId: "class_machinery"
    })
  ).toThrow();
});

it("dates must be YYYY-MM-DD text, never a timestamp", () => {
  expect(() =>
    postAssetTransferInput.parse({
      type: "return",
      fixedAssetId: "fa_1",
      locationId: "loc_1",
      transferDate: "2027-01-15T00:00:00.000Z"
    })
  ).toThrow();
  expect(() =>
    postAssetTransferInput.parse({
      type: "capitalizeCip",
      fixedAssetId: "fa_cip",
      toClassId: "class_machinery",
      inServiceDate: "11/01/2026"
    })
  ).toThrow();
});

it("every variant requires its ids; unknown types are refused", () => {
  expect(() =>
    postAssetTransferInput.parse({
      type: "attachJob",
      fixedAssetId: "fa_cip",
      jobId: ""
    })
  ).toThrow();
  expect(() =>
    postAssetTransferInput.parse({
      type: "reclassify",
      fixedAssetId: "fa_1"
    })
  ).toThrow();
});

it("stock resolution sums every bin and picks the bin holding the unit", () => {
  // A picked unit: −1 in the warehouse bin, +1 at lineside — the warehouse
  // row comes first, and must not win.
  const stock = resolveCapitalizationStock([
    { storageUnitId: "bin_warehouse", onHand: 0 },
    { storageUnitId: "bin_lineside", onHand: 1 }
  ]);
  expect(stock).toEqual({ onHand: 1, storageUnitId: "bin_lineside" });
});

it("stock resolution reads NUMERIC strings and unassigned bins", () => {
  const stock = resolveCapitalizationStock([
    { storageUnitId: null, onHand: "1" },
    { storageUnitId: "bin_2", onHand: "0" }
  ]);
  expect(stock.onHand).toEqual(1);
  expect(stock.storageUnitId).toEqual(null);
});

it("stock resolution falls back to the caller's bin only when nothing nets positive", () => {
  expect(resolveCapitalizationStock([], "bin_caller")).toEqual({
    onHand: 0,
    storageUnitId: "bin_caller"
  });
  expect(
    resolveCapitalizationStock(
      [{ storageUnitId: "bin_actual", onHand: 1 }],
      "bin_caller"
    ).storageUnitId
  ).toEqual("bin_actual");
});

it("stock resolution reports a unit that is no longer on hand", () => {
  const stock = resolveCapitalizationStock([
    { storageUnitId: "bin_1", onHand: 1 },
    { storageUnitId: "bin_1", onHand: -1 }
  ]);
  expect(stock.onHand).toEqual(0);
});

it("status sets match the plan", () => {
  expect([...CLOSED_JOB_STATUSES]).toEqual([
    "Completed",
    "Cancelled",
    "Closed"
  ]);
  expect([...RETURNABLE_ASSET_STATUSES]).toEqual([
    "Active",
    "Fully Depreciated"
  ]);
  expect(RETURNABLE_ASSET_STATUSES.has("Under Construction")).toEqual(false);
  expect(CLOSED_JOB_STATUSES.has("Paused")).toEqual(false);
});

it("adjustCost requires a positive amount", () => {
  const base = {
    type: "adjustCost",
    fixedAssetId: "fa_1",
    locationId: "loc_1",
    transferDate: "2026-10-08"
  };
  expect(postAssetTransferInput.safeParse({ ...base, amount: 0 }).success).toBe(
    false
  );
  expect(
    postAssetTransferInput.safeParse({ ...base, amount: -5 }).success
  ).toBe(false);
  expect(
    postAssetTransferInput.safeParse({
      ...base,
      amount: 1250,
      offsetAccountId: "acc_re"
    }).success
  ).toBe(true);
});

it("capitalize takes the inventory cost when the unit carries one", () => {
  expect(
    resolveCapitalizationCost({
      carried: 60,
      entered: null,
      serial: "SN-1",
      itemReadableId: "RW"
    })
  ).toEqual({ cost: 60, source: "inventory" });
});

it("capitalize refuses an entered cost for a unit that carries one", () => {
  const resolved = resolveCapitalizationCost({
    carried: 60,
    entered: 90,
    serial: "SN-1",
    itemReadableId: "RW"
  });
  expect("error" in resolved && resolved.error).toMatch(
    /SN-1 is carried in inventory at a cost/
  );
});

it("capitalize takes the entered cost for a unit carried at zero", () => {
  expect(
    resolveCapitalizationCost({
      carried: 0,
      entered: 4200,
      serial: "SN-2",
      itemReadableId: "RW"
    })
  ).toEqual({ cost: 4200, source: "entered" });
});

it("capitalize refuses a unit carried at zero with no entered cost", () => {
  const resolved = resolveCapitalizationCost({
    carried: 0,
    entered: null,
    serial: "SN-2",
    itemReadableId: "RW"
  });
  expect("error" in resolved && resolved.error).toMatch(
    /SN-2 has no cost in inventory/
  );
});

it("a Fully Depreciated asset whose cost is raised above its residual returns to Active", () => {
  // A zero-cost asset a run marked Fully Depreciated, now worth 1,000.
  expect(
    statusAfterCostAdjustment({
      status: "Fully Depreciated",
      acquisitionCost: 1000,
      accumulatedDepreciation: 0,
      residualValuePercent: 20
    })
  ).toEqual("Active");
  // Raised, but still at or below its residual: nothing left to depreciate.
  expect(
    statusAfterCostAdjustment({
      status: "Fully Depreciated",
      acquisitionCost: 1000,
      accumulatedDepreciation: 800,
      residualValuePercent: 20
    })
  ).toEqual("Fully Depreciated");
  expect(
    statusAfterCostAdjustment({
      status: "Active",
      acquisitionCost: 1000,
      accumulatedDepreciation: 0,
      residualValuePercent: 0
    })
  ).toEqual("Active");
});
