import { describe, expect, it } from "vitest";
import {
  computeLotStatus,
  deriveSampleStatus,
  valuateGeometricMeasurement,
  valuateMeasurement
} from "../supabase/functions/shared/inspection-verdict.ts";
import { deriveSampleStatus as seededSampleStatus } from "./datasets/helpers/inspection.ts";

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
