// Pure inspection math shared by tier 07 and the validator, so the seeded
// sample statuses are exactly what the engine would have derived.

import { resolveSamplingPlan, type SamplingResult } from "../../sampling.ts";
import type { InspectionSpec } from "../types.ts";

/** The company default (companySettings.samplingStandard) every seed runs under. */
export const SEED_SAMPLING_STANDARD = "ANSI_Z1_4" as const;

/** The document default rule every seeded inspection plan carries. */
export function inspectionPlan(spec: InspectionSpec) {
  return {
    type: "AQL" as const,
    aql: spec.aql,
    inspectionLevel: "II" as const,
    severity: "Normal" as const
  };
}

/**
 * The lot plan post-receipt snapshots. Every feature inherits the document
 * default, so each feature's plan equals the lot plan.
 */
export function resolveInspectionPlan(
  spec: InspectionSpec,
  lotSize: number
): SamplingResult {
  return resolveSamplingPlan(
    inspectionPlan(spec),
    lotSize,
    SEED_SAMPLING_STANDARD
  );
}

function parseSpecNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * valuateMeasurement (`@carbon/database/quality`) for a numeric Measurement
 * feature: in [nominal − |tol−|, nominal + |tol+|] ⇒ Passed. Duplicated rather
 * than imported — that module pulls in kysely at runtime.
 */
export function valuateReading(
  feature: InspectionSpec["features"][number],
  value: number
): "Passed" | "Failed" {
  const nominal = parseSpecNumber(feature.nominalValue) ?? 0;
  const plus = Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
  const minus = Math.abs(parseSpecNumber(feature.toleranceMinus) ?? 0);
  return value >= nominal - minus && value <= nominal + plus
    ? "Passed"
    : "Failed";
}

/**
 * upsertInspectionMeasurement's derivation: any failed reading ⇒ Failed;
 * every feature read and passed ⇒ Passed; otherwise Pending.
 */
export function deriveSampleStatus(
  spec: InspectionSpec,
  sample: InspectionSpec["samples"][number]
): "Pending" | "Passed" | "Failed" {
  const statuses = new Map<string, "Passed" | "Failed">();
  for (const reading of sample.measurements) {
    const feature = spec.features.find((f) => f.label === reading.feature);
    if (feature)
      statuses.set(feature.label, valuateReading(feature, reading.value));
  }
  if ([...statuses.values()].includes("Failed")) return "Failed";
  return spec.features.every((f) => statuses.get(f.label) === "Passed")
    ? "Passed"
    : "Pending";
}
