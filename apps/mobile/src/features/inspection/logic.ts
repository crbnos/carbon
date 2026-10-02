// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  InspectionFeaturePlan,
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionScreen
} from "@carbon/mes-core";

/**
 * Every rule the inspection screen decides by, with no React and no
 * `react-native` import — so it is unit-testable, and so the phone and the
 * tablet cannot disagree about whether a lot may be accepted.
 *
 * All of it is a port of `apps/mes/app/components/Inspection/`
 * (`InspectionView.tsx` and `InspectionMeasurementMatrix.tsx`). The LAYOUT
 * above it diverges from the web — see `InspectionView.tsx` in this folder —
 * but the arithmetic does not: the accept/reject gates below mirror the
 * server's own disposition guards, so an operator is never offered a button
 * the server will refuse.
 */

/**
 * The synthetic row a lot with no inspection document gets. Its cells write
 * the SAMPLE's status through the sample endpoint, where a real feature row
 * writes a measurement — the one place the two kinds of cell differ.
 */
export const OVERALL_ROW_ID = "__overall__";

/**
 * A nominal or tolerance as a number, or null when it is not one.
 *
 * The columns are TEXT because a characteristic may be specified "0.250",
 * "1/4" or "FLAT". Anything unparseable makes the characteristic an attribute
 * (pass/fail) rather than a measurement, which is what the server's
 * `valuateMeasurement` also concludes. The leading `+` strip is for a
 * tolerance written "+0.005".
 */
export function parseSpecNumber(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/** The feature's specification as one line: "0.250 +0.005/−0.005 in". */
export function specLabel(
  feature: NonNullable<InspectionFeaturePlan["inspectionFeature"]>
) {
  return [
    feature.nominalValue,
    feature.tolerancePlus != null || feature.toleranceMinus != null
      ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
      : null,
    feature.unit
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The plan rows whose live feature still exists, in the grid's order.
 *
 * A plan row outlives the deletion of its feature from the document, so the
 * null check is not defensive — it is how a deleted characteristic leaves the
 * grid. Page number first, then label with NUMERIC collation, so "Ø2" sorts
 * before "Ø10" rather than after it.
 */
export function liveFeatures(features: InspectionFeaturePlan[]) {
  return features
    .filter((plan) => plan.inspectionFeature != null)
    .sort((a, b) => {
      const fa = a.inspectionFeature!;
      const fb = b.inspectionFeature!;
      return (
        (fa.pageNumber ?? 1) - (fb.pageNumber ?? 1) ||
        (fa.label ?? "").localeCompare(fb.label ?? "", undefined, {
          numeric: true
        })
      );
    });
}

export type Row = {
  featureId: string;
  label: string;
  description: string | null;
  /** A value is typed; otherwise the cell is a Pass/Fail pair. */
  isNumeric: boolean;
  specLabel: string;
  /** The minimum number of readings this characteristic needs. */
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
  gaugeTypeId: string | null;
  /** The lot's recorded gauge for this characteristic, if any. */
  gaugeId: string | null;
};

/**
 * The grid's rows: one per live characteristic, or the single synthetic
 * "Overall result" row when the lot has no document to take characteristics
 * from. `overallLabel` is passed in because this file holds no Lingui import.
 */
export function buildRows(
  features: InspectionFeaturePlan[],
  lot: {
    sampleSize: number;
    acceptanceNumber: number;
    rejectionNumber: number;
  },
  overallLabel: string
): Row[] {
  const live = liveFeatures(features);
  if (live.length === 0) {
    return [
      {
        featureId: OVERALL_ROW_ID,
        label: overallLabel,
        description: null,
        isNumeric: false,
        specLabel: "",
        sampleSize: lot.sampleSize,
        acceptanceNumber: lot.acceptanceNumber,
        rejectionNumber: lot.rejectionNumber,
        gaugeTypeId: null,
        gaugeId: null
      }
    ];
  }
  return live.map((plan) => {
    const feature = plan.inspectionFeature!;
    return {
      featureId: feature.id,
      label: feature.label ?? feature.id,
      description: feature.description ?? null,
      isNumeric:
        feature.type === "Measurement" &&
        parseSpecNumber(feature.nominalValue) != null,
      specLabel: specLabel(feature),
      sampleSize: plan.sampleSize,
      acceptanceNumber: plan.acceptanceNumber,
      rejectionNumber: plan.rejectionNumber,
      gaugeTypeId: feature.gaugeTypeId ?? null,
      gaugeId: plan.gaugeId ?? null
    };
  });
}

/** The largest n any characteristic requires — the lot's own when it has none. */
export function maxSampleSize(
  features: InspectionFeaturePlan[],
  lot: { sampleSize: number }
) {
  const live = liveFeatures(features);
  return live.length > 0
    ? Math.max(1, ...live.map((plan) => plan.sampleSize))
    : lot.sampleSize;
}

/**
 * How many units the grid offers.
 *
 * A serial lot has exactly the columns it has scanned. Any other lot gets the
 * required n plus ONE spare — n is a minimum, not a cap, so recording more
 * readings than the plan asks for is always allowed — capped at the lot size.
 * The spare is how a column is added without an explicit "add" action: its
 * sample row is created server-side by the first reading written into it.
 */
export function columnCount(args: {
  isSerial: boolean;
  sampleCount: number;
  lotSize: number;
  maxSampleSize: number;
}) {
  if (args.isSerial) return args.sampleCount;
  return Math.min(
    args.lotSize,
    Math.max(args.maxSampleSize, args.sampleCount + 1)
  );
}

/** A cell's key. Column INDEX, not sample id: a spare column has no id yet. */
export function cellKey(columnIndex: number, featureId: string) {
  return `${columnIndex}:${featureId}`;
}

export type CellPatch = {
  status: string;
  value: number | null;
};

/**
 * Every reading the screen currently believes in, keyed by
 * `sampleId:featureId` — the server's rows with the local patches applied on
 * top.
 *
 * Patches exist because a per-cell save must not cost a screen reload: the
 * write returns the cell's new status and the screen keeps it, exactly as the
 * web grid does. A patch is keyed by sample id here (not column index) so that
 * it survives the refetch that renumbers nothing but may add columns.
 */
export function effectiveMeasurements(
  measurements: InspectionMeasurement[],
  patches: Record<string, CellPatch>
) {
  const byKey = new Map<string, { featureId: string } & CellPatch>();
  for (const m of measurements) {
    byKey.set(`${m.inspectionSampleId}:${m.inspectionFeatureId}`, {
      featureId: m.inspectionFeatureId,
      status: m.status,
      value: m.value == null ? null : Number(m.value)
    });
  }
  for (const [key, patch] of Object.entries(patches)) {
    byKey.set(key, { featureId: key.split(":")[1] ?? "", ...patch });
  }
  return byKey;
}

/**
 * Readings recorded and failed per characteristic. `Pending` counts as
 * neither — it is a registered unit with no verdict yet.
 */
export function featureCounts(
  features: InspectionFeaturePlan[],
  effective: Map<string, { featureId: string; status: string }>
) {
  const counts = new Map<string, { recorded: number; failed: number }>();
  for (const plan of liveFeatures(features)) {
    counts.set(plan.inspectionFeatureId, { recorded: 0, failed: 0 });
  }
  for (const measurement of effective.values()) {
    const entry = counts.get(measurement.featureId);
    if (!entry) continue;
    if (measurement.status !== "Pending") entry.recorded += 1;
    if (measurement.status === "Failed") entry.failed += 1;
  }
  return counts;
}

/** Each unit's verdict, with local patches applied. */
export function sampleStatuses(
  samples: InspectionSample[],
  patches: Record<string, string>
) {
  const statuses = new Map<string, string>();
  for (const sample of samples) statuses.set(sample.id, sample.status);
  for (const [id, status] of Object.entries(patches)) statuses.set(id, status);
  return statuses;
}

export function statusTally(statuses: Map<string, string>) {
  const values = [...statuses.values()];
  const passes = values.filter((s) => s === "Passed").length;
  const fails = values.filter((s) => s === "Failed").length;
  return { passes, fails, inspected: passes + fails };
}

/**
 * A dispositioned lot is read-only. All three terminal statuses are hard —
 * `Partial` included — so there is no "reopen and carry on".
 */
export function lotClosed(lot: InspectionScreen["inspection"]) {
  return (
    lot.dispositionedAt != null &&
    (lot.status === "Passed" ||
      lot.status === "Failed" ||
      lot.status === "Partial")
  );
}

/**
 * Remaining GOOD work on the operation.
 *
 * Scrap does NOT reduce it: a scrapped unit still has to be replaced, so its
 * replacement is still owed. Rework does, because a reworked unit is being
 * dealt with elsewhere.
 */
export function operationRemaining(operation: InspectionScreen["operation"]) {
  return Math.max(
    0,
    (operation.targetQuantity ?? operation.operationQuantity ?? 0) -
      (operation.quantityComplete ?? 0) -
      (operation.quantityReworked ?? 0)
  );
}

/**
 * Whether Accept and Reject may be offered, mirroring the server's own
 * disposition guards.
 *
 * A lot WITH characteristics gates per characteristic: every one needs its n
 * readings with no more than its acceptance number failed, and any one that
 * has reached its rejection number makes the lot rejectable. A lot WITHOUT
 * them gates at the lot level, on the overall-result pass/fail counts.
 *
 * Getting this wrong in either direction is a real failure: too generous and
 * the operator presses a button the server refuses, too strict and a finished
 * lot cannot be closed from the tablet at all.
 */
export function dispositionGates(args: {
  closed: boolean;
  features: InspectionFeaturePlan[];
  counts: Map<string, { recorded: number; failed: number }>;
  lot: { sampleSize: number; acceptanceNumber: number };
  tally: { fails: number; inspected: number };
}) {
  const live = liveFeatures(args.features);
  if (live.length > 0) {
    const allSatisfied = live.every((plan) => {
      const counts = args.counts.get(plan.inspectionFeatureId) ?? {
        recorded: 0,
        failed: 0
      };
      return (
        counts.recorded >= plan.sampleSize &&
        counts.failed <= plan.acceptanceNumber
      );
    });
    const anyRejectable = live.some((plan) => {
      const counts = args.counts.get(plan.inspectionFeatureId);
      return counts != null && counts.failed >= plan.rejectionNumber;
    });
    return {
      canAccept: !args.closed && allSatisfied,
      canReject: !args.closed && (anyRejectable || args.tally.fails > 0)
    };
  }
  return {
    canAccept:
      !args.closed &&
      args.tally.inspected >= args.lot.sampleSize &&
      args.tally.fails <= args.lot.acceptanceNumber,
    canReject: !args.closed && args.tally.fails > args.lot.acceptanceNumber
  };
}

/**
 * Units that have passed but have not yet been posted as complete — what
 * "Complete passed (n)" offers.
 *
 * A serial lot counts passed samples whose unit is still open at this
 * operation; anything else nets the passed count against what has already
 * been posted, clamped to the operation's remaining quantity.
 */
export function completablePassed(args: {
  isSerial: boolean;
  samples: InspectionSample[];
  statuses: Map<string, string>;
  linkedSampleIds: string[];
  openEntityIds: Set<string>;
  passes: number;
  linkedProductionQuantity: number;
  remaining: number;
}) {
  if (args.isSerial) {
    const linked = new Set(args.linkedSampleIds);
    return args.samples.filter((sample) => {
      if (args.statuses.get(sample.id) !== "Passed") return false;
      if (linked.has(sample.id)) return false;
      return (
        sample.trackedEntityId != null &&
        args.openEntityIds.has(sample.trackedEntityId)
      );
    }).length;
  }
  return Math.min(
    Math.max(0, args.passes - args.linkedProductionQuantity),
    Math.max(0, args.remaining)
  );
}

/**
 * Whether a tracked unit is still open at THIS operation.
 *
 * Two independent reasons it is not: a terminal unit status, or a completion
 * marker this operation already stamped into its attributes. The marker is the
 * literal key `Operation <jobOperationId>` — the same string
 * `getNextIncompleteSerialEntity` writes and reads server-side, so the key
 * format is a contract, not a convention. Without the marker check a unit
 * already completed here would be offered for completion a second time.
 */
export function isEntityOpenAtOperation(
  entity: { status?: string | null; attributes?: unknown },
  operationId: string
) {
  if (
    entity.status === "Consumed" ||
    entity.status === "Rejected" ||
    entity.status === "Scrapped"
  ) {
    return false;
  }
  const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
  return !attributes[`Operation ${operationId}`];
}

/** The ids of every unit still open at this operation. */
export function openEntityIds(
  entities: { id: string; status?: string | null; attributes?: unknown }[],
  operationId: string
) {
  return new Set(
    entities
      .filter((entity) => isEntityOpenAtOperation(entity, operationId))
      .map((entity) => entity.id)
  );
}

/** The failed readings per characteristic, for the reject confirmation. */
export function failureSummary(
  features: InspectionFeaturePlan[],
  effective: Map<
    string,
    { featureId: string; status: string; value: number | null }
  >
) {
  const live = liveFeatures(features);
  if (live.length === 0) return [];
  return live
    .map((plan) => {
      const feature = plan.inspectionFeature!;
      const failed: string[] = [];
      for (const m of effective.values()) {
        if (m.featureId !== feature.id || m.status !== "Failed") continue;
        failed.push(m.value == null ? "F" : String(m.value));
      }
      if (failed.length === 0) return null;
      return {
        label: feature.label ?? feature.id,
        spec: specLabel(feature),
        failedValues: failed
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

/**
 * A gauge whose calibration has lapsed. SHOWN, never blocking — an inspector
 * on the floor may have no other gauge, and refusing the reading would simply
 * stop the line. The warning is the point.
 */
export function isOutOfCalibration(gauge: InspectionGauge) {
  return gauge.gaugeCalibrationStatusWithDueDate === "Out-of-Calibration";
}

/**
 * The gauges offerable for a characteristic, split into the ones recently used
 * at this station and the rest.
 *
 * Only `Active` gauges, and only of the characteristic's required TYPE where it
 * declares one — a characteristic with no type takes any gauge. The recent
 * list keeps the server's order (most recent first); it is not re-sorted,
 * because "the one I just put down" is the whole value of it.
 */
export function gaugeOptions(
  gauges: InspectionGauge[],
  recentGaugeIds: string[],
  gaugeTypeId: string | null
) {
  const eligible = gauges.filter(
    (gauge) =>
      gauge.id &&
      gauge.gaugeStatus === "Active" &&
      (!gaugeTypeId || gauge.gaugeTypeId === gaugeTypeId)
  );
  const byId = new Map(eligible.map((gauge) => [gauge.id, gauge]));
  const recent = recentGaugeIds
    .map((id) => byId.get(id))
    .filter((gauge): gauge is InspectionGauge => gauge != null);
  const recentIds = new Set(recent.map((gauge) => gauge.id));
  return { recent, rest: eligible.filter((gauge) => !recentIds.has(gauge.id)) };
}

/** A gauge as one line: its id, or its description when it has no id. */
export function gaugeLabel(gauge: InspectionGauge | undefined) {
  if (!gauge) return null;
  return gauge.gaugeId ?? gauge.description ?? gauge.id;
}

/**
 * The unit a scanned code names, matched on `readableId` then on the raw id.
 *
 * Case- and space-insensitive on the readable id, because a serial is read off
 * a label by a camera and a laser wedge and the two do not agree about either.
 * Matching the raw id as well is for a Carbon QR code, which carries it.
 */
export function matchUnitByScan<
  T extends { id: string; readableId?: string | null }
>(units: T[], scanned: string) {
  const needle = scanned.trim().toLowerCase();
  if (needle === "") return undefined;
  return units.find(
    (unit) =>
      unit.id.toLowerCase() === needle ||
      (unit.readableId ?? "").trim().toLowerCase() === needle
  );
}

/** The lot's units that have not been sampled yet, in the server's order. */
export function unsampledUnits<T extends { id: string }>(
  units: T[],
  samples: InspectionSample[]
) {
  const sampled = new Set(
    samples
      .map((sample) => sample.trackedEntityId)
      .filter((id): id is string => id != null)
  );
  return units.filter((unit) => !sampled.has(unit.id));
}

/** The units a FAILED sample names — the ones Accept must not complete. */
export function failedEntityIds(
  samples: InspectionSample[],
  statuses: Map<string, string>
) {
  const ids = new Set<string>();
  for (const sample of samples) {
    if (statuses.get(sample.id) === "Failed" && sample.trackedEntityId) {
      ids.add(sample.trackedEntityId);
    }
  }
  return ids;
}

/**
 * How many units Accept will complete.
 *
 * A serial lot counts the units still open at this operation that no failed
 * sample names — NOT the operation's remaining quantity, which can differ once
 * a unit has failed. The number is read immediately before a one-shot,
 * irreversible close, so the two must not be conflated.
 */
export function acceptRemaining(args: {
  isSerial: boolean;
  trackedEntities: {
    id: string;
    status?: string | null;
    attributes?: unknown;
  }[];
  samples: InspectionSample[];
  statuses: Map<string, string>;
  operationId: string;
  remaining: number;
}) {
  if (!args.isSerial) return args.remaining;
  const failed = failedEntityIds(args.samples, args.statuses);
  const open = openEntityIds(args.trackedEntities, args.operationId);
  return [...open].filter((id) => !failed.has(id)).length;
}
