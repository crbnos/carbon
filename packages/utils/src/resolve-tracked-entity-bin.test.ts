// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { resolveTrackedEntityBin } from "./resolve-tracked-entity-bin";

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
