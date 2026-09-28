/**
 * Pure inspection verdicts shared by the engine (`@carbon/database/quality`) and
 * the dataset seed, so a seeded sample carries exactly the status the engine
 * would derive. No I/O and no kysely, so it loads in any runtime.
 */

import { EPSILON, round } from "./precision.ts";

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

export type MaterialCondition = "RFS" | "MMC" | "LMC";
export type FeatureOfSize = "Internal" | "External";

export type GeometricFeatureSpec = MeasurementFeatureSpec & {
  materialCondition: MaterialCondition | null;
  featureOfSize: FeatureOfSize | null;
};

export type SizeReading = {
  spec: MeasurementFeatureSpec;
  value: number | null;
  status: string;
};

export type GeometricValuation = {
  status: InspectionVerdict;
  bonus: number | null;
  allowable: number | null;
};

// Bonus tolerance (ASME Y14.5): a geometric tolerance stated at MMC (or LMC)
// grows by how far the related feature of size departs from that condition,
// capped at the size's own tolerance band. RFS, attribute features and
// unparseable nominals fall back to `valuateMeasurement` with no bonus. A
// missing size reading, or a feature with no declared feature of size, earns
// no bonus (the stated tolerance still applies); a
// FAILED size reading fails the geometric feature outright — a bonus cannot be
// derived from an out-of-spec size.
// `passed` is forwarded to the fallback so an attribute or unparseable-nominal
// feature that happens to carry a material condition still records its toggle.
export function valuateGeometricMeasurement(
  feature: GeometricFeatureSpec,
  value: number | null,
  size: SizeReading | null,
  passed?: boolean | null
): GeometricValuation {
  const condition = feature.materialCondition;
  const nominal =
    feature.type === "Measurement"
      ? parseSpecNumber(feature.nominalValue)
      : null;

  if (
    condition == null ||
    condition === "RFS" ||
    feature.type !== "Measurement" ||
    nominal === null
  ) {
    return {
      status: valuateMeasurement(feature, value, passed),
      bonus: null,
      allowable: null
    };
  }

  const tolPlus = Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
  const tolMinus = Math.abs(parseSpecNumber(feature.toleranceMinus) ?? 0);
  const stated = nominal + tolPlus;

  if (value == null) {
    return { status: "Pending", bonus: null, allowable: round(stated) };
  }

  // A feature of size that is out of tolerance fails the geometric feature
  // outright, whether its reading was a value or a pass/fail call.
  if (size?.status === "Failed") {
    return { status: "Failed", bonus: 0, allowable: round(stated) };
  }

  let bonus = 0;
  const sizeNominal =
    size && size.value != null ? parseSpecNumber(size.spec.nominalValue) : null;

  // Without a declared feature of size there is no way to tell which limit
  // is the MMC, so no bonus is earned — the stated tolerance applies. Guessing
  // Internal would grant a bonus of the wrong sign on a pin or boss.
  if (
    feature.featureOfSize != null &&
    size &&
    size.value != null &&
    sizeNominal !== null
  ) {
    const lower =
      sizeNominal - Math.abs(parseSpecNumber(size.spec.toleranceMinus) ?? 0);
    const upper =
      sizeNominal + Math.abs(parseSpecNumber(size.spec.tolerancePlus) ?? 0);
    const internal = feature.featureOfSize === "Internal";
    const raw =
      condition === "MMC"
        ? internal
          ? size.value - lower
          : upper - size.value
        : internal
          ? upper - size.value
          : size.value - lower;
    bonus = Math.min(Math.max(raw, 0), upper - lower);
  }

  const allowable = stated + bonus;
  const withinAllowable =
    value >= nominal - tolMinus - EPSILON && value <= allowable + EPSILON;

  return {
    status: withinAllowable ? "Passed" : "Failed",
    bonus: round(bonus),
    allowable: round(allowable)
  };
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
