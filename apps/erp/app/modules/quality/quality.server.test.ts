// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  translateLegacyInspectionSavePayload,
  valuateMeasurement
} from "./quality.server";

const numericFeature = {
  type: "Measurement",
  nominalValue: "10",
  tolerancePlus: "0.1",
  toleranceMinus: "0.05"
};

describe("valuateMeasurement", () => {
  it("passes an in-tolerance reading", () => {
    expect(valuateMeasurement(numericFeature, 10.05)).toBe("Passed");
    expect(valuateMeasurement(numericFeature, 9.95)).toBe("Passed");
  });

  it("fails an out-of-tolerance reading on either side", () => {
    expect(valuateMeasurement(numericFeature, 10.11)).toBe("Failed");
    expect(valuateMeasurement(numericFeature, 9.94)).toBe("Failed");
  });

  it("treats a cleared value as Pending", () => {
    expect(valuateMeasurement(numericFeature, null)).toBe("Pending");
  });

  it("takes tolerance magnitudes regardless of sign and strips a leading plus", () => {
    const feature = {
      type: "Measurement",
      nominalValue: "+10",
      tolerancePlus: "+0.1",
      toleranceMinus: "-0.05"
    };
    expect(valuateMeasurement(feature, 9.96)).toBe("Passed");
    expect(valuateMeasurement(feature, 9.94)).toBe("Failed");
  });

  it("falls back to attribute valuation when the nominal does not parse", () => {
    const gdtFeature = {
      type: "Measurement",
      nominalValue: "⌖ 0.2 A B C",
      tolerancePlus: null,
      toleranceMinus: null
    };
    expect(valuateMeasurement(gdtFeature, null, true)).toBe("Passed");
    expect(valuateMeasurement(gdtFeature, null, false)).toBe("Failed");
    expect(valuateMeasurement(gdtFeature, null, null)).toBe("Pending");
  });

  it("valuates non-Measurement features as attributes", () => {
    const checkbox = {
      type: "Checkbox",
      nominalValue: null,
      tolerancePlus: null,
      toleranceMinus: null
    };
    expect(valuateMeasurement(checkbox, null, true)).toBe("Passed");
    expect(valuateMeasurement(checkbox, null, false)).toBe("Failed");
    expect(valuateMeasurement(checkbox, null)).toBe("Pending");
  });
});

describe("translateLegacyInspectionSavePayload", () => {
  it("maps combined balloon+anchor create to feature and geometry create", () => {
    const result = translateLegacyInspectionSavePayload(
      {
        create: [
          {
            tempId: "temp-a1",
            pageNumber: 1,
            xCoordinate: 0.1,
            yCoordinate: 0.2,
            width: 0.05,
            height: 0.04
          }
        ],
        update: [],
        delete: []
      },
      {
        create: [
          {
            tempBalloonAnchorId: "temp-a1",
            label: "1",
            xCoordinate: 0.15,
            yCoordinate: 0.25,
            description: "Diameter",
            nominalValue: "10",
            tolerancePlus: "0.1",
            toleranceMinus: "0.1",
            unit: "mm"
          }
        ],
        update: [],
        delete: []
      }
    );

    expect(result.features.create).toHaveLength(1);
    expect(result.features.create[0]).toMatchObject({
      tempId: "temp-a1",
      label: "1",
      description: "Diameter",
      unit: "mm"
    });
    expect(result.balloons.create).toHaveLength(1);
    expect(result.balloons.create[0]).toMatchObject({
      tempInspectionFeatureId: "temp-a1",
      tempBalloonAnchorId: "temp-a1",
      regionX: 0.1,
      xCoordinate: 0.15
    });
  });

  it("creates anchor-only rows as feature with default label", () => {
    const result = translateLegacyInspectionSavePayload(
      {
        create: [
          {
            tempId: "temp-anchor-only",
            pageNumber: 2,
            xCoordinate: 0,
            yCoordinate: 0,
            width: 0.1,
            height: 0.1
          }
        ],
        update: [],
        delete: []
      },
      { create: [], update: [], delete: [] }
    );

    expect(result.features.create).toEqual([
      expect.objectContaining({
        tempId: "temp-anchor-only",
        label: "0",
        pageNumber: 2
      })
    ]);
    expect(result.balloons.create).toHaveLength(1);
  });
});
