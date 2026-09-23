// Pure inspection math shared by tier 07 and the validator, so the seeded
// sample statuses are exactly what the engine would have derived.

import {
  deriveSampleStatus as deriveVerdict,
  type InspectionVerdict,
  valuateMeasurement
} from "../../../supabase/functions/shared/inspection-verdict.ts";
import { resolveSamplingPlan, type SamplingResult } from "../../sampling.ts";
import type { InspectionFeatureSpec, InspectionSampleSpec } from "../types.ts";

/** The company default (companySettings.samplingStandard) every seed runs under. */
export const SEED_SAMPLING_STANDARD = "ANSI_Z1_4" as const;

/** The document default rule every seeded inspection plan carries. */
export function inspectionPlan(spec: { aql: number }) {
  return {
    type: "AQL" as const,
    aql: spec.aql,
    inspectionLevel: "II" as const,
    severity: "Normal" as const
  };
}

/**
 * The lot plan post-receipt / getOrCreateJobOperationInspection snapshot. Every
 * feature inherits the document default, so each feature's plan equals it.
 */
export function resolveInspectionPlan(
  spec: { aql: number },
  lotSize: number
): SamplingResult {
  return resolveSamplingPlan(
    inspectionPlan(spec),
    lotSize,
    SEED_SAMPLING_STANDARD
  );
}

/** Tier 07 writes every feature as a numeric Measurement. */
export function valuateReading(
  feature: InspectionFeatureSpec,
  value: number
): InspectionVerdict {
  return valuateMeasurement({ type: "Measurement", ...feature }, value);
}

/** upsertInspectionMeasurement's derivation over the sample's readings. */
export function deriveSampleStatus(
  features: InspectionFeatureSpec[],
  sample: InspectionSampleSpec
): InspectionVerdict {
  return deriveVerdict(
    features.map((f) => f.label),
    sample.measurements.flatMap((reading) => {
      const feature = features.find((f) => f.label === reading.feature);
      return feature
        ? [
            {
              inspectionFeatureId: feature.label,
              status: valuateReading(feature, reading.value)
            }
          ]
        : [];
    })
  );
}
