import { describe, expect, it } from "vitest";
import { valuateMeasurement } from "./quality.server";

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
