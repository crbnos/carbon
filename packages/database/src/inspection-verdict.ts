// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Pure inspection verdicts shared by the engine (`@carbon/database/quality`) and
 * the dataset seed, so a seeded sample carries exactly the status the engine
 * would derive. No I/O and no kysely, so it loads in any runtime.
 */

import { round } from "./precision.ts";

export type InspectionVerdict = "Pending" | "Passed" | "Failed";

export type MeasurementFeatureSpec = {
  type: string;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
};

export function parseSpecNumber(
  value: string | null | undefined
): number | null {
  if (value == null) return null;
  // A plain decimal, optionally with an exponent: `Number` alone also reads
  // "Infinity" and "0x10".
  const trimmed = value.trim().replace(/^\+/, "");
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return null;
  return Number(trimmed);
}

// Measurement features with a parseable nominal are judged numerically inside
// [nominal - |tol-|, nominal + |tol+|], with the limits rounded to the spec's
// own decimals (toleranceLimits) so the verdict matches the band the grid shows
// (0.8 − 0.1 is 0.7, not 0.7000000000000001). Everything else (attribute
// features, GD&T strings that don't parse) is a pass/fail toggle.
export function valuateMeasurement(
  feature: MeasurementFeatureSpec,
  value: number | null,
  passed?: boolean | null
): InspectionVerdict {
  const nominal =
    feature.type === "Measurement"
      ? parseSpecNumber(feature.nominalValue)
      : null;

  if (feature.type === "Measurement" && nominal !== null) {
    if (value == null) return "Pending";
    const limits = toleranceLimits(feature);
    return limits !== null && value >= limits.lower && value <= limits.upper
      ? "Passed"
      : "Failed";
  }

  if (passed == null) return "Pending";
  return passed ? "Passed" : "Failed";
}

// Sampling is count-based, not positional — a feature's n is the minimum
// number of readings across ANY samples (per-feature gating at disposition
// enforces the counts), so a sample's own verdict is: Failed the moment any of
// its readings fails, Passed once every lot feature has a passing reading on
// it (a fully-inspected unit), otherwise Pending. A lot with no features never
// passes a sample.
export function deriveSampleStatus(
  lotFeatureIds: readonly string[],
  measurements: readonly { inspectionFeatureId: string; status: string }[]
): InspectionVerdict {
  if (measurements.some((m) => m.status === "Failed")) return "Failed";
  const allFeaturesPassed =
    lotFeatureIds.length > 0 &&
    lotFeatureIds.every(
      (id) =>
        measurements.find((m) => m.inspectionFeatureId === id)?.status ===
        "Passed"
    );
  return allFeaturesPassed ? "Passed" : "Pending";
}

// Terminal states (Passed/Failed/Partial) are owned by the disposition path,
// so the per-sample recompute only flips between Pending and In Progress.
export function computeLotStatus(
  samples: readonly { status: string }[]
): "Pending" | "In Progress" {
  return samples.some((s) => s.status !== "Pending")
    ? "In Progress"
    : "Pending";
}

export type ToleranceLimits = {
  nominal: number;
  lower: number;
  upper: number;
  // Decimal places of the most precise of nominal / tol+ / tol-, so a limit
  // prints as the drawing states it (10 ± 0.05 → 9.95, not 9.950000000001).
  decimals: number;
};

// Decimal places a spec number states, in plain or exponent notation:
// "0.05" has 2, "1e-3" has 3, "1.5e-3" has 4.
function decimalPlaces(value: string | null | undefined): number {
  if (value == null) return 0;
  const match = value
    .trim()
    .toLowerCase()
    .match(/^[+-]?\d*(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!match) return 0;
  const fraction = match[1]?.length ?? 0;
  const exponent = match[2] ? Number(match[2]) : 0;
  return Math.max(0, fraction - exponent);
}

// The band a numeric Measurement passes in — the same band valuateMeasurement
// judges. Null when the feature is judged as an attribute.
export function toleranceLimits(
  feature: MeasurementFeatureSpec
): ToleranceLimits | null {
  if (feature.type !== "Measurement") return null;
  const nominal = parseSpecNumber(feature.nominalValue);
  if (nominal === null) return null;
  const tolPlus = Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
  const tolMinus = Math.abs(parseSpecNumber(feature.toleranceMinus) ?? 0);
  const decimals = Math.max(
    decimalPlaces(feature.nominalValue),
    decimalPlaces(feature.tolerancePlus),
    decimalPlaces(feature.toleranceMinus)
  );
  return {
    nominal,
    lower: round(nominal - tolMinus, decimals),
    upper: round(nominal + tolPlus, decimals),
    decimals
  };
}

// Which side of the band a failed reading is on, for the ↑ / ↓ marker.
export function measurementDeviation(
  feature: MeasurementFeatureSpec,
  value: number | null
): "above" | "below" | null {
  if (value == null) return null;
  const limits = toleranceLimits(feature);
  if (!limits) return null;
  if (valuateMeasurement(feature, value) !== "Failed") return null;
  // The band always holds the nominal, so a fail is on the nominal's far side.
  return value > limits.nominal ? "above" : "below";
}
