// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  batchOutputSerialsByIndex,
  stepRecordsForSelection
} from "./stepRecords";

const outputs = [
  {
    trackedEntityId: "b",
    quantity: 1,
    trackedEntity: { readableId: "SN-002" }
  },
  { trackedEntityId: "c", quantity: 1, trackedEntity: { readableId: null } }
];

it("matches durable indices to the serials on the outputs, independently of output order", () => {
  expect([
    ...batchOutputSerialsByIndex(
      { "Output Unit Indices": { c: 2, b: 1 } },
      outputs
    )
  ]).toEqual([
    [1, "SN-002"],
    [2, "c"]
  ]);
});

it("accepts an older single-unit index only for a sole serial output", () => {
  expect([
    ...batchOutputSerialsByIndex({ Unit: 1 }, outputs.slice(0, 1))
  ]).toEqual([[1, "SN-002"]]);
  expect(batchOutputSerialsByIndex({ Unit: 1 }, outputs).size).toBe(0);
});

it.each([{}, { c: 2 }, { a: 0, c: 2 }, { b: 0, c: 0 }, { b: 0, c: -1 }])(
  "withholds measurements for ambiguous output attribution %o",
  (snapshot) => {
    expect(
      batchOutputSerialsByIndex({ "Output Unit Indices": snapshot }, outputs)
        .size
    ).toBe(0);
  }
);

it("hides the previous activity's response while a new selection is loading", () => {
  const response = {
    activityId: "first",
    stepRecords: [{ id: "previous" }]
  } as Parameters<typeof stepRecordsForSelection>[1];
  expect(stepRecordsForSelection("second", response)).toEqual([]);
});
