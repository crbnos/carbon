// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getStandardUnitOfMeasure } from "../../units-of-measure";
import { DATASETS } from "../index";
import type { Dataset } from "../types";
import { datasetUnitOfMeasureCodes } from "./units-of-measure";

describe("datasetUnitOfMeasureCodes", () => {
  it("reads every key ending in unitOfMeasureCode, at any depth", () => {
    const dataset = {
      items: [{ unitOfMeasureCode: "LB" }],
      lines: [{ nested: { purchaseUnitOfMeasureCode: "kg" } }],
      steps: [{ unitOfMeasureCode: "INCH", name: "unitOfMeasureCode" }]
    } as unknown as Dataset;
    expect([...datasetUnitOfMeasureCodes(dataset)].sort()).toEqual([
      "INCH",
      "LB",
      "kg"
    ]);
  });

  it("finds only catalog units in the shipped datasets", () => {
    for (const dataset of Object.values(DATASETS)) {
      const codes = datasetUnitOfMeasureCodes(dataset);
      // The imperial units are the ones a metric company holds inactive.
      expect(codes.has("EA")).toBe(true);
      for (const code of codes) {
        expect(getStandardUnitOfMeasure(code), code).toBeDefined();
      }
    }
  });
});
