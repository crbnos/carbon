// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  inspectionSaveFeatureCreateItemValidator,
  inspectionSaveFeatureUpdateItemValidator
} from "../app/modules/quality/quality.models";

const created = {
  id: "ift_feature1",
  pageNumber: 1,
  label: "1",
  type: "Measurement" as const
};

describe("MMC/LMC characteristics need a feature of size", () => {
  it("refuses a new MMC characteristic without one", () => {
    expect(
      inspectionSaveFeatureCreateItemValidator.safeParse({
        ...created,
        materialCondition: "MMC"
      }).success
    ).toBe(false);
    expect(
      inspectionSaveFeatureCreateItemValidator.safeParse({
        ...created,
        materialCondition: "MMC",
        featureOfSize: "Internal"
      }).success
    ).toBe(true);
  });

  it("lets a partial update keep the stored feature of size", () => {
    expect(
      inspectionSaveFeatureUpdateItemValidator.safeParse({
        id: "ift_feature1",
        materialCondition: "LMC"
      }).success
    ).toBe(true);
  });

  it("refuses an update that clears it next to MMC/LMC", () => {
    expect(
      inspectionSaveFeatureUpdateItemValidator.safeParse({
        id: "ift_feature1",
        materialCondition: "MMC",
        featureOfSize: null
      }).success
    ).toBe(false);
  });
});
