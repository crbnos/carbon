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
