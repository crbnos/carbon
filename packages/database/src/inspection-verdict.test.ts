import { describe, expect, it } from "vitest";
import {
  computeLotStatus,
  deriveSampleStatus,
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
