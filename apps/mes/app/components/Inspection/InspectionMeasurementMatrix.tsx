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
  toast
} from "@carbon/react";
import type { InspectionGridLayout } from "@carbon/utils";
import {
  compareSamplesByCreation,
  defaultInspectionGridLayout,
  formatReading,
  formatSpecLabel,
  formatToleranceLimits,
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
import type { MutableRefObject, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import {
  LuCheck,
  LuCheckCheck,
  LuRows3,
  LuTableProperties,
  LuX
} from "react-icons/lu";
import type {
  InspectionGauge,
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan
} from "~/services/types";
import { path } from "~/utils/path";
import InspectionGaugePicker from "./InspectionGaugePicker";

// A cell save's response payload (the measurement action returns it so the
// matrix can update without a revalidation roundtrip). Same contract as the
// ERP quality module's InspectionMeasurementGrid.
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

// Synthetic feature id for the single pass/fail row shown when the lot has no
// inspection document. Its cells write the sample's status directly (via the
// sample route) rather than a per-feature measurement.
export const OVERALL_ROW_ID = "__overall__";

// Mirrors RECENT_INSPECTION_GAUGE_LIMIT in packages/database/src/quality.ts
// (the server's "recently used" cap) — that module is server-only (Kysely), so
// it cannot be imported into this client component.
const RECENT_INSPECTION_GAUGE_LIMIT = 10;

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

type CellPayload = { value?: string; passed?: "true" | "false" };

type InspectionMeasurementMatrixProps = {
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
  // Buttons for the toolbar's end: the drawing and collapse toggles.
  toolbarActions?: ReactNode;
  // The plan's parameters (setup to read before measuring), on a Parameters
  // tab beside the characteristics. Passed only when the lot has a plan, so
  // the tab is always there to find, empty or not.
  parameters?: InspectionParameter[];
  // The plan's work instructions, on an Instructions tab. Passed with
  // `parameters`, only when the lot has a plan.
  workInstruction?: JSONContent | null;
  // Matrix position -> sample id, owned by the view so it survives a remount
  // (Hide / Show drawing). A save still running in the old matrix writes
  // here, so the new matrix's next save reuses that sample.
  placementRef?: MutableRefObject<Record<number, string>>;
  // True while any save or bulk run is in flight.
  onBusyChange?: (busy: boolean) => void;
};

// The position of a sample the matrix shows but no save has made yet.
const newSampleKey = (sampleIndex: number) => `new-${sampleIndex}`;

// Only a failure is coloured: a passing reading is ordinary data, so the few
// out-of-tolerance cells are what the operator's eye finds.
function verdictFill(status: string | undefined) {
  return status === "Failed"
    ? "bg-red-500/10 font-semibold text-red-700 dark:text-red-400"
    : "bg-transparent text-foreground hover:bg-muted/40 focus:bg-background";
}

// Shop-floor features × samples matrix, with a transposed "by part" layout for
// large batches. Implements the same per-cell quiet POST contract as the ERP
// grid (measurement route for feature cells, sample route for the "Overall
// result" row) with plain touch-sized cells instead of the ERP Table.
// Spec: .ai/specs/2026-11-05-inspection-entry-ergonomics.md.
const InspectionMeasurementMatrix = ({
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
  toolbarActions,
  parameters,
  workInstruction,
  placementRef,
  onBusyChange
}: InspectionMeasurementMatrixProps) => {
  const [tab, setTab] = useState<InspectionPlanTab>("characteristics");
  const { t } = useLingui();

  // The matrix ignores plan rows whose live feature was deleted from the document.
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
  const hasFeatures = liveFeatures.length > 0;

  const characteristics = useMemo<Characteristic[]>(() => {
    if (!hasFeatures) {
      return [
        {
          featureId: OVERALL_ROW_ID,
          label: t`Overall result`,
          description: null,
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
        specLabel: formatSpecLabel(feature),
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

  // Matrix position (column by characteristic, row by part) -> sample id. A
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
  // default is decided once, on the first non-empty matrix, so scanning
  // samples never flips the layout mid-entry.
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
  const layout: InspectionGridLayout =
    layoutChoice ?? autoLayout ?? computedLayout;
  const onLayoutChange = useCallback((value: string) => {
    if (!isInspectionGridLayout(value)) return;
    setLayoutChoice(value);
    try {
      window.localStorage.setItem(INSPECTION_GRID_LAYOUT_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, []);

  // Server status + value per cell, seeded from the loader and patched by save
  // responses (per-cell saves are quiet — no revalidation).
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
    const index = new Map<string, (typeof measurements)[number]>();
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

      const response = await fetch(path.to.inspectionSample(inspectionId), {
        method: "post",
        body: formData
      }).catch(() => null);
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
    (characteristic: Characteristic) => {
      if (characteristic.isNumeric) return;
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
    [columnCount, cellStatus, knownSampleCount, runBulk, isSerial, sampleIdRef]
  );

  const onPasteCapture = useCallback(
    (event: React.ClipboardEvent) => {
      if (isReadOnly || bulkProgress) return;
      const grid = parseClipboardGrid(event.clipboardData.getData("text"));
      // A single value pastes into the cell's own input.
      if (!isMultiCellPaste(grid)) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-entry-cell]"
      );
      if (!cell) return;
      const characteristicIndex = characteristics.findIndex(
        (c) => c.featureId === cell.dataset.featureId
      );
      const sampleIndex = Number(cell.dataset.sampleIndex);
      if (characteristicIndex < 0 || Number.isNaN(sampleIndex)) return;
      event.preventDefault();

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
      // Commit a dirty draft first, so its blur cannot overwrite a pasted value.
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

  const sampleLabels = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, index) => {
        const sample = sampleAt(index);
        // MES entity display convention (AssemblyView precedent): readableId,
        // else the first 8 characters of the entity id.
        const entityLabel =
          sample?.trackedEntity?.readableId ??
          sample?.trackedEntityId?.slice(0, 8);
        if (!isSerial) return `${index + 1}`;
        if (!sample) return t`Removed`;
        return entityLabel ?? `${index + 1}`;
      }),
    [columnCount, sampleAt, isSerial, t]
  );

  // Spreadsheet-style entry: Enter/Tab move to the next entry cell in
  // the row, wrapping to the next row; Shift+Tab moves back. Moving focus
  // blurs the input, which commits it.
  const tableRef = useRef<HTMLTableElement>(null);
  // The go / no-go cell a reading was typed into: Enter there records nothing
  // and stays, so a misplaced reading never becomes a pass.
  const strayKeyCellRef = useRef<HTMLElement | null>(null);
  const onKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      // An Enter that confirms IME composition (full-width digits) is not a
      // move: it would commit and leave the cell before the text is final.
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const target = event.target as HTMLElement;
      const attributeCell =
        target.tagName === "BUTTON"
          ? target.closest<HTMLElement>("[data-entry-cell][data-attribute]")
          : null;
      if (strayKeyCellRef.current !== attributeCell) {
        strayKeyCellRef.current = null;
      }
      if (attributeCell && isReadingKey(event)) {
        event.preventDefault();
        strayKeyCellRef.current = attributeCell;
        toast.warning(t`This is a pass / fail check. Press P or F.`, {
          id: "inspection-attribute-key"
        });
        return;
      }
      if (
        event.key === "Enter" &&
        attributeCell &&
        strayKeyCellRef.current === attributeCell
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // On a go / no-go cell, P records a pass and F a fail, then focus moves on.
      const verdict = verdictForKey(event);
      if (verdict && target.tagName === "BUTTON") {
        const cell = target.closest<HTMLElement>(
          "[data-entry-cell][data-attribute]"
        );
        if (!cell || !tableRef.current?.contains(cell)) return;
        event.preventDefault();
        strayKeyCellRef.current = null;
        cell
          .querySelector<HTMLButtonElement>(`button[data-verdict="${verdict}"]`)
          ?.click();
        const cells = [
          ...tableRef.current.querySelectorAll<HTMLElement>("[data-entry-cell]")
        ];
        const next = cells[cells.indexOf(cell) + 1];
        next?.scrollIntoView({ block: "nearest", inline: "nearest" });
        next
          ?.querySelector<HTMLElement>("input, button:not([disabled])")
          ?.focus();
        return;
      }
      if (event.key !== "Enter" && event.key !== "Tab") return;
      // Enter on a Pass/Fail button records that result, then moves on like P /
      // F. Any other button (gauge, Pass all) keeps its native Enter.
      if (event.key === "Enter" && target.tagName === "BUTTON") {
        if (!target.closest("[data-entry-cell][data-attribute]")) return;
        event.preventDefault();
        (target as HTMLButtonElement).click();
      }
      const cell = target.closest<HTMLElement>("[data-entry-cell]");
      if (!cell || !tableRef.current?.contains(cell)) return;
      const cells = [
        ...tableRef.current.querySelectorAll<HTMLElement>("[data-entry-cell]")
      ];
      const index = cells.indexOf(cell);
      const reverse = event.key === "Tab" && event.shiftKey;
      const next = cells[index + (reverse ? -1 : 1)];
      if (!next) {
        if (event.key === "Enter") {
          event.preventDefault();
          target.blur();
        }
        return;
      }
      event.preventDefault();
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
      next.querySelector<HTMLElement>("input, button:not([disabled])")?.focus();
    },
    [t]
  );

  const renderPassAll = (characteristic: Characteristic) =>
    characteristic.isNumeric || isReadOnly ? null : (
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        aria-label={t`Pass all empty cells of ${characteristic.label}`}
        icon={<LuCheckCheck />}
        isDisabled={bulkProgress !== null || columnCount === 0}
        onClick={(event) => {
          event.stopPropagation();
          passAll(characteristic);
        }}
      />
    );

  const renderProgress = (characteristic: Characteristic) => {
    const counts = featureCounts(characteristic);
    const complete =
      counts.recorded >= characteristic.sampleSize &&
      counts.failed <= characteristic.acceptanceNumber;
    return (
      <span className="flex flex-wrap items-center gap-1">
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
    );
  };

  const renderGauge = (characteristic: Characteristic) => (
    <InspectionGaugePicker
      gauges={gauges}
      characteristicLabel={characteristic.label}
      recentGaugeIds={recentGauges}
      gaugeTypeId={characteristic.gaugeTypeId}
      gaugeTypeName={characteristic.gaugeTypeName}
      value={gaugeFor(characteristic.featureId)}
      isReadOnly={isReadOnly}
      onChange={(gaugeId) => persistGauge(characteristic.featureId, gaugeId)}
    />
  );

  // An entry cell's name: the characteristic and the sample it is for.
  const entryCellLabel = (characteristic: string, sample: string) =>
    t`${characteristic}, sample ${sample}`;

  const renderEntryCell = (
    characteristic: Characteristic,
    sampleIndex: number
  ) => {
    // A serial position whose part was deleted: shown, but takes no entry,
    // and keyboard entry skips it (no entry marker).
    if (isSerial && !sampleIdByColumn[sampleIndex]) {
      return (
        <td
          key={`${characteristic.featureId}-${sampleIndex}`}
          className="h-px border-b border-r border-border bg-muted/40 p-0 text-center align-middle text-muted-foreground/50 last:border-r-0"
        >
          —
        </td>
      );
    }
    const status = cellStatus(sampleIndex, characteristic.featureId);
    const characteristicName =
      characteristic.featureId !== OVERALL_ROW_ID && characteristic.description
        ? `#${characteristic.label} ${characteristic.description}`
        : characteristic.label;
    const sampleName = sampleLabels[sampleIndex] ?? "";
    const cellLabel = entryCellLabel(characteristicName, sampleName);
    return (
      <td
        key={`${characteristic.featureId}-${sampleIndex}`}
        data-entry-cell
        data-attribute={characteristic.isNumeric ? undefined : ""}
        data-feature-id={characteristic.featureId}
        data-sample-index={sampleIndex}
        onFocusCapture={() =>
          hasFeatures && onActiveFeatureChange(characteristic.featureId)
        }
        className="relative h-px border-b border-r border-border p-0 text-center align-middle last:border-r-0"
      >
        {characteristic.isNumeric ? (
          <NumericCell
            ariaLabel={cellLabel}
            disabled={isReadOnly}
            status={status}
            spec={characteristic.spec}
            value={cellValue(sampleIndex, characteristic.featureId)}
            aboveLabel={t`Above the upper limit`}
            belowLabel={t`Below the lower limit`}
            passLabel={t`Pass`}
            failLabel={t`Fail (out of tolerance)`}
            onCommit={(value) =>
              persistCell(characteristic, sampleIndex, { value })
            }
          />
        ) : (
          <PassFailCell
            label={cellLabel}
            disabled={isReadOnly || bulkProgress !== null}
            status={status}
            passLabel={t`Pass`}
            failLabel={t`Fail`}
            onToggle={(passed) =>
              persistCell(characteristic, sampleIndex, { passed })
            }
          />
        )}
      </td>
    );
  };

  const isBusy = inFlightCount > 0 || bulkProgress !== null;
  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const characteristicsTitle = hasFeatures
    ? `${t`Characteristics`} (${characteristics.length})`
    : t`Result`;
  const showingParameters = parameters !== undefined && tab === "parameters";
  const showingInstructions =
    parameters !== undefined && tab === "instructions";

  const toolbar = (
    <div className="flex min-h-10 flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        {parameters !== undefined ? (
          <InspectionPlanTabs
            value={tab}
            onValueChange={setTab}
            characteristicsLabel={characteristicsTitle}
            className="max-md:w-auto max-md:px-0"
          />
        ) : (
          <span className="truncate text-sm font-medium text-foreground">
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
      <span className="flex items-center gap-1">
        {columnCount > 0 && !showingParameters && !showingInstructions && (
          <ToggleGroup
            type="single"
            size="sm"
            value={layout}
            onValueChange={onLayoutChange}
            aria-label={t`Grid layout`}
          >
            <ToggleGroupItem value="byCharacteristic">
              <LuRows3 className="mr-1.5 size-4" />
              <span>{t`By characteristic`}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="byPart">
              <LuTableProperties className="mr-1.5 size-4" />
              <span>{t`By part`}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {toolbarActions}
      </span>
    </div>
  );

  if (showingInstructions) {
    return (
      <>
        {toolbar}
        <InspectionPlanInstructions
          workInstruction={workInstruction}
          size="lg"
        />
      </>
    );
  }

  if (showingParameters) {
    return (
      <>
        {toolbar}
        <InspectionPlanParameters parameters={parameters} size="lg" />
      </>
    );
  }

  if (columnCount === 0) {
    return (
      <>
        {toolbar}
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {isSerial
            ? t`Scan a tracked entity to add the first sample column.`
            : t`No samples required.`}
        </div>
      </>
    );
  }

  const characteristicHeader = (characteristic: Characteristic) => (
    <div className="flex items-start gap-3 max-md:gap-2">
      {characteristic.featureId !== OVERALL_ROW_ID ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-foreground tabular-nums">
          {characteristic.label}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="line-clamp-2 text-sm font-semibold text-foreground">
          {characteristic.description ??
            (characteristic.featureId === OVERALL_ROW_ID
              ? characteristic.label
              : "—")}
        </div>
        {characteristic.limitsLabel || characteristic.specLabel ? (
          <div className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {characteristic.limitsLabel ?? characteristic.specLabel}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {renderProgress(characteristic)}
        </div>
      </div>
      {renderPassAll(characteristic)}
    </div>
  );

  return (
    <>
      {toolbar}
      <div
        className="min-h-0 flex-1 overflow-auto max-md:scroll-fade-x"
        onKeyDownCapture={onKeyDownCapture}
        onPasteCapture={onPasteCapture}
      >
        {layout === "byPart" ? (
          <table
            ref={tableRef}
            className="w-full border-separate border-spacing-0 text-sm"
          >
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[96px] max-md:min-w-[64px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                  {t`Sample`}
                </th>
                {characteristics.map((characteristic) => {
                  const isActive =
                    hasFeatures && activeFeatureId === characteristic.featureId;
                  return (
                    <th
                      key={characteristic.featureId}
                      className={cn(
                        "min-w-[160px] max-w-[240px] cursor-pointer border-b border-r border-border bg-card px-3 py-2 text-left align-top font-normal last:border-r-0",
                        isActive && "bg-accent"
                      )}
                      onClick={() =>
                        hasFeatures &&
                        onActiveFeatureChange(
                          isActive ? null : characteristic.featureId
                        )
                      }
                      // Keyboard twin of the click. Not role="button": the
                      // cell also holds the gauge picker, which a button
                      // would hide from assistive tech.
                      tabIndex={hasFeatures ? 0 : undefined}
                      aria-current={isActive ? "true" : undefined}
                      onKeyDown={(event) => {
                        if (
                          hasFeatures &&
                          event.target === event.currentTarget &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          onActiveFeatureChange(
                            isActive ? null : characteristic.featureId
                          );
                        }
                      }}
                    >
                      {characteristicHeader(characteristic)}
                      {hasFeatures ? (
                        // The click must not toggle the active column.
                        // biome-ignore lint/a11y/noStaticElementInteractions: only stops the gauge picker's clicks from toggling the column; the picker inside is the control
                        <div
                          className="-mx-3 -mb-2 mt-2 min-w-0 border-t border-border [&>*]:min-w-0"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {renderGauge(characteristic)}
                        </div>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sampleLabels.map((label, sampleIndex) => {
                const sampleId = sampleIdByColumn[sampleIndex];
                const status = sampleId
                  ? (sampleStatusById[sampleId] ??
                    sampleById.get(sampleId)?.status)
                  : undefined;
                return (
                  <tr key={`sample-${sampleIndex}`}>
                    <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2">
                      <span className="flex items-center gap-2">
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
                        <span
                          className={cn(
                            "max-w-[160px] truncate text-sm font-semibold tabular-nums",
                            isSerial && "font-mono"
                          )}
                        >
                          {label}
                        </span>
                      </span>
                    </td>
                    {characteristics.map((characteristic) =>
                      renderEntryCell(characteristic, sampleIndex)
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table
            ref={tableRef}
            className="w-full border-separate border-spacing-0 text-sm"
          >
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[220px] max-md:w-[150px] max-md:min-w-[150px] max-md:max-w-[150px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                  {hasFeatures ? t`Characteristic` : t`Result`}
                </th>
                {hasFeatures && (
                  <th className="min-w-[140px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground max-md:hidden">
                    {t`Gauge`}
                  </th>
                )}
                {sampleLabels.map((label, index) => (
                  <th
                    key={`column-${index}`}
                    className="min-w-[96px] border-b border-r border-border bg-card px-2 py-2 text-center font-medium last:border-r-0"
                  >
                    <span className="block max-w-[140px] truncate font-mono text-xs">
                      {label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {characteristics.map((characteristic) => {
                const isActive =
                  hasFeatures && activeFeatureId === characteristic.featureId;
                return (
                  <tr
                    key={characteristic.featureId}
                    className={cn(isActive && "bg-accent/40")}
                  >
                    <td
                      className={cn(
                        "sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-card px-3 py-2 align-top max-md:max-w-[150px] max-md:px-2",
                        isActive && "bg-accent"
                      )}
                      onClick={() =>
                        hasFeatures
                          ? onActiveFeatureChange(
                              isActive ? null : characteristic.featureId
                            )
                          : undefined
                      }
                      // Keyboard twin of the click. Not role="button": the
                      // cell also holds the phone gauge picker, which a button
                      // would hide from assistive tech.
                      tabIndex={hasFeatures ? 0 : undefined}
                      aria-current={isActive ? "true" : undefined}
                      onKeyDown={(event) => {
                        if (
                          hasFeatures &&
                          event.target === event.currentTarget &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          onActiveFeatureChange(
                            isActive ? null : characteristic.featureId
                          );
                        }
                      }}
                    >
                      {characteristicHeader(characteristic)}
                      {hasFeatures ? (
                        // Phones: the gauge sits under the characteristic.
                        // The click must not toggle the active row.
                        // biome-ignore lint/a11y/noStaticElementInteractions: only stops the gauge picker's clicks from toggling the row; the picker inside is the control
                        <div
                          className="-mx-2 -mb-2 mt-2 hidden min-w-0 border-t border-border max-md:block [&>*]:min-w-0"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {renderGauge(characteristic)}
                        </div>
                      ) : null}
                    </td>
                    {hasFeatures && (
                      <td className="h-px border-b border-r border-border p-0 align-middle max-md:hidden">
                        {renderGauge(characteristic)}
                      </td>
                    )}
                    {sampleLabels.map((_, sampleIndex) =>
                      renderEntryCell(characteristic, sampleIndex)
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
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

function NumericCell({
  ariaLabel,
  disabled,
  status,
  spec,
  value,
  aboveLabel,
  belowLabel,
  passLabel,
  failLabel,
  onCommit
}: {
  ariaLabel: string;
  disabled: boolean;
  status: string | undefined;
  spec: MeasurementFeatureSpec | null;
  value: number | null;
  aboveLabel: string;
  belowLabel: string;
  passLabel: string;
  failLabel: string;
  onCommit: (value: string) => void;
}) {
  const statusId = useId();
  const [draft, setDraft] = useState(value == null ? "" : formatReading(value));

  // Re-sync when the persisted value changes underneath (e.g. save response).
  useEffect(() => {
    setDraft(value == null ? "" : formatReading(value));
  }, [value]);

  const persisted = value == null ? "" : formatReading(value);
  const isDirty = draft.trim() !== persisted;

  // While typing, the draft's own verdict; a draft that does not parse
  // yet shows no verdict. A saved value shows its stored status.
  const draftValue = parseMeasurementToken(draft);
  const shownStatus = !isDirty
    ? status
    : draftValue !== null && spec
      ? valuateMeasurement(spec, draftValue)
      : undefined;
  const shownValue = isDirty ? draftValue : value;
  const deviation =
    shownStatus === "Failed" && spec
      ? measurementDeviation(spec, shownValue)
      : null;

  // The verdict is otherwise only the cell's colour: say it as text too.
  const statusText = deviation
    ? deviation === "above"
      ? aboveLabel
      : belowLabel
    : shownStatus === "Failed"
      ? failLabel
      : shownStatus === "Passed"
        ? passLabel
        : null;

  const commit = () => {
    if (!isDirty) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      onCommit("");
      return;
    }
    if (draftValue === null) {
      // Not a number: put the saved value back rather than send it.
      setDraft(persisted);
      return;
    }
    onCommit(formatReading(draftValue));
  };

  return (
    <>
      <input
        aria-label={ariaLabel}
        aria-invalid={shownStatus === "Failed" || undefined}
        aria-describedby={statusText ? statusId : undefined}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Spreadsheet entry: typing into a filled cell replaces its value.
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        className={cn(
          "block h-full min-h-12 w-full min-w-[104px] text-center text-base tabular-nums outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
          verdictFill(shownStatus),
          // Room for the ↑ / ↓ marker, so a long reading never runs under it.
          deviation && "pl-1 pr-5"
        )}
      />
      {deviation && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-red-600 dark:text-red-400"
        >
          {deviation === "above" ? "↑" : "↓"}
        </span>
      )}
      {statusText ? (
        <span id={statusId} className="sr-only">
          {statusText}
        </span>
      ) : null}
    </>
  );
}

function PassFailCell({
  label,
  disabled,
  status,
  passLabel,
  failLabel,
  onToggle
}: {
  label: string;
  disabled: boolean;
  status: string | undefined;
  passLabel: string;
  failLabel: string;
  onToggle: (passed: "true" | "false") => void;
}) {
  // A closed lot shows the recorded result as text, not as dead buttons.
  if (disabled) {
    return (
      <div
        className={cn(
          "flex h-full min-h-12 items-center justify-center gap-1 text-sm",
          status === "Passed" && "text-emerald-600 dark:text-emerald-400",
          status === "Failed" &&
            "bg-red-500/10 font-semibold text-red-700 dark:text-red-400",
          status !== "Passed" &&
            status !== "Failed" &&
            "text-muted-foreground/50"
        )}
      >
        {status === "Passed" ? (
          <>
            <LuCheck className="size-4" aria-hidden />
            {passLabel}
          </>
        ) : status === "Failed" ? (
          <>
            <LuX className="size-4" aria-hidden />
            {failLabel}
          </>
        ) : (
          "—"
        )}
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-full min-h-12 items-stretch"
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={passLabel}
        aria-pressed={status === "Passed"}
        data-verdict="true"
        onClick={() => onToggle("true")}
        className={cn(
          "flex flex-1 items-center justify-center border-r border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          status === "Passed"
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        <LuCheck className="size-5" />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label={failLabel}
        aria-pressed={status === "Failed"}
        data-verdict="false"
        onClick={() => onToggle("false")}
        className={cn(
          "flex flex-1 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          status === "Failed"
            ? "bg-red-500/15 text-red-600 dark:text-red-400"
            : "text-muted-foreground hover:bg-accent"
        )}
      >
        <LuX className="size-5" />
      </button>
    </div>
  );
}

export default InspectionMeasurementMatrix;
