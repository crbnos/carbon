// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { INSPECTION_DRAWING_HIDDEN_STORAGE_KEY } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InspectionMeasurement,
  Inspection as InspectionRow,
  InspectionSample,
  InspectionSamplingPlan
} from "~/services/types";
import type { MeasurementSaveResult } from "./InspectionMeasurementMatrix";

/** A lot as both MES lot views receive it: the row and its item. */
export type InspectionLot = InspectionRow & {
  item?: {
    readableId: string | null;
    name: string | null;
    type: string | null;
    itemTrackingType: string | null;
  } | null;
};

export type DrawingBalloonRow = {
  id: string;
  inspectionFeatureId: string;
  pageNumber: number;
  xCoordinate: number;
  yCoordinate: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
};

/** A unit in one of these states can no longer be sampled. */
export const UNSAMPLEABLE_ENTITY_STATUSES = [
  "Consumed",
  "Rejected",
  "Scrapped"
] as const;

export function isUnsampleableEntityStatus(status: string | null | undefined) {
  return (UNSAMPLEABLE_ENTITY_STATUSES as readonly string[]).includes(
    status ?? ""
  );
}

export function inspectionStatusVariant(status: InspectionRow["status"]) {
  switch (status) {
    case "Passed":
      return "green" as const;
    case "Failed":
      return "red" as const;
    case "Partial":
      return "yellow" as const;
    default:
      return "secondary" as const;
  }
}

type SampleStatus = "Pending" | "Passed" | "Failed";

/**
 * What both MES lot views (job operation, receipt and manual) derive from a
 * lot: the drawing toggle, the readings mirrored from quiet cell saves, the
 * per-feature counts, the Accept / Reject gating, the drawing's links and the
 * status and plan labels. Each view adds only its own verdict actions.
 */
export function useInspectionLotState<
  TEntity extends { id: string; status?: string | null }
>({
  inspection,
  samples,
  features,
  measurements,
  balloons,
  lotEntities,
  pdfUrl,
  model,
  isLocked
}: {
  inspection: InspectionLot;
  samples: InspectionSample[];
  features: InspectionSamplingPlan[];
  measurements: InspectionMeasurement[];
  balloons: DrawingBalloonRow[];
  // The units the lot may sample.
  lotEntities: TEntity[];
  pdfUrl: string | null;
  model: { modelUploadId: string; modelPath: string | null } | null;
  // The lot is closed (or this operator may not work it): nothing is entered
  // and no verdict is offered.
  isLocked: boolean;
}) {
  const { t } = useLingui();

  const liveFeatures = useMemo(
    () => features.filter((f) => f.inspectionFeature != null),
    [features]
  );
  const hasFeatures = liveFeatures.length > 0;
  const hasDrawing = pdfUrl != null || model != null;

  // "Hide drawing" gives the matrix the whole body (a large batch needs the
  // rows); the choice persists per browser.
  const [drawingHidden, setDrawingHidden] = useState(false);
  useEffect(() => {
    try {
      setDrawingHidden(
        window.localStorage.getItem(INSPECTION_DRAWING_HIDDEN_STORAGE_KEY) ===
          "true"
      );
    } catch {
      // Storage unavailable: keep the drawing shown.
    }
  }, []);
  const toggleDrawing = useCallback(() => {
    setDrawingHidden((hidden) => {
      try {
        window.localStorage.setItem(
          INSPECTION_DRAWING_HIDDEN_STORAGE_KEY,
          String(!hidden)
        );
      } catch {
        // Storage unavailable: the choice lasts for this page only.
      }
      return !hidden;
    });
  }, []);
  const showDrawing = hasDrawing && !drawingHidden;

  // Matrix position -> sample id, kept here so it survives the matrix
  // remount when the drawing is hidden or shown.
  const placementRef = useRef<Record<number, string>>({});
  // A save or bulk run in flight: the verdict waits until every reading has
  // landed, and the drawing toggle waits so no save is cut off.
  const [gridBusy, setGridBusy] = useState(false);
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

  // Per-cell saves are quiet (no revalidation), so measurement and derived
  // sample statuses are mirrored from the save responses and merged with the
  // loader data for gating.
  const [measurementOverrides, setMeasurementOverrides] = useState<
    Record<string, SampleStatus>
  >({});
  const [sampleStatusOverrides, setSampleStatusOverrides] = useState<
    Record<string, SampleStatus>
  >({});
  const [measurementValueOverrides, setMeasurementValueOverrides] = useState<
    Record<string, number | null>
  >({});
  const onMeasurementSaved = useCallback((result: MeasurementSaveResult) => {
    const key = `${result.sampleId}:${result.inspectionFeatureId}`;
    setMeasurementOverrides((prev) => ({
      ...prev,
      [key]: result.measurementStatus
    }));
    setMeasurementValueOverrides((prev) => ({ ...prev, [key]: result.value }));
    setSampleStatusOverrides((prev) => ({
      ...prev,
      [result.sampleId]: result.sampleStatus
    }));
  }, []);

  const effectiveMeasurements = useMemo(() => {
    const byKey = new Map<
      string,
      { featureId: string; status: string; value: number | null }
    >();
    for (const m of measurements) {
      byKey.set(`${m.inspectionSampleId}:${m.inspectionFeatureId}`, {
        featureId: m.inspectionFeatureId,
        status: m.status,
        value: m.value == null ? null : Number(m.value)
      });
    }
    for (const [key, status] of Object.entries(measurementOverrides)) {
      byKey.set(key, {
        featureId: key.split(":")[1] ?? "",
        status,
        value: measurementValueOverrides[key] ?? null
      });
    }
    return byKey;
  }, [measurements, measurementOverrides, measurementValueOverrides]);

  const featureCounts = useMemo(() => {
    const counts = new Map<string, { recorded: number; failed: number }>();
    for (const feature of liveFeatures) {
      counts.set(feature.inspectionFeatureId, { recorded: 0, failed: 0 });
    }
    for (const measurement of effectiveMeasurements.values()) {
      const entry = counts.get(measurement.featureId);
      if (!entry) continue;
      if (measurement.status !== "Pending") entry.recorded += 1;
      if (measurement.status === "Failed") entry.failed += 1;
    }
    return counts;
  }, [liveFeatures, effectiveMeasurements]);

  const sampleStatuses = useMemo(() => {
    const statuses = new Map<string, string>();
    for (const sample of samples) statuses.set(sample.id, sample.status);
    for (const [sampleId, status] of Object.entries(sampleStatusOverrides)) {
      statuses.set(sampleId, status);
    }
    return statuses;
  }, [samples, sampleStatusOverrides]);

  const passes = [...sampleStatuses.values()].filter(
    (s) => s === "Passed"
  ).length;
  const fails = [...sampleStatuses.values()].filter(
    (s) => s === "Failed"
  ).length;
  const inspected = passes + fails;

  // The units with no sample yet. Add Sample is offered only while one of
  // them can still be sampled: an "inspect all" lot starts with every unit
  // sampled (prefillInspectionSamples).
  const remaining = useMemo(() => {
    const sampled = new Set(samples.map((sample) => sample.trackedEntityId));
    return lotEntities.filter((entity) => !sampled.has(entity.id));
  }, [lotEntities, samples]);
  const hasSampleableUnit = remaining.some(
    (entity) => !isUnsampleableEntityStatus(entity.status)
  );

  const maxSampleSize = hasFeatures
    ? Math.max(1, ...liveFeatures.map((f) => f.sampleSize))
    : inspection.sampleSize;

  // Accept gating mirrors dispositionInspection: every characteristic has its
  // n recorded within its acceptance number, or (with no plan) the lot's
  // samples are in within Ac. `failedStatistically` is the engine's
  // isRejectableWithoutReason. Reject is open at any time: an inspector can
  // condemn a lot for reasons no characteristic captures.
  let canAccept: boolean;
  let failedStatistically: boolean;
  if (hasFeatures) {
    canAccept =
      !isLocked &&
      liveFeatures.every((feature) => {
        const counts = featureCounts.get(feature.inspectionFeatureId) ?? {
          recorded: 0,
          failed: 0
        };
        return (
          counts.recorded >= feature.sampleSize &&
          counts.failed <= feature.acceptanceNumber
        );
      });
    failedStatistically =
      liveFeatures.some((feature) => {
        const counts = featureCounts.get(feature.inspectionFeatureId);
        return counts != null && counts.failed >= feature.rejectionNumber;
      }) || fails > 0;
  } else {
    canAccept =
      !isLocked &&
      inspected >= inspection.sampleSize &&
      fails <= inspection.acceptanceNumber;
    failedStatistically = fails > inspection.acceptanceNumber;
  }
  // No verdict while a reading is still saving: the lot would close before
  // it lands.
  if (gridBusy) canAccept = false;
  const canReject = !isLocked && !gridBusy;

  const pmiLinks = useMemo(
    () =>
      liveFeatures.map((f) => ({
        id: f.inspectionFeatureId,
        pmiItemId: f.inspectionFeature!.pmiItemId ?? null
      })),
    [liveFeatures]
  );
  const drawingBalloons = useMemo(() => {
    const labelByFeatureId = new Map(
      liveFeatures.map((f) => [
        f.inspectionFeatureId,
        f.inspectionFeature!.label
      ])
    );
    return balloons
      .filter((b) => labelByFeatureId.has(b.inspectionFeatureId))
      .map((b) => ({
        id: b.id,
        inspectionFeatureId: b.inspectionFeatureId,
        pageNumber: b.pageNumber,
        xCoordinate: b.xCoordinate,
        yCoordinate: b.yCoordinate,
        regionX: b.regionX,
        regionY: b.regionY,
        regionWidth: b.regionWidth,
        regionHeight: b.regionHeight,
        label: labelByFeatureId.get(b.inspectionFeatureId) ?? ""
      }));
  }, [balloons, liveFeatures]);

  const statusLabel: Record<InspectionRow["status"], string> = {
    Pending: t`Pending`,
    "In Progress": t`In Progress`,
    Passed: t`Passed`,
    Failed: t`Failed`,
    Partial: t`Partial`,
    Cancelled: t`Cancelled`
  };
  const severityLabel: Record<
    NonNullable<InspectionRow["severity"]>,
    string
  > = {
    Normal: t`Normal`,
    Tightened: t`Tightened`,
    Reduced: t`Reduced`
  };
  const planTypeLabel: Record<InspectionRow["samplingPlanType"], string> = {
    All: t`All`,
    First: t`First`,
    Percentage: t`Percentage`,
    AQL: t`AQL`
  };
  const aql = inspection.aql ?? "";
  const level = inspection.inspectionLevel ?? "";
  const severity = inspection.severity
    ? severityLabel[inspection.severity]
    : "";
  const planSummary =
    inspection.samplingPlanType === "AQL"
      ? t`AQL ${aql} · Lvl ${level} · ${severity}`
      : planTypeLabel[inspection.samplingPlanType];

  return {
    liveFeatures,
    hasFeatures,
    hasDrawing,
    showDrawing,
    toggleDrawing,
    placementRef,
    gridBusy,
    setGridBusy,
    activeFeatureId,
    setActiveFeatureId,
    onMeasurementSaved,
    effectiveMeasurements,
    featureCounts,
    sampleStatuses,
    passes,
    fails,
    inspected,
    remaining,
    hasSampleableUnit,
    maxSampleSize,
    isLocked,
    canAccept,
    canReject,
    failedStatistically,
    pmiLinks,
    drawingBalloons,
    statusVariant: inspectionStatusVariant(inspection.status),
    statusLabel: statusLabel[inspection.status],
    planSummary
  };
}

export type InspectionLotState = ReturnType<typeof useInspectionLotState>;
