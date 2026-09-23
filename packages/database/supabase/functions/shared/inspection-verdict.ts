/**
 * Pure inspection verdicts: one reading against its feature spec, a sample's
 * status from its readings, and an open lot's status from its samples.
 *
 * The inspection engine (`@carbon/database/quality`) and the dataset seed both
 * use this copy, so a seeded sample carries exactly the status the engine
 * would derive. No I/O and no kysely, so it loads in any runtime.
 */

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
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

// Measurement features with a parseable nominal are judged numerically inside
// [nominal - |tol-|, nominal + |tol+|]; everything else (attribute features,
// GD&T strings that don't parse) is a pass/fail toggle.
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
    const tolPlus = Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
    const tolMinus = Math.abs(parseSpecNumber(feature.toleranceMinus) ?? 0);
    return value >= nominal - tolMinus && value <= nominal + tolPlus
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
  return samples.some((s) => s.status !== "Pending") ? "In Progress" : "Pending";
}
