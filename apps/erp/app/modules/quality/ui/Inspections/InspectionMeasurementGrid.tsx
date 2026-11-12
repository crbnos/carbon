// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeasurementFeatureSpec } from "@carbon/database/inspection-verdict";
import {
  measurementDeviation,
  parseSpecNumber,
  toleranceLimits,
  valuateMeasurement
} from "@carbon/database/inspection-verdict";
import type {
  InspectionParameter,
  InspectionPlanTab,
  JSONContent
} from "@carbon/react";
import {
  Badge,
  cn,
  IconButton,
  InspectionPlanInstructions,
  InspectionPlanParameters,
  InspectionPlanTabs,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TruncatedTooltipText,
  toast
} from "@carbon/react";
import type { InspectionGridLayout } from "@carbon/utils";
import {
  compareSamplesByCreation,
  defaultInspectionGridLayout,
  formatReading,
  formatSpecLabel,
  formatToleranceLimits,
  INPUT_FORMAT,
  INSPECTION_GRID_LAYOUT_STORAGE_KEY,
  isInspectionGridLayout,
  isMultiCellPaste,
  parseAttributeToken,
  parseClipboardGrid,
  parseMeasurementToken,
  passAllTargets,
  placeSamples,
  planPaste
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuCheckCheck,
  LuRows3,
  LuTableProperties,
  LuX
} from "react-icons/lu";
import { Table } from "~/components";
import type { EditableTableCellComponentProps } from "~/components/Editable";
import { EditableNumber } from "~/components/Editable";
import type {
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan
} from "~/modules/quality/types";
import { path } from "~/utils/path";
import InspectionGaugePicker from "./InspectionGaugePicker";

export type { InspectionParameter };

// A cell save's response payload (the measurement action returns it so the
// grid can update without a revalidation roundtrip).
export type MeasurementSaveResult = {
  sampleId: string;
  measurementId: string;
  measurementStatus: "Pending" | "Passed" | "Failed";
  sampleStatus: "Pending" | "Passed" | "Failed";
  inspectionFeatureId: string;
  columnIndex: number;
  value: number | null;
  passed: boolean | null;
};

type Verdict = "Pending" | "Passed" | "Failed";

// One characteristic of the lot: a feature of the inspection document, or the
// synthetic "Overall result" of a lot with no document.
type Characteristic = {
  featureId: string;
  label: string;
  description: string | null;
  isNumeric: boolean;
  spec: MeasurementFeatureSpec | null;
  // "9.90 – 10.10 mm" for a numeric characteristic, else null.
  limitsLabel: string | null;
  // The plan's own notation ("10 +0.1/−0.1 mm", or an attribute's text).
  specLabel: string;
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
  gaugeTypeId: string | null;
  gaugeTypeName: string | null;
};

// By characteristic a row is one characteristic (`characteristicIndex`); by
// part a row is one sample (`sampleIndex`). The other index is -1.
type GridRow = {
  rowKey: string;
  characteristicIndex: number;
  sampleIndex: number;
} & Record<string, unknown>;

type CellPayload = { value?: string; passed?: "true" | "false" };

type InspectionMeasurementGridProps = {
  inspectionId: string;
  isReadOnly: boolean;
  isSerial: boolean;
  features: InspectionSamplingPlan[];
  samples: InspectionSample[];
  measurements: InspectionMeasurement[];
  gauges: InspectionGauge[];
  recentGaugeIds: string[];
  maxSampleSize: number;
  // Lot size caps how many samples can exist — a feature's n is the required
  // minimum, but the inspector may record up to the whole lot.
  lotSize: number;
  // Lot-level acceptance/rejection numbers, used only for the synthetic
  // "Overall result" row shown when the lot has no inspection-document features.
  lotAcceptanceNumber: number;
  lotRejectionNumber: number;
  activeFeatureId: string | null;
  onActiveFeatureChange: (id: string | null) => void;
  onMeasurementSaved: (result: MeasurementSaveResult) => void;
  primaryAction?: React.ReactNode;
  // The plan's parameters (setup to read before measuring), on a Parameters
  // tab beside the characteristics. Passed only when the lot has a plan, so
  // the tab is always there to find, empty or not.
  parameters?: InspectionParameter[];
  // The plan's work instructions, on an Instructions tab. Passed with
  // `parameters`, only when the lot has a plan.
  workInstruction?: JSONContent | null;
  // Grid position -> sample id, owned by the view so it survives a remount
  // (Hide / Show drawing). A save still running in the old grid writes here,
  // so the new grid's next save reuses that sample instead of making another.
  placementRef?: React.MutableRefObject<Record<number, string>>;
  // True while any save or bulk run is in flight.
  onBusyChange?: (busy: boolean) => void;
};

const sampleKey = (sampleIndex: number) => `sample-${sampleIndex}`;
const featureKey = (characteristicIndex: number) =>
  `feature-${characteristicIndex}`;
// The position of a sample the grid shows but no save has made yet.
const newSampleKey = (sampleIndex: number) => `new-${sampleIndex}`;

// Mirrors RECENT_INSPECTION_GAUGE_LIMIT in packages/database/src/quality.ts
// (the server's "recently used" cap) — that module is server-only (Kysely), so
// it cannot be imported into this client component.
const RECENT_INSPECTION_GAUGE_LIMIT = 10;

// Synthetic feature id for the single pass/fail row shown when the lot has no
// inspection document. Its cells write the sample's status directly (via the
// sample route) rather than a per-feature measurement.
const OVERALL_ROW_ID = "__overall__";

// Only a failure is coloured: a passing reading is ordinary data, so the few
// out-of-tolerance cells are what the eye finds in a large batch.
function verdictFill(status: string | undefined) {
  return status === "Failed"
    ? "bg-red-50 font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300"
    : undefined;
}

// The same fill for a display cell, painted over the whole table cell (it is
// `relative`) whatever the row's height. The cell's text sits in a `relative`
// child so it stays above the fill.
function verdictCellFill(status: string | undefined) {
  return status === "Failed"
    ? "font-medium text-red-700 dark:text-red-300 before:pointer-events-none before:absolute before:inset-0 before:bg-red-50 dark:before:bg-red-950/50"
    : undefined;
}

// The cell of a deleted serial part: no entry marker, so keyboard entry skips it.
function FreedCell() {
  return (
    <span className="-mx-4 -my-2 flex h-11 items-center justify-center bg-muted/40 text-sm text-muted-foreground/50">
      —
    </span>
  );
}

// Features × samples measurement grid (1factory "Spreadsheet View"), with a
// transposed "by part" layout for large batches. Built on the shared Table's
// inline-editing machinery — the same pattern as InventoryCountGroups.
// Spec: .ai/specs/2026-11-05-inspection-entry-ergonomics.md.
const InspectionMeasurementGrid = ({
  inspectionId,
  isReadOnly,
  isSerial,
  features,
  samples: unorderedSamples,
  measurements,
  gauges,
  recentGaugeIds,
  maxSampleSize,
  lotSize,
  lotAcceptanceNumber,
  lotRejectionNumber,
  activeFeatureId,
  onActiveFeatureChange,
  onMeasurementSaved,
  primaryAction,
  parameters,
  workInstruction,
  placementRef,
  onBusyChange
}: InspectionMeasurementGridProps) => {
  const { t } = useLingui();

  // Grid ignores plan rows whose live feature was deleted from the document.
  const liveFeatures = useMemo(
    () =>
      features
        .filter((f) => f.inspectionFeature != null)
        .sort((a, b) => {
          const fa = a.inspectionFeature!;
          const fb = b.inspectionFeature!;
          return (
            (fa.pageNumber ?? 1) - (fb.pageNumber ?? 1) ||
            fa.label.localeCompare(fb.label, undefined, { numeric: true })
          );
        }),
    [features]
  );

  // Lots without an inspection document have no features to measure, so
  // the grid collapses to a single "Overall result" pass/fail characteristic.
  const hasFeatures = liveFeatures.length > 0;

  const characteristics = useMemo<Characteristic[]>(() => {
    if (!hasFeatures) {
      return [
        {
          featureId: OVERALL_ROW_ID,
          label: "1",
          description: t`Overall result`,
          isNumeric: false,
          spec: null,
          limitsLabel: null,
          specLabel: "",
          sampleSize: maxSampleSize,
          acceptanceNumber: lotAcceptanceNumber,
          rejectionNumber: lotRejectionNumber,
          gaugeTypeId: null,
          gaugeTypeName: null
        }
      ];
    }
    return liveFeatures.map((lotFeature) => {
      const feature = lotFeature.inspectionFeature!;
      const spec: MeasurementFeatureSpec = {
        type: feature.type,
        nominalValue: feature.nominalValue,
        tolerancePlus: feature.tolerancePlus,
        toleranceMinus: feature.toleranceMinus
      };
      const isNumeric =
        feature.type === "Measurement" &&
        parseSpecNumber(feature.nominalValue) !== null;
      const limits = isNumeric ? toleranceLimits(spec) : null;
      return {
        featureId: feature.id,
        label: feature.label,
        description: feature.description,
        isNumeric,
        spec,
        limitsLabel: limits
          ? formatToleranceLimits(limits, feature.unit)
          : null,
        specLabel: isNumeric
          ? formatSpecLabel(feature)
          : (feature.nominalValue ?? ""),
        sampleSize: lotFeature.sampleSize,
        acceptanceNumber: lotFeature.acceptanceNumber,
        rejectionNumber: lotFeature.rejectionNumber,
        gaugeTypeId: feature.gaugeTypeId ?? null,
        gaugeTypeName: feature.gaugeType?.name ?? null
      };
    });
  }, [
    hasFeatures,
    liveFeatures,
    maxSampleSize,
    lotAcceptanceNumber,
    lotRejectionNumber,
    t
  ]);

  // Samples in the order they were made: the loader's embed has none.
  const samples = useMemo(
    () => [...unorderedSamples].sort(compareSamplesByCreation),
    [unorderedSamples]
  );
  const sampleById = useMemo(
    () => new Map(samples.map((sample) => [sample.id, sample])),
    [samples]
  );

  // Grid position (column by characteristic, row by part) -> sample id. A
  // sample keeps its position across reloads (`placeSamples`); a position no
  // save has used yet has no sample. The ref is the same map, read by queued
  // saves that run after a render.
  const ownPlacementRef = useRef<Record<number, string>>({});
  const sampleIdRef = placementRef ?? ownPlacementRef;
  const [sampleIdByColumn, setSampleIdByColumn] = useState<
    Record<number, string>
  >(() => {
    const placed = placeSamples(
      sampleIdRef.current,
      samples.map((sample) => sample.id),
      { dropMissing: isSerial }
    );
    sampleIdRef.current = placed;
    return placed;
  });
  useEffect(() => {
    setSampleIdByColumn((prev) => {
      const next = placeSamples(
        prev,
        samples.map((sample) => sample.id),
        { dropMissing: isSerial }
      );
      sampleIdRef.current = next;
      return next;
    });
  }, [samples, sampleIdRef, isSerial]);
  const sampleAt = useCallback(
    (sampleIndex: number) => {
      const id = sampleIdByColumn[sampleIndex];
      return id ? sampleById.get(id) : undefined;
    },
    [sampleIdByColumn, sampleById]
  );
  // Cell state is keyed by sample, so it follows the sample, not the position.
  const positionKey = useCallback(
    (sampleIndex: number) =>
      sampleIdByColumn[sampleIndex] ?? newSampleKey(sampleIndex),
    [sampleIdByColumn]
  );
  // A serial position whose part was deleted: shown, but takes no entry.
  const isFreedPosition = useCallback(
    (sampleIndex: number) => isSerial && !sampleIdByColumn[sampleIndex],
    [isSerial, sampleIdByColumn]
  );

  const knownSampleCount = Math.max(
    samples.length,
    ...Object.keys(sampleIdByColumn).map((index) => Number(index) + 1)
  );

  // Serial lots get one sample per scanned entity; non-serial lots show up to
  // the max required n plus one spare, growing as samples are used, capped at
  // the lot size. n is a minimum — recording MORE is always allowed.
  const columnCount = isSerial
    ? knownSampleCount
    : Math.min(
        lotSize,
        Math.max(maxSampleSize, knownSampleCount + (isReadOnly ? 0 : 1))
      );

  // The inspector's choice persists per browser; until they choose, the
  // default is decided once, on the first non-empty grid, so scanning samples
  // never flips the layout mid-entry.
  const [layoutChoice, setLayoutChoice] = useState<InspectionGridLayout | null>(
    null
  );
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        INSPECTION_GRID_LAYOUT_STORAGE_KEY
      );
      if (isInspectionGridLayout(stored)) setLayoutChoice(stored);
    } catch {
      // Storage unavailable (private window): keep the default.
    }
  }, []);
  const [autoLayout, setAutoLayout] = useState<InspectionGridLayout | null>(
    null
  );
  const computedLayout = defaultInspectionGridLayout({
    sampleCount: columnCount,
    characteristicCount: characteristics.length
  });
  useEffect(() => {
    if (autoLayout !== null || columnCount === 0) return;
    setAutoLayout(computedLayout);
  }, [autoLayout, columnCount, computedLayout]);
  // A serial lot with no scanned sample has no part rows to show.
  const layout: InspectionGridLayout =
    columnCount === 0
      ? "byCharacteristic"
      : (layoutChoice ?? autoLayout ?? computedLayout);
  const onLayoutChange = useCallback((value: string) => {
    if (!isInspectionGridLayout(value)) return;
    setLayoutChoice(value);
    try {
      window.localStorage.setItem(INSPECTION_GRID_LAYOUT_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, []);

  // Server status + value per cell, patched by save responses: per-cell saves
  // are quiet (no revalidation), so the loader data lags behind them.
  const [statusByCell, setStatusByCell] = useState<Record<string, string>>({});
  const [valueByCell, setValueByCell] = useState<Record<string, number | null>>(
    {}
  );
  // The client verdict of a cell whose save is in flight: shown at once,
  // replaced by the server's when it answers.
  const [optimisticByCell, setOptimisticByCell] = useState<
    Record<string, Verdict>
  >({});
  const [sampleStatusById, setSampleStatusById] = useState<
    Record<string, string>
  >({});

  // First measurement per sample and feature.
  const measurementIndex = useMemo(() => {
    const index = new Map<string, InspectionMeasurement>();
    for (const measurement of measurements) {
      const key = `${measurement.inspectionSampleId}:${measurement.inspectionFeatureId}`;
      if (!index.has(key)) index.set(key, measurement);
    }
    return index;
  }, [measurements]);
  const measurementFor = useCallback(
    (sampleId: string | undefined, featureId: string) =>
      sampleId ? measurementIndex.get(`${sampleId}:${featureId}`) : undefined,
    [measurementIndex]
  );

  const cellStatus = useCallback(
    (sampleIndex: number, featureId: string): string | undefined => {
      const key = `${positionKey(sampleIndex)}:${featureId}`;
      const optimistic = optimisticByCell[key];
      if (optimistic) return optimistic;
      const saved = statusByCell[key];
      if (saved) return saved;
      // The "Overall result" row has no measurement — its verdict is the
      // sample's own status (Pending shows as an untoggled cell).
      if (featureId === OVERALL_ROW_ID) {
        return sampleAt(sampleIndex)?.status;
      }
      return measurementFor(sampleIdByColumn[sampleIndex], featureId)?.status;
    },
    [
      optimisticByCell,
      statusByCell,
      sampleIdByColumn,
      measurementFor,
      positionKey,
      sampleAt
    ]
  );
  // The latest cellStatus, for a bulk run that checks each cell as it goes.
  const cellStatusRef = useRef(cellStatus);
  cellStatusRef.current = cellStatus;

  const cellValue = useCallback(
    (sampleIndex: number, featureId: string): number | null => {
      const key = `${positionKey(sampleIndex)}:${featureId}`;
      if (key in valueByCell) return valueByCell[key] ?? null;
      const measurement = measurementFor(
        sampleIdByColumn[sampleIndex],
        featureId
      );
      return measurement?.value == null ? null : Number(measurement.value);
    },
    [valueByCell, sampleIdByColumn, measurementFor, positionKey]
  );

  const sampleStatus = useCallback(
    (sampleIndex: number) => {
      const id = sampleIdByColumn[sampleIndex];
      return id
        ? (sampleStatusById[id] ?? sampleById.get(id)?.status)
        : undefined;
    },
    [sampleIdByColumn, sampleStatusById, sampleById]
  );

  // Document-driven cell: record a per-feature measurement.
  const persistMeasurement = useCallback(
    async (
      characteristic: Characteristic,
      sampleIndex: number,
      payload: CellPayload
    ): Promise<MeasurementSaveResult | null> => {
      const formData = new FormData();
      formData.set("inspectionId", inspectionId);
      const sampleId = sampleIdRef.current[sampleIndex];
      if (sampleId) formData.set("sampleId", sampleId);
      formData.set("inspectionFeatureId", characteristic.featureId);
      if (payload.value !== undefined) formData.set("value", payload.value);
      if (payload.passed !== undefined) formData.set("passed", payload.passed);

      const response = await fetch(
        path.to.inspectionMeasurement(inspectionId),
        { method: "post", body: formData }
      ).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        data?: {
          sampleId: string;
          measurementId: string;
          measurementStatus: string;
          sampleStatus: string;
        } | null;
        error?: { message: string } | null;
      } | null;

      if (!response?.ok || !body?.data || body.error) {
        toast.error(body?.error?.message ?? t`Failed to save measurement`);
        return null;
      }

      return {
        sampleId: body.data.sampleId,
        measurementId: body.data.measurementId,
        measurementStatus: body.data.measurementStatus as Verdict,
        sampleStatus: body.data.sampleStatus as Verdict,
        inspectionFeatureId: characteristic.featureId,
        columnIndex: sampleIndex,
        value:
          payload.value !== undefined && payload.value !== ""
            ? Number(payload.value)
            : null,
        passed: payload.passed !== undefined ? payload.passed === "true" : null
      };
    },
    [inspectionId, sampleIdRef, t]
  );

  // No-document cell: set the sample's Pass/Fail status directly. Serial
  // samples already carry a scanned tracked entity (upsert by it); anonymous
  // samples update in place by sampleId once one exists.
  const persistOverall = useCallback(
    async (
      sampleIndex: number,
      payload: CellPayload
    ): Promise<MeasurementSaveResult | null> => {
      const status = payload.passed === "true" ? "Passed" : "Failed";
      const formData = new FormData();
      formData.set("inspectionId", inspectionId);
      formData.set("status", status);
      formData.set("quiet", "true");
      const sampleId = sampleIdRef.current[sampleIndex];
      if (sampleId) formData.set("sampleId", sampleId);
      const trackedEntityId = sampleId
        ? sampleById.get(sampleId)?.trackedEntityId
        : undefined;
      if (trackedEntityId) formData.set("trackedEntityId", trackedEntityId);

      const response = await fetch(
        `${path.to.inspection(inspectionId)}/sample`,
        { method: "post", body: formData }
      ).catch(() => null);
      const body = (await response?.json().catch(() => null)) as {
        sampleId?: string;
        error?: { message: string } | null;
      } | null;

      if (!response?.ok || !body?.sampleId || body.error) {
        toast.error(body?.error?.message ?? t`Failed to save result`);
        return null;
      }

      return {
        sampleId: body.sampleId,
        measurementId: "",
        measurementStatus: status,
        sampleStatus: status,
        inspectionFeatureId: OVERALL_ROW_ID,
        columnIndex: sampleIndex,
        value: null,
        passed: status === "Passed"
      };
    },
    [inspectionId, sampleById, sampleIdRef, t]
  );

  // Saves of one sample run one at a time: the first save of an anonymous
  // sample creates it, and the next must reuse its id, not make a second one.
  const sampleQueue = useRef<Record<number, Promise<unknown>>>({});
  // Per cell (position and feature): the latest request's token, and how many
  // of its saves are in flight. Only the latest request clears the cell's
  // optimistic state; a reload never overwrites a cell with a save in flight.
  const requestSeq = useRef(0);
  const latestRequestByCell = useRef<Record<string, number>>({});
  const inFlightByCell = useRef<Record<string, number>>({});
  const [inFlightCount, setInFlightCount] = useState(0);
  // The last value the server accepted per cell, restored when a save fails.
  const acceptedValueByCell = useRef<Record<string, number | null>>({});

  const persistCell = useCallback(
    (
      characteristic: Characteristic,
      sampleIndex: number,
      payload: CellPayload
    ): Promise<MeasurementSaveResult | null> => {
      // A serial position whose sample was deleted takes no reading: the
      // save would make an anonymous sample on a lot of scanned parts.
      if (isSerial && !sampleIdRef.current[sampleIndex]) {
        toast.error(t`This sample was removed`);
        return Promise.resolve(null);
      }
      const featureId = characteristic.featureId;
      const cellId = `${sampleIndex}:${featureId}`;
      // The cell's state key now: the anonymous key until the sample exists.
      const keyNow = () =>
        `${sampleIdRef.current[sampleIndex] ?? newSampleKey(sampleIndex)}:${featureId}`;
      const key = keyNow();
      const token = ++requestSeq.current;
      latestRequestByCell.current[cellId] = token;
      inFlightByCell.current[cellId] =
        (inFlightByCell.current[cellId] ?? 0) + 1;
      setInFlightCount((n) => n + 1);

      const numericValue =
        payload.value !== undefined && payload.value !== ""
          ? Number(payload.value)
          : null;
      const optimistic: Verdict =
        payload.passed !== undefined
          ? payload.passed === "true"
            ? "Passed"
            : "Failed"
          : characteristic.spec
            ? valuateMeasurement(characteristic.spec, numericValue)
            : "Pending";
      setOptimisticByCell((prev) => ({ ...prev, [key]: optimistic }));
      if (payload.value !== undefined) {
        setValueByCell((prev) => ({ ...prev, [key]: numericValue }));
      }

      const run = async () => {
        try {
          const result =
            characteristic.featureId === OVERALL_ROW_ID
              ? await persistOverall(sampleIndex, payload)
              : await persistMeasurement(characteristic, sampleIndex, payload);
          const isLatest = latestRequestByCell.current[cellId] === token;

          if (!result) {
            if (isLatest) {
              const current = keyNow();
              setOptimisticByCell((prev) => {
                const next = { ...prev };
                delete next[current];
                return next;
              });
              setValueByCell((prev) => {
                const next = { ...prev };
                delete next[current];
                if (current in acceptedValueByCell.current) {
                  next[current] = acceptedValueByCell.current[current] ?? null;
                }
                return next;
              });
            }
            return null;
          }

          // From here the cell is keyed by the sample the server saved it on.
          // The first save of a new sample moves every pending entry of that
          // position (other characteristics saved meanwhile) to the sample id.
          const savedKey = `${result.sampleId}:${featureId}`;
          const anonymousPrefix = `${newSampleKey(sampleIndex)}:`;
          const adopt = <T,>(prev: Record<string, T>) => {
            let changed = false;
            const next = { ...prev };
            for (const entry of Object.keys(prev)) {
              if (!entry.startsWith(anonymousPrefix)) continue;
              next[
                `${result.sampleId}:${entry.slice(anonymousPrefix.length)}`
              ] = prev[entry]!;
              delete next[entry];
              changed = true;
            }
            return changed ? next : prev;
          };
          setOptimisticByCell((prev) => {
            const next = adopt(prev);
            if (!isLatest) return next;
            const cleared = { ...next };
            delete cleared[savedKey];
            return cleared;
          });
          if (payload.value !== undefined) {
            acceptedValueByCell.current[savedKey] = numericValue;
          }
          setValueByCell((prev) => {
            const next = adopt(prev);
            // A newer edit of this cell keeps its own typed value.
            if (!isLatest || payload.value === undefined) return next;
            return { ...next, [savedKey]: numericValue };
          });

          // A realtime reload may already have placed this sample at another
          // position: it keeps only the position it was saved at.
          const keepOnePosition = (prev: Record<number, string>) => {
            if (prev[sampleIndex] === result.sampleId) {
              const elsewhere = Object.entries(prev).some(
                ([position, id]) =>
                  id === result.sampleId && Number(position) !== sampleIndex
              );
              if (!elsewhere) return prev;
            }
            const next: Record<number, string> = {};
            for (const [position, id] of Object.entries(prev)) {
              if (id !== result.sampleId) next[Number(position)] = id;
            }
            next[sampleIndex] = result.sampleId;
            return next;
          };
          sampleIdRef.current = keepOnePosition(sampleIdRef.current);
          setSampleIdByColumn(keepOnePosition);
          setStatusByCell((prev) => ({
            ...prev,
            [savedKey]: result.measurementStatus
          }));
          setSampleStatusById((prev) => ({
            ...prev,
            [result.sampleId]: result.sampleStatus
          }));
          onMeasurementSaved(result);
          return result;
        } finally {
          inFlightByCell.current[cellId] =
            (inFlightByCell.current[cellId] ?? 1) - 1;
          setInFlightCount((n) => n - 1);
        }
      };

      const queued = (sampleQueue.current[sampleIndex] ?? Promise.resolve())
        .catch(() => undefined)
        .then(run);
      sampleQueue.current[sampleIndex] = queued;
      return queued;
    },
    [
      isSerial,
      persistMeasurement,
      persistOverall,
      onMeasurementSaved,
      sampleIdRef,
      t
    ]
  );

  // A reload is the record: once the loader holds a cell's reading (another
  // inspector's edit included), drop the local copy, unless that cell still
  // has a save in flight.
  useEffect(() => {
    const positionOf = (sampleId: string) => {
      for (const [position, id] of Object.entries(sampleIdRef.current)) {
        if (id === sampleId) return position;
      }
      return undefined;
    };
    const settled = (entry: string) => {
      if (!measurementIndex.has(entry)) return false;
      const separator = entry.indexOf(":");
      const position = positionOf(entry.slice(0, separator));
      const cellId = `${position}:${entry.slice(separator + 1)}`;
      return (inFlightByCell.current[cellId] ?? 0) === 0;
    };
    const prune = <T,>(prev: Record<string, T>) => {
      const stale = Object.keys(prev).filter(settled);
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const entry of stale) {
        delete next[entry];
        delete acceptedValueByCell.current[entry];
      }
      return next;
    };
    setValueByCell(prune);
    setStatusByCell(prune);
  }, [measurementIndex, sampleIdRef]);

  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // One save at a time, in sample order; stops at the first refused save.
  // `onlyIfPending` (Pass all) re-checks each cell just before its save and
  // leaves alone any cell that got a result after the run started.
  const runBulk = useCallback(
    async (
      cells: {
        characteristic: Characteristic;
        sampleIndex: number;
        payload: CellPayload;
      }[],
      skipped = 0,
      options: { onlyIfPending?: boolean } = {}
    ) => {
      if (cells.length === 0) {
        if (skipped > 0) toast.error(t`No cell could take the pasted values`);
        return;
      }
      setBulkProgress({ done: 0, total: cells.length });
      let progress = 0;
      let done = 0;
      let stopped = false;
      for (const cell of cells) {
        if (options.onlyIfPending) {
          const status = cellStatusRef.current(
            cell.sampleIndex,
            cell.characteristic.featureId
          );
          if (status != null && status !== "Pending") {
            progress += 1;
            setBulkProgress({ done: progress, total: cells.length });
            continue;
          }
        }
        const result = await persistCell(
          cell.characteristic,
          cell.sampleIndex,
          cell.payload
        );
        if (!result) {
          stopped = true;
          break;
        }
        progress += 1;
        done += 1;
        setBulkProgress({ done: progress, total: cells.length });
      }
      setBulkProgress(null);
      if (!stopped) {
        toast.success(
          skipped > 0
            ? t`Results recorded: ${done}. Values skipped: ${skipped}.`
            : t`Results recorded: ${done}`
        );
      }
    },
    [persistCell, t]
  );

  const passAll = useCallback(
    (characteristicIndex: number) => {
      const characteristic = characteristics[characteristicIndex];
      if (!characteristic || characteristic.isNumeric) return;
      const statuses = Array.from({ length: columnCount }, (_, sampleIndex) =>
        cellStatus(sampleIndex, characteristic.featureId)
      );
      // A freed serial position takes no result.
      const targets = passAllTargets({
        statuses,
        sampleSize: characteristic.sampleSize,
        existingSamples: knownSampleCount,
        columnCount
      }).filter((sampleIndex) => !isSerial || sampleIdRef.current[sampleIndex]);
      runBulk(
        targets.map((sampleIndex) => ({
          characteristic,
          sampleIndex,
          payload: { passed: "true" as const }
        })),
        0,
        { onlyIfPending: true }
      );
    },
    [
      characteristics,
      columnCount,
      cellStatus,
      knownSampleCount,
      runBulk,
      isSerial,
      sampleIdRef
    ]
  );

  const onPasteCapture = useCallback(
    (event: React.ClipboardEvent) => {
      if (isReadOnly || bulkProgress) return;
      const grid = parseClipboardGrid(event.clipboardData.getData("text"));
      // A single value pastes into the cell's own input.
      if (!isMultiCellPaste(grid)) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row][data-column]"
      );
      const marker = cell?.querySelector<HTMLElement>("[data-entry-cell]");
      if (!marker) return;
      const characteristicIndex = characteristics.findIndex(
        (c) => c.featureId === marker.dataset.featureId
      );
      const sampleIndex = Number(marker.dataset.sampleIndex);
      if (characteristicIndex < 0 || Number.isNaN(sampleIndex)) return;
      event.preventDefault();
      event.stopPropagation();

      const plan = planPaste({
        grid,
        layout,
        origin: { characteristicIndex, sampleIndex },
        characteristicCount: characteristics.length,
        // Serial positions keep their place when a sample is deleted, so the
        // shown range can be wider than the sample count.
        sampleLimit: isSerial ? columnCount : lotSize
      });
      let skipped = plan.outOfRange;
      const cells: {
        characteristic: Characteristic;
        sampleIndex: number;
        payload: CellPayload;
      }[] = [];
      for (const planned of plan.cells) {
        if (isSerial && !sampleIdRef.current[planned.sampleIndex]) {
          skipped += 1;
          continue;
        }
        const characteristic = characteristics[planned.characteristicIndex]!;
        if (characteristic.isNumeric) {
          const value = parseMeasurementToken(planned.token);
          if (value === null) skipped += 1;
          else
            cells.push({
              characteristic,
              sampleIndex: planned.sampleIndex,
              payload: { value: formatReading(value) }
            });
        } else {
          const passed = parseAttributeToken(planned.token);
          if (passed === null) skipped += 1;
          else
            cells.push({
              characteristic,
              sampleIndex: planned.sampleIndex,
              payload: { passed: passed ? "true" : "false" }
            });
        }
      }
      (document.activeElement as HTMLElement | null)?.blur();
      runBulk(cells, skipped);
    },
    [
      isReadOnly,
      bulkProgress,
      characteristics,
      layout,
      isSerial,
      columnCount,
      lotSize,
      runBulk,
      sampleIdRef
    ]
  );

  const isBusy = inFlightCount > 0 || bulkProgress !== null;
  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // EditableNumber-compatible mutation for numeric cells.
  const onCellEdit = useCallback(
    async (
      accessorKey: string,
      value: unknown,
      row: GridRow
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const { characteristicIndex, sampleIndex } = cellAt(accessorKey, row);
      const characteristic = characteristics[characteristicIndex];
      const result = characteristic
        ? await persistCell(characteristic, sampleIndex, {
            value:
              value === "" || value == null
                ? ""
                : typeof value === "number"
                  ? formatReading(value)
                  : String(value)
          })
        : null;
      return {
        data: null,
        error: result ? null : { message: t`Failed to save measurement` }
      } as unknown as PostgrestSingleResponse<unknown>;
    },
    [characteristics, persistCell, t]
  );

  // The gauge recorded per feature: the plan rows' value, overridden
  // optimistically on selection until the loader data agrees with it.
  const [gaugeByFeature, setGaugeByFeature] = useState<
    Record<string, string | null>
  >({});
  const [recentGauges, setRecentGauges] = useState(recentGaugeIds);
  useEffect(() => {
    setRecentGauges(recentGaugeIds);
  }, [recentGaugeIds]);
  const serverGaugeFor = useCallback(
    (featureId: string): string | null =>
      features.find((f) => f.inspectionFeatureId === featureId)?.gaugeId ??
      null,
    [features]
  );
  const serverGaugeForRef = useRef(serverGaugeFor);
  serverGaugeForRef.current = serverGaugeFor;
  const gaugeFor = useCallback(
    (featureId: string): string | null =>
      featureId in gaugeByFeature
        ? gaugeByFeature[featureId]
        : serverGaugeFor(featureId),
    [gaugeByFeature, serverGaugeFor]
  );

  // Per-feature request bookkeeping, so a request that settles late can never
  // undo a newer pick: `latest` is the newest request id, `settled` whether
  // it has answered, `confirmed` the newest request the server accepted.
  const gaugeRequests = useRef<
    Record<
      string,
      {
        latest: number;
        settled: boolean;
        confirmed?: { id: number; gaugeId: string | null };
      }
    >
  >({});
  // One gauge request per characteristic at a time, so the server commits the
  // picks in the order they were made.
  const gaugeQueue = useRef<Record<string, Promise<void>>>({});

  // Once the loader data matches a settled pick, drop the override so later
  // revalidations show the server's value.
  useEffect(() => {
    const caughtUp = Object.keys(gaugeByFeature).filter((featureId) => {
      const request = gaugeRequests.current[featureId];
      return (
        (!request || request.settled) &&
        serverGaugeFor(featureId) === gaugeByFeature[featureId]
      );
    });
    if (caughtUp.length === 0) return;
    for (const featureId of caughtUp) {
      const request = gaugeRequests.current[featureId];
      if (request) {
        request.confirmed = {
          id: request.latest,
          gaugeId: serverGaugeFor(featureId)
        };
      }
    }
    setGaugeByFeature((prev) => {
      const next = { ...prev };
      for (const featureId of caughtUp) delete next[featureId];
      return next;
    });
  }, [gaugeByFeature, serverGaugeFor]);

  const persistGauge = useCallback(
    async (featureId: string, gaugeId: string | null) => {
      const request = gaugeRequests.current[featureId] ?? {
        latest: 0,
        settled: true
      };
      gaugeRequests.current[featureId] = request;
      const requestId = request.latest + 1;
      request.latest = requestId;
      request.settled = false;
      setGaugeByFeature((prev) => ({ ...prev, [featureId]: gaugeId }));

      // Wait for this characteristic's previous request; a pick superseded
      // while it waited is never sent.
      const sent = (gaugeQueue.current[featureId] ?? Promise.resolve()).then(
        async () => {
          if (requestId !== request.latest) return null;
          const formData = new FormData();
          formData.set("inspectionId", inspectionId);
          formData.set("inspectionFeatureId", featureId);
          formData.set("gaugeId", gaugeId ?? "");
          const response = await fetch(path.to.inspectionGauge(inspectionId), {
            method: "post",
            body: formData
          }).catch(() => null);
          const body = (await response?.json().catch(() => null)) as {
            error?: { message: string } | null;
          } | null;
          return {
            ok: !!response?.ok && !!body && !body.error,
            message: body?.error?.message
          };
        }
      );
      gaugeQueue.current[featureId] = sent.then(() => undefined);
      const result = await sent;
      if (!result) return;
      const { ok } = result;

      if (ok && (!request.confirmed || requestId > request.confirmed.id)) {
        request.confirmed = { id: requestId, gaugeId };
      }
      if (requestId === request.latest) request.settled = true;

      if (!ok) {
        toast.error(result.message ?? t`Failed to record gauge`);
      } else if (gaugeId) {
        setRecentGauges((prev) =>
          [gaugeId, ...prev.filter((id) => id !== gaugeId)].slice(
            0,
            RECENT_INSPECTION_GAUGE_LIMIT
          )
        );
      }

      // Once the newest pick has answered, show what the server last
      // accepted: that pick if it succeeded, else the newest earlier pick
      // that did, else the loader's value.
      if (request.settled) {
        const shown = request.confirmed
          ? request.confirmed.gaugeId
          : serverGaugeForRef.current(featureId);
        setGaugeByFeature((prev) => ({ ...prev, [featureId]: shown }));
      }
    },
    [inspectionId, t]
  );

  const featureCounts = useCallback(
    (characteristic: Characteristic) => {
      let passed = 0;
      let failed = 0;
      for (let i = 0; i < columnCount; i++) {
        const status = cellStatus(i, characteristic.featureId);
        if (status === "Passed") passed += 1;
        if (status === "Failed") failed += 1;
      }
      return { passed, failed, recorded: passed + failed };
    },
    [columnCount, cellStatus]
  );
  const failedReadings = characteristics.reduce(
    (sum, characteristic) => sum + featureCounts(characteristic).failed,
    0
  );

  const rows = useMemo<GridRow[]>(() => {
    if (layout === "byPart") {
      return Array.from({ length: columnCount }, (_, sampleIndex) => {
        const sample = sampleAt(sampleIndex);
        const row: GridRow = {
          // A new key remounts the row and the input open in it, so the
          // save that creates a non-serial sample must not change it.
          rowKey: isSerial
            ? positionKey(sampleIndex)
            : `position-${sampleIndex}`,
          characteristicIndex: -1,
          sampleIndex,
          sampleLabel: isSerial
            ? sample
              ? (sample.trackedEntity?.readableId ?? `${sampleIndex + 1}`)
              : t`Removed`
            : `${sampleIndex + 1}`
        };
        characteristics.forEach((characteristic, characteristicIndex) => {
          row[featureKey(characteristicIndex)] = characteristic.isNumeric
            ? cellValue(sampleIndex, characteristic.featureId)
            : null;
        });
        return row;
      });
    }
    return characteristics.map((characteristic, characteristicIndex) => {
      const row: GridRow = {
        rowKey: characteristic.featureId,
        characteristicIndex,
        sampleIndex: -1,
        label: characteristic.label
      };
      for (let i = 0; i < columnCount; i++) {
        row[sampleKey(i)] = characteristic.isNumeric
          ? cellValue(i, characteristic.featureId)
          : null;
      }
      return row;
    });
  }, [
    layout,
    columnCount,
    sampleAt,
    positionKey,
    isSerial,
    characteristics,
    cellValue,
    t
  ]);

  const renderReading = useCallback(
    (characteristic: Characteristic, sampleIndex: number) => {
      if (isFreedPosition(sampleIndex)) return <FreedCell />;
      const value = cellValue(sampleIndex, characteristic.featureId);
      const status = cellStatus(sampleIndex, characteristic.featureId);
      const deviation =
        status === "Failed" && characteristic.spec
          ? measurementDeviation(characteristic.spec, value)
          : null;
      return (
        <span
          data-entry-cell
          data-feature-id={characteristic.featureId}
          data-sample-index={sampleIndex}
          className={cn(
            // h-11 is the smallest row height; the fill covers the whole cell.
            "-mx-4 -my-2 flex h-11 min-w-[64px] items-center justify-center px-2 text-sm tabular-nums",
            verdictCellFill(status),
            value == null && "text-muted-foreground/50"
          )}
        >
          <span className="relative flex items-center gap-1">
            {value == null ? "—" : formatReading(value)}
            {deviation && (
              <span>
                <span aria-hidden>{deviation === "above" ? "↑" : "↓"}</span>
                <span className="sr-only">
                  {deviation === "above"
                    ? t`Above the upper limit`
                    : t`Below the lower limit`}
                </span>
              </span>
            )}
          </span>
        </span>
      );
    },
    [cellValue, cellStatus, isFreedPosition, t]
  );

  // Attribute pass/fail: the cell splits into two halves edge to edge, each a
  // full-size tap target (shop-floor friendly), green ✓ pass / red ✗ fail,
  // filled when selected and tinted on hover otherwise. Shared by the display
  // cell AND the editable cell so opening a cell (keyboard nav / focus) keeps
  // the same buttons on screen instead of swapping them for an empty editor.
  const renderPassFail = useCallback(
    (characteristic: Characteristic, sampleIndex: number) => {
      if (isFreedPosition(sampleIndex)) return <FreedCell />;
      const status = cellStatus(sampleIndex, characteristic.featureId);
      const passed = status === "Passed";
      const failed = status === "Failed";
      // A closed lot shows the recorded result as text, like a reading, not
      // as buttons that look clickable but are not.
      if (isReadOnly) {
        return (
          <span
            data-entry-cell
            data-attribute
            data-feature-id={characteristic.featureId}
            data-sample-index={sampleIndex}
            className={cn(
              "-mx-4 -my-2 flex h-11 items-center justify-center px-2 text-sm",
              verdictCellFill(status),
              passed && "text-emerald-700 dark:text-emerald-400",
              !passed && !failed && "text-muted-foreground/50"
            )}
          >
            <span className="relative flex items-center gap-1">
              {passed ? (
                <>
                  <LuCheck className="size-4" aria-hidden />
                  {t`Pass`}
                </>
              ) : failed ? (
                <>
                  <LuX className="size-4" aria-hidden />
                  {t`Fail`}
                </>
              ) : (
                "—"
              )}
            </span>
          </span>
        );
      }
      return (
        <div
          data-entry-cell
          data-attribute
          data-feature-id={characteristic.featureId}
          data-sample-index={sampleIndex}
          className="-mx-4 -my-2 flex h-11 min-w-[88px] items-stretch"
        >
          <button
            type="button"
            aria-label={t`Pass`}
            // Keep focus where it is: a press that focused the cell would
            // select it and swap in its editor, unmounting this button before
            // the click lands, so the first click recorded nothing.
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={passed}
            disabled={isReadOnly || bulkProgress !== null}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              persistCell(characteristic, sampleIndex, { passed: "true" });
            }}
            className={cn(
              "flex flex-1 items-center justify-center transition-colors active:bg-accent/80 disabled:pointer-events-none disabled:opacity-50",
              passed
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            )}
          >
            <LuCheck className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t`Fail`}
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={failed}
            disabled={isReadOnly || bulkProgress !== null}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              persistCell(characteristic, sampleIndex, { passed: "false" });
            }}
            className={cn(
              "flex flex-1 items-center justify-center border-l border-border transition-colors active:bg-accent/80 disabled:pointer-events-none disabled:opacity-50",
              failed
                ? "bg-red-500/15 text-red-700 dark:text-red-400"
                : "text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            )}
          >
            <LuX className="size-4" />
          </button>
        </div>
      );
    },
    [cellStatus, isReadOnly, bulkProgress, persistCell, isFreedPosition, t]
  );

  const renderPassAll = useCallback(
    (characteristicIndex: number) => {
      const characteristic = characteristics[characteristicIndex];
      if (!characteristic || characteristic.isNumeric || isReadOnly) {
        return null;
      }
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t`Pass all empty cells of ${characteristic.label}`}
              icon={<LuCheckCheck />}
              isDisabled={bulkProgress !== null || columnCount === 0}
              onClick={(event) => {
                event.stopPropagation();
                passAll(characteristicIndex);
              }}
            />
          </TooltipTrigger>
          <TooltipContent>{t`Pass all empty cells`}</TooltipContent>
        </Tooltip>
      );
    },
    [characteristics, isReadOnly, bulkProgress, columnCount, passAll, t]
  );

  const renderProgress = useCallback(
    (characteristic: Characteristic) => {
      const counts = featureCounts(characteristic);
      const complete =
        counts.recorded >= characteristic.sampleSize &&
        counts.failed <= characteristic.acceptanceNumber;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* On phones a cell is capped narrow: wrap rather than clip. */}
            <span className="flex shrink-0 items-center gap-1 max-md:flex-wrap">
              <Badge
                variant={complete ? "green" : "secondary"}
                className="tabular-nums"
              >
                {t`${counts.recorded} of ${characteristic.sampleSize}`}
              </Badge>
              {counts.failed > 0 && (
                <Badge variant="red" className="tabular-nums">
                  {t`${counts.failed} failed`}
                </Badge>
              )}
            </span>
          </TooltipTrigger>
          {/* Below the badges, so it never covers the name and limits above. */}
          <TooltipContent side="bottom">
            {t`Sample size ${characteristic.sampleSize} · accept up to ${characteristic.acceptanceNumber} failed · reject at ${characteristic.rejectionNumber}`}
          </TooltipContent>
        </Tooltip>
      );
    },
    [featureCounts, t]
  );

  const renderCharacteristic = useCallback(
    (characteristic: Characteristic, characteristicIndex: number) => {
      const isActive =
        hasFeatures && characteristic.featureId === activeFeatureId;
      const limits = characteristic.limitsLabel ?? characteristic.specLabel;
      return (
        <div className="flex w-full min-w-0 items-center gap-2 whitespace-normal">
          {hasFeatures && (
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-medium tabular-nums",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {characteristic.label}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <TruncatedTooltipText
              className="block w-full truncate text-xs font-medium text-foreground"
              tooltip={characteristic.description}
            >
              {hasFeatures
                ? (characteristic.description ?? "—")
                : t`Overall result`}
            </TruncatedTooltipText>
            {limits && hasFeatures ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-fit truncate text-xs tabular-nums text-muted-foreground">
                    {limits}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{characteristic.specLabel}</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
          {renderPassAll(characteristicIndex)}
        </div>
      );
    },
    [hasFeatures, activeFeatureId, renderPassAll, t]
  );

  const renderGauge = useCallback(
    (characteristic: Characteristic, variant: "cell" | "chip" = "cell") => (
      <InspectionGaugePicker
        variant={variant}
        gauges={gauges}
        characteristicLabel={characteristic.label}
        recentGaugeIds={recentGauges}
        gaugeTypeId={characteristic.gaugeTypeId}
        gaugeTypeName={characteristic.gaugeTypeName}
        value={gaugeFor(characteristic.featureId)}
        isReadOnly={isReadOnly}
        onChange={(gaugeId) => persistGauge(characteristic.featureId, gaugeId)}
      />
    ),
    [gauges, recentGauges, gaugeFor, isReadOnly, persistGauge]
  );

  const columns = useMemo<ColumnDef<GridRow>[]>(() => {
    if (layout === "byPart") {
      const cols: ColumnDef<GridRow>[] = [
        {
          accessorKey: "sampleLabel",
          header: t`Sample`,
          meta: { shrinkToFit: true },
          cell: ({ row }) => {
            const status = sampleStatus(row.original.sampleIndex);
            return (
              <span className="flex items-center gap-2 pr-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    status === "Passed"
                      ? "bg-emerald-500"
                      : status === "Failed"
                        ? "bg-red-500"
                        : "bg-muted-foreground/30"
                  )}
                />
                <span className="sr-only">
                  {status === "Passed"
                    ? t`Passed`
                    : status === "Failed"
                      ? t`Failed`
                      : t`Pending`}
                </span>
                <span
                  className={cn(
                    "max-w-[160px] truncate text-sm font-medium tabular-nums",
                    isSerial && "font-mono text-xs"
                  )}
                >
                  {String(row.original.sampleLabel)}
                </span>
              </span>
            );
          }
        }
      ];
      characteristics.forEach((characteristic, characteristicIndex) => {
        cols.push({
          accessorKey: featureKey(characteristicIndex),
          header: () => (
            // Keyboard twin of the click. Not role="button": the header also
            // holds the gauge picker, which a button would hide from
            // assistive tech.
            // biome-ignore lint/a11y/noStaticElementInteractions: focusable header that shows its characteristic on the drawing; the gauge picker inside is its own control
            <div
              data-feature-header={characteristic.featureId}
              tabIndex={hasFeatures ? 0 : undefined}
              onClick={() =>
                hasFeatures && onActiveFeatureChange(characteristic.featureId)
              }
              onKeyDown={(event) => {
                if (
                  hasFeatures &&
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  onActiveFeatureChange(characteristic.featureId);
                }
              }}
              className="flex w-full min-w-[180px] flex-col gap-1.5 whitespace-normal py-1 font-normal"
            >
              {renderCharacteristic(characteristic, characteristicIndex)}
              {/* Progress and gauge share one row: the gauge is a compact
                  chip, not a full-width field on a row of its own. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {renderProgress(characteristic)}
                {hasFeatures && (
                  <div data-gauge-picker className="min-w-0 max-w-full">
                    {renderGauge(characteristic, "chip")}
                  </div>
                )}
              </div>
            </div>
          ),
          meta: { headerClassName: "w-full" },
          cell: ({ row }) =>
            characteristic.isNumeric
              ? renderReading(characteristic, row.original.sampleIndex)
              : renderPassFail(characteristic, row.original.sampleIndex)
        });
      });
      return cols;
    }

    const cols: ColumnDef<GridRow>[] = [
      {
        accessorKey: "label",
        header: t`Characteristic`,
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[320px]">
            {renderCharacteristic(
              characteristics[row.original.characteristicIndex]!,
              row.original.characteristicIndex
            )}
          </div>
        )
      },
      ...(hasFeatures
        ? [
            {
              id: "gauge",
              header: t`Gauge`,
              cell: ({ row }) => (
                // Negative margins cancel the cell padding so the picker's
                // button fills the whole cell. `data-gauge-picker` lets the
                // grid's Enter/Tab handler leave the picker's keys alone.
                <div data-gauge-picker className="-mx-4 -my-2 h-10">
                  {renderGauge(
                    characteristics[row.original.characteristicIndex]!
                  )}
                </div>
              )
            } satisfies ColumnDef<GridRow>
          ]
        : [])
    ];

    for (let i = 0; i < columnCount; i++) {
      const sample = sampleAt(i);
      cols.push({
        accessorKey: sampleKey(i),
        header: isSerial
          ? sample
            ? (sample.trackedEntity?.readableId ?? `${i + 1}`)
            : t`Removed`
          : `${i + 1}`,
        meta: { headerClassName: "justify-center" },
        cell: ({ row }) => {
          const characteristic =
            characteristics[row.original.characteristicIndex]!;
          return characteristic.isNumeric
            ? renderReading(characteristic, i)
            : renderPassFail(characteristic, i);
        }
      });
    }
    return cols;
  }, [
    layout,
    columnCount,
    sampleAt,
    isSerial,
    characteristics,
    hasFeatures,
    onActiveFeatureChange,
    sampleStatus,
    renderReading,
    renderPassFail,
    renderProgress,
    renderGauge,
    renderCharacteristic,
    t
  ]);

  // Attribute cells render the same Pass/Fail control as the display cell, so
  // opening one keeps the buttons on screen. Each column's editor is made once
  // and reads the grid's state through a ref: a new editor type would remount
  // the open input and drop what was typed. Strings go in translated, as
  // Lingui's `t` is a macro, not a value.
  const editorState = {
    characteristics,
    onCellEdit,
    renderPassFail,
    isFreedPosition,
    aboveLabel: t`Above the upper limit`,
    belowLabel: t`Below the lower limit`
  };
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const entryKeys = useMemo(
    () =>
      layout === "byPart"
        ? Array.from({ length: characteristics.length }, (_, i) =>
            featureKey(i)
          )
        : Array.from({ length: columnCount }, (_, i) => sampleKey(i)),
    [layout, characteristics.length, columnCount]
  );
  const editorCache = useRef<
    Record<
      string,
      (props: EditableTableCellComponentProps<GridRow>) => JSX.Element
    >
  >({});
  const editableComponents = useMemo(() => {
    const components: typeof editorCache.current = {};
    const specAt = (key: string, row: GridRow) =>
      editorStateRef.current.characteristics[
        cellAt(key, row).characteristicIndex
      ]?.spec;
    for (const key of entryKeys) {
      const cached = editorCache.current[key];
      if (cached) {
        components[key] = cached;
        continue;
      }
      const NumberEditor = EditableNumber<GridRow>(
        (accessorKey, value, row) =>
          editorStateRef.current.onCellEdit(accessorKey, value, row),
        { className: "h-full", formatOptions: INPUT_FORMAT.measurement },
        {
          clearable: true,
          inputClassName: "h-full text-center text-sm tabular-nums",
          liveInputClassName: (row, value) => {
            const spec = specAt(key, row);
            if (!spec || value === null) return undefined;
            return verdictFill(valuateMeasurement(spec, value));
          },
          // The display cell's ↑ / ↓ is unmounted while the editor is open.
          liveAdornment: (row, value) => {
            const spec = specAt(key, row);
            if (!spec || value === null) return null;
            if (valuateMeasurement(spec, value) !== "Failed") return null;
            const deviation = measurementDeviation(spec, value);
            if (!deviation) return null;
            const { aboveLabel, belowLabel } = editorStateRef.current;
            return (
              <span className="text-sm text-red-700 dark:text-red-300">
                <span aria-hidden>{deviation === "above" ? "↑" : "↓"}</span>
                <span className="sr-only">
                  {deviation === "above" ? aboveLabel : belowLabel}
                </span>
              </span>
            );
          }
        }
      );
      components[key] = (props) => {
        const { characteristics, renderPassFail, isFreedPosition } =
          editorStateRef.current;
        const { characteristicIndex, sampleIndex } = cellAt(key, props.row);
        const characteristic = characteristics[characteristicIndex];
        if (!characteristic) return <span />;
        if (isFreedPosition(sampleIndex)) return <FreedCell />;
        if (!characteristic.isNumeric) {
          return renderPassFail(characteristic, sampleIndex);
        }
        // Keeps the open cell an entry cell for keyboard navigation, and
        // covers the table cell so the editor's fill meets its edges.
        return (
          <div
            data-entry-cell
            data-feature-id={characteristic.featureId}
            data-sample-index={sampleIndex}
            className="absolute inset-0"
          >
            <NumberEditor {...props} />
          </div>
        );
      };
      editorCache.current[key] = components[key];
    }
    return components;
  }, [entryKeys]);

  const gridRef = useRef<HTMLDivElement>(null);
  const rowCount = rows.length;
  const [tab, setTab] = useState<InspectionPlanTab>("characteristics");

  useEffect(() => {
    if (!activeFeatureId) return;
    if (layout === "byPart") {
      gridRef.current
        ?.querySelector(`[data-feature-header="${activeFeatureId}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    const index = rows.findIndex((r) => r.rowKey === activeFeatureId);
    if (index < 0) return;
    gridRef.current
      ?.querySelector(`[data-row="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeFeatureId, rows, layout]);

  // Spreadsheet-style entry: Enter/Tab advance to the next entry cell in the
  // row, wrapping to the next row; Shift+Tab reverses. By characteristic
  // that walks a characteristic's samples; by part, a part's characteristics.
  // Entry cells are resolved live from the DOM via the `data-entry-cell` markers.
  // The go / no-go cell a reading was typed into: Enter there stays put.
  const strayKeyCellRef = useRef<HTMLElement | null>(null);
  const onGridKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (isReadOnly) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row][data-column]"
      );
      if (!cell || !gridRef.current?.contains(cell)) return;
      // An Enter that confirms IME composition (full-width digits) is not a
      // move: it would commit and leave the cell before the text is final.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const rowIndex = Number(cell.getAttribute("data-row"));
      const currentColumn = Number(cell.getAttribute("data-column"));

      // The next entry cell. The Table renders only the rows near the view, so
      // when the adjacent row exists but is not mounted, bring this row to the
      // middle (its neighbours mount) and look again on the next frame.
      const moveOn = (reverse: boolean) => {
        const go = (target: HTMLElement) => {
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
          target.click();
        };
        const target = nextEntryCell(cell, reverse);
        if (target) {
          go(target);
          return true;
        }
        const adjacent = rowIndex + (reverse ? -1 : 1);
        if (adjacent < 0 || adjacent >= rowCount) return false;
        cell.scrollIntoView({ block: "center", inline: "nearest" });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const current = gridRef.current?.querySelector<HTMLElement>(
              `[data-row="${rowIndex}"][data-column="${currentColumn}"]`
            );
            const retry = current ? nextEntryCell(current, reverse) : null;
            if (retry) go(retry);
          })
        );
        return true;
      };

      // A selected go / no-go cell: P records a pass, F a fail, then the
      // selection moves on as Enter would — keyboard-only entry never stalls.
      const verdict = verdictForKey(event);
      const attributeCell = cell.querySelector<HTMLElement>(
        "[data-entry-cell][data-attribute]"
      );
      const onAttributeCell =
        attributeCell !== null &&
        (event.target as HTMLElement).tagName !== "INPUT";
      if (strayKeyCellRef.current !== (onAttributeCell ? cell : null)) {
        strayKeyCellRef.current = null;
      }
      // A reading typed into a go / no-go cell: say so, and keep the next
      // Enter from moving on as if the cell had been answered.
      if (onAttributeCell && isReadingKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        strayKeyCellRef.current = cell;
        toast.warning(t`This is a pass / fail check. Press P or F.`, {
          id: "inspection-attribute-key"
        });
        return;
      }
      if (
        event.key === "Enter" &&
        onAttributeCell &&
        strayKeyCellRef.current === cell
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        verdict &&
        attributeCell &&
        (event.target as HTMLElement).tagName !== "INPUT"
      ) {
        const characteristic = characteristics.find(
          (c) => c.featureId === attributeCell.dataset.featureId
        );
        const sampleIndex = Number(attributeCell.dataset.sampleIndex);
        if (characteristic && !Number.isNaN(sampleIndex)) {
          event.preventDefault();
          event.stopPropagation();
          strayKeyCellRef.current = null;
          persistCell(characteristic, sampleIndex, { passed: verdict });
          moveOn(false);
        }
        return;
      }

      if (event.key !== "Enter" && event.key !== "Tab") return;

      // The Gauge cell: Enter opens its picker. Keep the event from the
      // Table's own Enter navigation; a focused trigger button opens on its
      // native Enter click, a selected cell clicks the trigger itself.
      const gaugeTrigger = cell.querySelector<HTMLElement>(
        "[data-gauge-picker] button"
      );
      if (gaugeTrigger && event.key === "Enter") {
        event.stopPropagation();
        if (event.target !== gaugeTrigger) {
          event.preventDefault();
          gaugeTrigger.click();
        }
        return;
      }

      // Every entry cell carries a marker, the open editor included, so a
      // cell without one (characteristic, gauge, result) is not an entry cell.
      const entryColumns = gridRef.current
        ? entryColumnsForRow(gridRef.current, rowIndex)
        : [];
      if (entryColumns.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const go = (target: HTMLElement) => {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        target.click();
      };

      // From a non-entry cell, jump into the row's first entry cell.
      const position = entryColumns.indexOf(currentColumn);
      if (position < 0) {
        event.preventDefault();
        event.stopPropagation();
        const first = gridRef.current?.querySelector<HTMLElement>(
          `[data-row="${rowIndex}"][data-column="${entryColumns[0]}"]`
        );
        if (first) go(first);
        return;
      }

      const reverse = event.key === "Tab" && event.shiftKey;
      const atEdge =
        !nextEntryCell(cell, reverse) &&
        (rowIndex + (reverse ? -1 : 1) < 0 ||
          rowIndex + (reverse ? -1 : 1) >= rowCount);

      // Let Tab exit the grid at the boundary rather than trapping focus.
      if (event.key === "Tab" && atEdge) {
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (active?.tagName === "INPUT") active.blur(); // commit before moving
      if (!moveOn(reverse)) cell.focus();
    },
    [isReadOnly, characteristics, persistCell, rowCount, t]
  );

  const characteristicsTitle = hasFeatures
    ? `${t`Characteristics`} (${characteristics.length})`
    : t`Result`;
  const parameterTabs =
    parameters !== undefined ? (
      <InspectionPlanTabs
        value={tab}
        onValueChange={setTab}
        characteristicsLabel={characteristicsTitle}
      />
    ) : null;

  if (parameters !== undefined && tab === "instructions") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex min-h-12 shrink-0 items-center px-4 py-2">
          {parameterTabs}
        </div>
        <InspectionPlanInstructions
          workInstruction={workInstruction}
          className="border-t border-border"
        />
      </div>
    );
  }

  if (parameters !== undefined && tab === "parameters") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex min-h-12 shrink-0 items-center px-4 py-2">
          {parameterTabs}
        </div>
        <InspectionPlanParameters
          parameters={parameters}
          className="border-t border-border"
        />
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      onKeyDownCapture={onGridKeyDownCapture}
      onPasteCapture={onPasteCapture}
      onClickCapture={(event) => {
        // A click on the gauge picker only opens it. Making its row active
        // here re-renders the grid's columns, which closed the picker the
        // same click had just opened.
        if ((event.target as HTMLElement).closest("[data-gauge-picker]")) {
          return;
        }
        const marker = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-entry-cell]"
        );
        if (marker?.dataset.featureId && hasFeatures) {
          onActiveFeatureChange(marker.dataset.featureId);
          return;
        }
        if (layout !== "byCharacteristic") return;
        const cell = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-row][data-column]"
        );
        if (!cell) return;
        const rowIndex = Number(cell.getAttribute("data-row"));
        const featureId = rows[rowIndex]?.rowKey;
        if (featureId && hasFeatures) onActiveFeatureChange(featureId);
      }}
      // Header cells align to the top, so characteristic headers of
      // different heights (a wrapped gauge chip) still line up. The Table's
      // last row (its empty footer) gets a bottom border to close the grid.
      className="flex h-full min-h-0 w-full flex-col [&_thead_th]:align-top [&_tbody:last-of-type>tr:last-child]:border-b [&_tbody:last-of-type>tr:last-child]:border-border"
    >
      <Table<GridRow>
        // Pinning and the editor are per layout: remount on a switch.
        key={layout}
        mobileLayout="table"
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        getRowId={(row) => row.rowKey}
        editableComponents={editableComponents}
        defaultColumnPinning={{
          left: [layout === "byPart" ? "sampleLabel" : "label"]
        }}
        // Search, sort and column reordering mean nothing on a fixed grid.
        withSimpleSorting={false}
        withSearch={false}
        withColumnOrdering={false}
        sort={null}
        // No toolbar row: its controls (export, the row count) cost a row of
        // height on every lot and answer nothing an inspector asks here.
        withCsvExport={false}
        withPagination={false}
        getRowClassName={(row) =>
          layout === "byCharacteristic" && row.rowKey === activeFeatureId
            ? "bg-accent/40"
            : undefined
        }
        titleBadge={
          <span className="flex min-w-0 items-center gap-2">
            {parameterTabs ?? (
              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                {characteristicsTitle}
              </span>
            )}
            {failedReadings > 0 && (
              <Badge variant="red" className="tabular-nums">
                {t`${failedReadings} failed`}
              </Badge>
            )}
            {bulkProgress && (
              <Badge variant="secondary" className="tabular-nums">
                {t`Saving ${bulkProgress.done}/${bulkProgress.total}`}
              </Badge>
            )}
          </span>
        }
        primaryAction={
          <span className="flex items-center gap-1">
            {columnCount > 0 && (
              <ToggleGroup
                type="single"
                size="sm"
                value={layout}
                onValueChange={onLayoutChange}
                aria-label={t`Grid layout`}
              >
                <ToggleGroupItem
                  value="byCharacteristic"
                  title={t`One row per characteristic`}
                >
                  <LuRows3 className="mr-1.5 size-4" />
                  {t`By characteristic`}
                </ToggleGroupItem>
                <ToggleGroupItem value="byPart" title={t`One row per part`}>
                  <LuTableProperties className="mr-1.5 size-4" />
                  {t`By part`}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {primaryAction}
          </span>
        }
        withInlineEditing={!isReadOnly}
        forceEditMode={!isReadOnly}
      />
    </div>
  );
};

// A key that starts or continues a reading: a digit, a decimal mark, a sign.
function isReadingKey(event: React.KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return /^[\d.,+-]$/.test(event.key);
}

function verdictForKey(event: React.KeyboardEvent): "true" | "false" | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "p") return "true";
  if (key === "f") return "false";
  return null;
}

function entryColumnsForRow(grid: HTMLElement, row: number): number[] {
  const columns = new Set<number>();
  grid
    .querySelectorAll<HTMLElement>(
      `[data-row="${row}"][data-column] [data-entry-cell]`
    )
    .forEach((marker) => {
      const column = marker
        .closest<HTMLElement>("[data-column]")
        ?.getAttribute("data-column");
      if (column != null) columns.add(Number(column));
    });
  return [...columns].sort((a, b) => a - b);
}

// The entry cell after (or before) `cell`, wrapping to the adjacent row.
function nextEntryCell(
  cell: HTMLElement,
  reverse: boolean
): HTMLElement | null {
  const grid = cell.closest<HTMLElement>("table");
  if (!grid) return null;
  const row = Number(cell.getAttribute("data-row"));
  const column = Number(cell.getAttribute("data-column"));
  const columns = entryColumnsForRow(grid, row);
  const position = columns.indexOf(column);
  let targetRow = row;
  let targetColumn = reverse ? columns[position - 1] : columns[position + 1];
  if (targetColumn === undefined) {
    targetRow = row + (reverse ? -1 : 1);
    const nextColumns = entryColumnsForRow(grid, targetRow);
    targetColumn = reverse
      ? nextColumns[nextColumns.length - 1]
      : nextColumns[0];
  }
  if (targetColumn === undefined) return null;
  return grid.querySelector<HTMLElement>(
    `[data-row="${targetRow}"][data-column="${targetColumn}"]`
  );
}

// Which characteristic and sample an entry cell is: by characteristic the
// column names the sample, by part it names the characteristic.
function cellAt(accessorKey: string, row: GridRow) {
  if (accessorKey.startsWith("sample-")) {
    return {
      characteristicIndex: row.characteristicIndex,
      sampleIndex: Number(accessorKey.slice("sample-".length))
    };
  }
  return {
    characteristicIndex: Number(accessorKey.slice("feature-".length)),
    sampleIndex: row.sampleIndex
  };
}

export default InspectionMeasurementGrid;
