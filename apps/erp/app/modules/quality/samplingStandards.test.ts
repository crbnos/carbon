import { describe, expect, it } from "vitest";
import {
  resolveFeatureSamplingPlan,
  resolveSamplingPlan
} from "./samplingStandards";

describe("resolveFeatureSamplingPlan", () => {
  it("uses the feature's own AQL rule over the item plan", () => {
    const result = resolveFeatureSamplingPlan(
      {
        samplingPlanType: "AQL",
        samplingAql: 1.0,
        samplingInspectionLevel: "II",
        samplingSeverity: "Normal"
      },
      { type: "Percentage", percentage: 50 },
      200,
      "ANSI_Z1_4"
    );
    expect(result).toEqual(
      resolveSamplingPlan(
        { type: "AQL", aql: 1.0, inspectionLevel: "II", severity: "Normal" },
        200,
        "ANSI_Z1_4"
      )
    );
    expect(result.codeLetter).not.toBeNull();
    expect(result.sampleSize).toBeLessThan(200);
  });

  it("falls back to the item plan when the feature has no rule", () => {
    const result = resolveFeatureSamplingPlan(
      { samplingPlanType: null },
      { type: "Percentage", percentage: 10 },
      200,
      "ANSI_Z1_4"
    );
    expect(result.sampleSize).toBe(20);
    expect(result.acceptance).toBe(0);
    expect(result.rejection).toBe(1);
  });

  it("falls back to 100% inspection when neither feature rule nor item plan exist", () => {
    const result = resolveFeatureSamplingPlan(null, null, 37, "ANSI_Z1_4");
    expect(result.sampleSize).toBe(37);
    expect(result.acceptance).toBe(0);
    expect(result.rejection).toBe(1);
    expect(result.codeLetter).toBeNull();
  });

  it("clamps a First-N feature rule to the lot size", () => {
    const result = resolveFeatureSamplingPlan(
      { samplingPlanType: "First", samplingSampleSize: 10 },
      null,
      4,
      "ANSI_Z1_4"
    );
    expect(result.sampleSize).toBe(4);
  });
});
