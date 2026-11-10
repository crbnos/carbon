// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  resolveTrackedEntityBin,
  resolveTrackedEntityBins
} from "./resolve-tracked-entity-bin";

const row = (
  trackedEntityId: string | null,
  storageUnitId: string | null,
  quantity: number
) => ({ trackedEntityId, storageUnitId, quantity });

it("returns the bin with the highest positive net on-hand", () => {
  // te has 3 at lineside (net), 0 at source (picked and moved).
  const ledgers = [
    row("te", "source", 5),
    row("te", "source", -5),
    row("te", "lineside", 3)
  ];
  expect(resolveTrackedEntityBin(ledgers, "te")).toEqual("lineside");
});

it("ignores other entities' rows", () => {
  const ledgers = [row("other", "binX", 10), row("te", "binY", 2)];
  expect(resolveTrackedEntityBin(ledgers, "te")).toEqual("binY");
});

it("nets multiple rows per bin before choosing", () => {
  const ledgers = [
    row("te", "a", 4),
    row("te", "a", -3), // a nets to 1
    row("te", "b", 2) // b nets to 2 → wins
  ];
  expect(resolveTrackedEntityBin(ledgers, "te")).toEqual("b");
});

it("falls back to first bin seen when nothing nets positive", () => {
  const ledgers = [row("te", "a", 5), row("te", "a", -5)];
  expect(resolveTrackedEntityBin(ledgers, "te")).toEqual("a");
});

it("returns null when the entity has no bins", () => {
  expect(resolveTrackedEntityBin([row("other", "a", 1)], "te")).toEqual(null);
  expect(resolveTrackedEntityBin([row("te", null, 1)], "te")).toEqual(null);
});

describe("resolveTrackedEntityBins", () => {
  it("counts the unassigned bin as a real bin", () => {
    // Moved from "aftersales" into no storage unit.
    const bins = resolveTrackedEntityBins([
      row("te", "aftersales", 1),
      row("te", "aftersales", -1),
      row("te", null, 1)
    ]);
    expect(bins.get("te")).toEqual({ storageUnitId: null, quantity: 1 });
  });

  it("picks the positive bin when another bin is negative", () => {
    // A shipment once booked this unit against a bin it was never in.
    const bins = resolveTrackedEntityBins([
      row("te", null, 1),
      row("te", "ready-to-sell", -1)
    ]);
    expect(bins.get("te")).toEqual({ storageUnitId: null, quantity: 1 });
  });

  it("leaves out an entity with no positive bin", () => {
    const bins = resolveTrackedEntityBins([
      row("te", "binA", 1),
      row("te", "binA", -1)
    ]);
    expect(bins.has("te")).toBe(false);
  });

  it("resolves each entity independently, highest net wins", () => {
    const bins = resolveTrackedEntityBins([
      row("batch", "binA", 5),
      row("batch", "binB", 15),
      row("serial", "binC", 1),
      row(null, "binD", 9)
    ]);
    expect(bins.get("batch")).toEqual({ storageUnitId: "binB", quantity: 15 });
    expect(bins.get("serial")).toEqual({ storageUnitId: "binC", quantity: 1 });
    expect(bins.size).toBe(2);
  });
});
