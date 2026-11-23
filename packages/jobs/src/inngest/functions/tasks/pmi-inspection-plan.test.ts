// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { valuateMeasurement } from "@carbon/database/quality";
import {
  type PmiDimension,
  type PmiDocument,
  type PmiItem,
  pmiInspectionCharacteristics
} from "@carbon/viewer/pmi";
import { describe, expect, it } from "vitest";

// The characteristics a PMI plan holds are graded by `valuateMeasurement`,
// which reads Tol+ and Tol− as magnitudes around the nominal. These cases pin
// that the mapping and the grading agree at the drawing's own limits — the
// pair lives in two packages, so neither package's tests can see a drift.

function dimension(id: string, overrides: Partial<PmiDimension>): PmiItem {
  return {
    id,
    kind: "dimension",
    name: null,
    dimension: {
      type: "diameter",
      value: 10,
      upper: null,
      lower: null,
      upperBound: null,
      lowerBound: null,
      fitClass: null,
      qualifier: null,
      decimals: null,
      modifiers: [],
      descriptions: [],
      ...overrides
    },
    tolerance: null,
    datum: null,
    lines: [],
    mesh: null,
    plane: null,
    textPosition: null,
    faces: [],
    edges: []
  };
}

function grade(item: PmiItem, readings: number[]) {
  const doc: PmiDocument = {
    version: 1,
    unit: "mm",
    sourceUnit: "mm",
    items: [item],
    faces: [],
    edges: [],
    views: []
  };
  const [feature] = pmiInspectionCharacteristics(doc);
  if (!feature) throw new Error("no characteristic");
  return readings.map((value) =>
    valuateMeasurement({ ...feature, type: "Measurement" }, value)
  );
}

describe("PMI characteristics graded by valuateMeasurement", () => {
  it("passes a ± dimension inside its limits only", () => {
    expect(
      grade(
        dimension("d1", { upper: 0.05, lower: -0.02 }),
        [9.979, 9.98, 10.05, 10.051]
      )
    ).toEqual(["Failed", "Passed", "Passed", "Failed"]);
  });

  it("passes a shaft fit wholly below the nominal only inside its band", () => {
    // ⌀10 −0.013/−0.028: 9.972 to 9.987. The nominal itself is oversize.
    expect(
      grade(
        dimension("d1", { upper: -0.013, lower: -0.028 }),
        [9.971, 9.972, 9.987, 9.988, 10]
      )
    ).toEqual(["Failed", "Passed", "Passed", "Failed", "Failed"]);
  });

  it("passes a press fit wholly above the nominal only inside its band", () => {
    // ⌀10 +0.05/+0.02: 10.02 to 10.05.
    expect(
      grade(
        dimension("d1", { upper: 0.05, lower: 0.02 }),
        [10, 10.02, 10.05, 10.051]
      )
    ).toEqual(["Failed", "Passed", "Passed", "Failed"]);
  });

  it("passes a limit dimension between its limits", () => {
    expect(
      grade(
        dimension("d1", { value: 35, upperBound: 35.2, lowerBound: 34.8 }),
        [34.79, 34.8, 35.2, 35.21]
      )
    ).toEqual(["Failed", "Passed", "Passed", "Failed"]);
  });
});
