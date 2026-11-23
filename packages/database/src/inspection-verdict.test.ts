// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { deriveSampleStatus as seededSampleStatus } from "./datasets/helpers/inspection.ts";
import {
  computeLotStatus,
  deriveSampleStatus,
  measurementDeviation,
  parseSpecNumber,
  toleranceLimits,
  valuateGeometricMeasurement,
  valuateMeasurement
} from "./inspection-verdict.ts";

const feature = {
  type: "Measurement",
  nominalValue: "10",
  tolerancePlus: "+0.1",
  toleranceMinus: "-0.05"
};

describe("valuateMeasurement", () => {
  it("judges a numeric Measurement inside [nominal - |tol-|, nominal + |tol+|]", () => {
    expect(valuateMeasurement(feature, 10.1)).toBe("Passed");
    expect(valuateMeasurement(feature, 9.95)).toBe("Passed");
    expect(valuateMeasurement(feature, 10.11)).toBe("Failed");
    expect(valuateMeasurement(feature, null)).toBe("Pending");
  });

  it("passes a reading exactly on a limit that float subtraction misses", () => {
    // 1.60 - 0.16 is 1.4400000000000002 in binary floating point.
    const thickness = {
      type: "Measurement",
      nominalValue: "1.60",
      tolerancePlus: "0.16",
      toleranceMinus: "0.16"
    };
    expect(valuateMeasurement(thickness, 1.44)).toBe("Passed");
    expect(valuateMeasurement(thickness, 1.76)).toBe("Passed");
    expect(valuateMeasurement(thickness, 1.4399)).toBe("Failed");
  });

  it("keeps every digit of a fine spec's limits", () => {
    const fine = {
      type: "Measurement",
      nominalValue: "1.000004",
      tolerancePlus: "0",
      toleranceMinus: "0"
    };
    expect(valuateMeasurement(fine, 1.000004)).toBe("Passed");
    expect(valuateMeasurement(fine, 1)).toBe("Failed");
    expect(valuateMeasurement(fine, 1.000006)).toBe("Failed");
  });

  it("passes a reading on the displayed limit despite float noise", () => {
    // 0.8 - 0.1 is 0.7000000000000001 in IEEE 754; the grid shows 0.7.
    const spec = {
      type: "Measurement",
      nominalValue: "0.8",
      tolerancePlus: "0.1",
      toleranceMinus: "0.1"
    };
    expect(valuateMeasurement(spec, 0.7)).toBe("Passed");
    expect(valuateMeasurement(spec, 0.9)).toBe("Passed");
    expect(valuateMeasurement(spec, 0.69)).toBe("Failed");
  });

  it("treats an unparseable nominal as a pass/fail toggle", () => {
    const gdt = { ...feature, nominalValue: "⌖ 0.05 A B" };
    expect(valuateMeasurement(gdt, 10)).toBe("Pending");
    expect(valuateMeasurement(gdt, null, false)).toBe("Failed");
  });
});

describe("deriveSampleStatus", () => {
  const passed = (id: string) => ({
    inspectionFeatureId: id,
    status: "Passed"
  });
  it("fails on any failed reading", () => {
    expect(
      deriveSampleStatus(
        ["a", "b"],
        [passed("a"), { inspectionFeatureId: "b", status: "Failed" }]
      )
    ).toBe("Failed");
  });
  it("passes only once every lot feature has a passing reading", () => {
    expect(deriveSampleStatus(["a", "b"], [passed("a")])).toBe("Pending");
    expect(deriveSampleStatus(["a", "b"], [passed("a"), passed("b")])).toBe(
      "Passed"
    );
  });
  it("never passes a sample on a lot with no features", () => {
    expect(deriveSampleStatus([], [])).toBe("Pending");
    expect(
      seededSampleStatus([], {
        status: "Passed",
        inspectedOffset: 0,
        measurements: []
      })
    ).toBe("Pending");
  });
});

describe("computeLotStatus", () => {
  it("is In Progress once any sample has a verdict", () => {
    expect(computeLotStatus([])).toBe("Pending");
    expect(computeLotStatus([{ status: "Pending" }])).toBe("Pending");
    expect(
      computeLotStatus([{ status: "Pending" }, { status: "Failed" }])
    ).toBe("In Progress");
  });
});

describe("valuateGeometricMeasurement", () => {
  // Position ⌀.010 at MMC on a ⌀.250 +.005/−0 hole.
  const position = {
    type: "Measurement",
    nominalValue: "0",
    tolerancePlus: "0.010",
    toleranceMinus: "0",
    materialCondition: "MMC" as const,
    featureOfSize: "Internal" as const
  };
  const holeSpec = {
    type: "Measurement",
    nominalValue: ".250",
    tolerancePlus: ".005",
    toleranceMinus: "0"
  };
  const hole = (value: number | null, status = "Passed") => ({
    spec: holeSpec,
    value,
    status
  });

  it("adds the size's departure from MMC as bonus", () => {
    expect(valuateGeometricMeasurement(position, 0.013, hole(0.254))).toEqual({
      status: "Passed",
      bonus: 0.004,
      allowable: 0.014
    });
  });

  it("earns no bonus when the size sits at MMC", () => {
    expect(valuateGeometricMeasurement(position, 0.013, hole(0.25))).toEqual({
      status: "Failed",
      bonus: 0,
      allowable: 0.01
    });
  });

  it("judges against the stated tolerance with no size reading", () => {
    expect(valuateGeometricMeasurement(position, 0.009, null)).toEqual({
      status: "Passed",
      bonus: 0,
      allowable: 0.01
    });
    expect(valuateGeometricMeasurement(position, 0.011, null).status).toBe(
      "Failed"
    );
    expect(
      valuateGeometricMeasurement(position, 0.009, hole(null, "Pending")).bonus
    ).toBe(0);
  });

  it("is Pending with no reading, reporting the stated allowable", () => {
    expect(valuateGeometricMeasurement(position, null, hole(0.254))).toEqual({
      status: "Pending",
      bonus: null,
      allowable: 0.01
    });
  });

  it("fails outright when the size reading failed", () => {
    expect(
      valuateGeometricMeasurement(position, 0.001, hole(0.26, "Failed"))
    ).toEqual({ status: "Failed", bonus: 0, allowable: 0.01 });
  });

  it("earns no bonus when the feature of size is not declared", () => {
    expect(
      valuateGeometricMeasurement(
        { ...position, featureOfSize: null },
        0.013,
        hole(0.254)
      )
    ).toEqual({ status: "Failed", bonus: 0, allowable: 0.01 });
    expect(
      valuateGeometricMeasurement(
        { ...position, featureOfSize: null },
        0.009,
        hole(0.254)
      )
    ).toEqual({ status: "Passed", bonus: 0, allowable: 0.01 });
  });

  it("clamps the bonus to the size tolerance band", () => {
    expect(valuateGeometricMeasurement(position, 0.013, hole(0.26)).bonus).toBe(
      0.005
    );
  });

  it("measures an external feature's MMC from the upper limit", () => {
    const pin = {
      spec: {
        type: "Measurement",
        nominalValue: ".250",
        tolerancePlus: "0",
        toleranceMinus: "-.005"
      },
      value: 0.246,
      status: "Passed"
    };
    expect(
      valuateGeometricMeasurement(
        { ...position, featureOfSize: "External" },
        0.013,
        pin
      ).bonus
    ).toBe(0.004);
  });

  it("measures an internal feature's LMC from the upper limit", () => {
    expect(
      valuateGeometricMeasurement(
        { ...position, materialCondition: "LMC" },
        0.013,
        hole(0.251)
      ).bonus
    ).toBe(0.004);
  });

  it("gives a zero-at-MMC callout its whole allowance from bonus", () => {
    const zero = { ...position, tolerancePlus: "0" };
    const result = valuateGeometricMeasurement(zero, 0.003, hole(0.254));
    expect(result).toEqual({
      status: "Passed",
      bonus: 0.004,
      allowable: 0.004
    });
  });

  it("falls back to valuateMeasurement at RFS with no bonus", () => {
    const rfs = { ...position, materialCondition: "RFS" as const };
    for (const value of [0.009, 0.011, null]) {
      expect(valuateGeometricMeasurement(rfs, value, hole(0.254))).toEqual({
        status: valuateMeasurement(rfs, value),
        bonus: null,
        allowable: null
      });
    }
    expect(
      valuateGeometricMeasurement(
        { ...position, materialCondition: null },
        0.011,
        hole(0.254)
      ).bonus
    ).toBeNull();
  });
});
describe("toleranceLimits", () => {
  it("gives the band valuateMeasurement judges, at the drawing's precision", () => {
    expect(toleranceLimits(feature)).toEqual({
      nominal: 10,
      lower: 9.95,
      upper: 10.1,
      decimals: 2
    });
  });

  it("does not leak float noise into a limit", () => {
    // 0.3 - 0.1 is 0.19999999999999998 in IEEE 754.
    expect(
      toleranceLimits({
        type: "Measurement",
        nominalValue: "0.3",
        tolerancePlus: "0.1",
        toleranceMinus: "0.1"
      })
    ).toEqual({ nominal: 0.3, lower: 0.2, upper: 0.4, decimals: 1 });
  });

  it("reads the precision of a spec in exponent notation", () => {
    expect(
      toleranceLimits({
        type: "Measurement",
        nominalValue: "0.005",
        tolerancePlus: "1e-3",
        toleranceMinus: "1.5e-3"
      })
    ).toEqual({ nominal: 0.005, lower: 0.0035, upper: 0.006, decimals: 4 });
  });

  it("is null for a feature judged as an attribute", () => {
    expect(toleranceLimits({ ...feature, type: "Visual" })).toBeNull();
    expect(
      toleranceLimits({ ...feature, nominalValue: "⌖ 0.05 A" })
    ).toBeNull();
  });
});

describe("measurementDeviation", () => {
  it("names the side of the band a failed reading is on", () => {
    expect(measurementDeviation(feature, 10.2)).toBe("above");
    expect(measurementDeviation(feature, 9.9)).toBe("below");
  });

  it("is null for a passing or missing reading", () => {
    expect(measurementDeviation(feature, 10)).toBeNull();
    expect(measurementDeviation(feature, null)).toBeNull();
  });
});

describe("parseSpecNumber", () => {
  it("reads plain decimals, a leading sign and an exponent", () => {
    expect(parseSpecNumber("10")).toBe(10);
    expect(parseSpecNumber(" +0.1 ")).toBe(0.1);
    expect(parseSpecNumber("-5")).toBe(-5);
    expect(parseSpecNumber(".5")).toBe(0.5);
    expect(parseSpecNumber("1e3")).toBe(1000);
    expect(parseSpecNumber("5E-7")).toBe(0.0000005);
  });

  it("is null for anything else, so the characteristic is judged pass / fail", () => {
    for (const text of [
      "",
      "  ",
      "Infinity",
      "-Infinity",
      "0x10",
      "12,5",
      "per drawing",
      "1_000",
      null
    ]) {
      expect(parseSpecNumber(text)).toBeNull();
    }
  });
});
