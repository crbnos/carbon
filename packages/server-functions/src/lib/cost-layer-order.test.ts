// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";

import {
  leavingTrackedEntityIds,
  orderLayersForConsumption
} from "./cost-layer-order.ts";

const layer = (id: string, trackedEntityId: string | null = null) => ({
  id,
  trackedEntityId
});
const ids = (layers: { id: string }[]) => layers.map((l) => l.id);

it("with no serial leaving, stamped layers go after every unstamped one", () => {
  // FIFO order: a returned unit's layer (r1) sits between two receipts.
  const layers = [layer("a"), layer("r1", "unit-1"), layer("b")];
  expect(ids(orderLayersForConsumption(layers))).toEqual(["a", "b", "r1"]);
});

it("the serial leaving is relieved from its own layer first", () => {
  const layers = [layer("a"), layer("r1", "unit-1"), layer("b")];
  expect(ids(orderLayersForConsumption(layers, ["unit-1"]))).toEqual([
    "r1",
    "a",
    "b"
  ]);
});

it("another unit's layer is the last resort", () => {
  const layers = [layer("r2", "unit-2"), layer("a"), layer("r1", "unit-1")];
  expect(ids(orderLayersForConsumption(layers, ["unit-1"]))).toEqual([
    "r1",
    "a",
    "r2"
  ]);
});

it("several units leaving keep their layers in the incoming order", () => {
  const layers = [
    layer("r3", "unit-3"),
    layer("a"),
    layer("r1", "unit-1"),
    layer("r2", "unit-2")
  ];
  expect(ids(orderLayersForConsumption(layers, ["unit-2", "unit-3"]))).toEqual([
    "r3",
    "r2",
    "a",
    "r1"
  ]);
});

it("the ids leaving are the item's outgoing tracked rows", () => {
  const rows = [
    { itemId: "item", trackedEntityId: "unit-1", quantity: -1 },
    { itemId: "item", trackedEntityId: "unit-2", quantity: -1 },
    { itemId: "item", trackedEntityId: "unit-2", quantity: -1 },
    { itemId: "item", trackedEntityId: null, quantity: -3 },
    { itemId: "item", trackedEntityId: "unit-9", quantity: 1 },
    { itemId: "other", trackedEntityId: "unit-5", quantity: -1 }
  ];
  expect(leavingTrackedEntityIds(rows, "item")).toEqual(["unit-1", "unit-2"]);
});
