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
import {
  Badge,
  cn,
  IconButton,
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
  // Rendered in the Table header (the collapse/expand toggle and the drawing
  // toggle when the grid sits under a drawing).
  primaryAction?: React.ReactNode;
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
  primaryAction
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
  const [sampleIdByColumn, setSampleIdByColumn] = useState<
    Record<number, string>
  >(() =>
    placeSamples(
      {},
      samples.map((sample) => sample.id)
    )
  );
  const sampleIdRef = useRef<Record<number, string>>(sampleIdByColumn);
  useEffect(() => {
    setSampleIdByColumn((prev) => {
      const next = placeSamples(
        prev,
        samples.map((sample) => sample.id)
      );
      sampleIdRef.current = next;
      return next;
    });
  }, [samples]);
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

  // The samples the grid knows: the loader's plus those made by saves since.
  const knownSampleCount = Math.max(
    samples.length,
    ...Object.keys(sampleIdByColumn).map((index) => Number(index) + 1)
  );

  // Serial lots get one sample per scanned entity; non-serial lots show up to
  // the max required n plus one spare, growing as samples are used, capped at
  // the lot size. n is a minimum — recording MORE is always allowed.
  const columnCount = isSerial
    ? samples.length
    : Math.min(
        lotSize,
        // A read-only grid takes no new sample, so it shows no spare one.
        Math.max(maxSampleSize, knownSampleCount + (isReadOnly ? 0 : 1))
      );

  // ── Layout ────────────────────────────────────────────────────────────────
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
  // Freeze the default once the grid has samples, so scanning more of them
  // never flips the layout under the inspector.
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

  // ── Cell state ────────────────────────────────────────────────────────────
  // Server status + value per cell, seeded from the loader and patched by save
  // responses (per-cell saves are quiet — no revalidation). The value mirror
  // matters because the rows memo rebuilds from loader data on every
  // local-state change, which would otherwise blank the cell until a reload.
  const [statusByCell, setStatusByCell] = useState<Record<string, string>>({});
  const [valueByCell, setValueByCell] = useState<Record<string, number | null>>(
    {}
  );
  // The client verdict of a cell whose save is in flight (D2): shown at once,
  // replaced by the server's when it answers.
  const [optimisticByCell, setOptimisticByCell] = useState<
    Record<string, Verdict>
  >({});
  const [sampleStatusById, setSampleStatusById] = useState<
    Record<string, string>
  >({});

  const measurementFor = useCallback(
    (sampleId: string | undefined, featureId: string) =>
      sampleId
        ? measurements.find(
            (m) =>
              m.inspectionSampleId === sampleId &&
              m.inspectionFeatureId === featureId
          )
        : undefined,
    [measurements]
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

  // ── Saving ────────────────────────────────────────────────────────────────
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
    [inspectionId, t]
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
    [inspectionId, sampleById, t]
  );

  // Saves of one sample run one at a time: the first save of an anonymous
  // sample creates it, and the next must reuse its id, not make a second one.
  const sampleQueue = useRef<Record<number, Promise<unknown>>>({});

  const persistCell = useCallback(
    (
      characteristic: Characteristic,
      sampleIndex: number,
      payload: CellPayload
    ): Promise<MeasurementSaveResult | null> => {
      const featureId = characteristic.featureId;
      const key = `${sampleIdRef.current[sampleIndex] ?? newSampleKey(sampleIndex)}:${featureId}`;
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
        const result =
          characteristic.featureId === OVERALL_ROW_ID
            ? await persistOverall(sampleIndex, payload)
            : await persistMeasurement(characteristic, sampleIndex, payload);

        setOptimisticByCell((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        if (!result) {
          // The server refused: show the last value it accepted again.
          setValueByCell((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          return null;
        }

        // From here the cell is keyed by the sample the server saved it on.
        const savedKey = `${result.sampleId}:${featureId}`;
        if (savedKey !== key || payload.value !== undefined) {
          setValueByCell((prev) => {
            const next = { ...prev };
            delete next[key];
            if (payload.value !== undefined) next[savedKey] = numericValue;
            return next;
          });
        }

        sampleIdRef.current = {
          ...sampleIdRef.current,
          [sampleIndex]: result.sampleId
        };
        setSampleIdByColumn((prev) =>
          prev[sampleIndex] === result.sampleId
            ? prev
            : { ...prev, [sampleIndex]: result.sampleId }
        );
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
      };

      const queued = (sampleQueue.current[sampleIndex] ?? Promise.resolve())
        .catch(() => undefined)
        .then(run);
      sampleQueue.current[sampleIndex] = queued;
      return queued;
    },
    [persistMeasurement, persistOverall, onMeasurementSaved]
  );

  // ── Bulk entry (Pass all, paste) ──────────────────────────────────────────
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // One save at a time, in sample order; stops at the first refused save.
  const runBulk = useCallback(
    async (
      cells: {
        characteristic: Characteristic;
        sampleIndex: number;
        payload: CellPayload;
      }[],
      skipped = 0
    ) => {
      if (cells.length === 0) {
        if (skipped > 0) toast.error(t`No cell could take the pasted values`);
        return;
      }
      setBulkProgress({ done: 0, total: cells.length });
      let done = 0;
      for (const cell of cells) {
        const result = await persistCell(
          cell.characteristic,
          cell.sampleIndex,
          cell.payload
        );
        if (!result) break;
        done += 1;
        setBulkProgress({ done, total: cells.length });
      }
      setBulkProgress(null);
      if (done === cells.length) {
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
      const targets = passAllTargets({
        statuses,
        sampleSize: characteristic.sampleSize,
        existingSamples: knownSampleCount,
        columnCount
      });
      runBulk(
        targets.map((sampleIndex) => ({
          characteristic,
          sampleIndex,
          payload: { passed: "true" as const }
        }))
      );
    },
    [characteristics, columnCount, cellStatus, knownSampleCount, runBulk]
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
        sampleLimit: isSerial ? samples.length : lotSize
      });
      let skipped = plan.outOfRange;
      const cells: {
        characteristic: Characteristic;
        sampleIndex: number;
        payload: CellPayload;
      }[] = [];
      for (const planned of plan.cells) {
        const characteristic = characteristics[planned.characteristicIndex]!;
        if (characteristic.isNumeric) {
          const value = parseMeasurementToken(planned.token);
          if (value === null) skipped += 1;
          else
            cells.push({
              characteristic,
              sampleIndex: planned.sampleIndex,
              payload: { value: String(value) }
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
      samples.length,
      lotSize,
      runBulk
    ]
  );

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
            value: value === "" || value == null ? "" : String(value)
          })
        : null;
      return {
        data: null,
        error: result ? null : { message: t`Failed to save measurement` }
      } as unknown as PostgrestSingleResponse<unknown>;
    },
    [characteristics, persistCell, t]
  );

  // ── Gauges ────────────────────────────────────────────────────────────────
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

  // ── Counts ────────────────────────────────────────────────────────────────
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

  // ── Rows ──────────────────────────────────────────────────────────────────
  const rows = useMemo<GridRow[]>(() => {
    if (layout === "byPart") {
      return Array.from({ length: columnCount }, (_, sampleIndex) => {
        const sample = sampleAt(sampleIndex);
        const row: GridRow = {
          // Keyed by sample, so the Table's pending edits follow the sample.
          rowKey: sampleIdByColumn[sampleIndex] ?? newSampleKey(sampleIndex),
          characteristicIndex: -1,
          sampleIndex,
          sampleLabel: isSerial
            ? (sample?.trackedEntity?.readableId ?? `${sampleIndex + 1}`)
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
    sampleIdByColumn,
    isSerial,
    characteristics,
    cellValue
  ]);

  // ── Cell renderers ────────────────────────────────────────────────────────
  // A numeric reading: filled red with ↑ / ↓ when out of tolerance (D3).
  const renderReading = useCallback(
    (characteristic: Characteristic, sampleIndex: number) => {
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
            // h-11 is the row height: the fill meets the cell's edges.
            "-mx-4 -my-2 flex h-11 min-w-[64px] items-center justify-center gap-1 px-2 text-sm tabular-nums",
            verdictFill(status),
            value == null && "text-muted-foreground/50"
          )}
        >
          {value == null ? "—" : String(value)}
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
      );
    },
    [cellValue, cellStatus, t]
  );

  // Attribute pass/fail: a segmented, color-coded toggle. Each half is a
  // full-height tap target (shop-floor friendly), green ✓ pass / red ✗ fail,
  // filled when selected and tinted on hover otherwise. Shared by the display
  // cell AND the editable cell so opening a cell (keyboard nav / focus) keeps
  // the same buttons on screen instead of swapping them for an empty editor.
  const renderPassFail = useCallback(
    (characteristic: Characteristic, sampleIndex: number) => {
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
              "-mx-4 -my-2 flex h-11 items-center justify-center gap-1 px-2 text-sm",
              verdictFill(status),
              passed && "text-emerald-700 dark:text-emerald-400",
              !passed && !failed && "text-muted-foreground/50"
            )}
          >
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
        );
      }
      return (
        <div
          data-entry-cell
          data-attribute
          data-feature-id={characteristic.featureId}
          data-sample-index={sampleIndex}
          className="-mx-4 -my-2 flex justify-center px-1.5 py-1"
        >
          {/* h-9 + py-1 is the 44 px row height, the same as a reading's. */}
          <div className="flex h-9 w-full min-w-[88px] max-w-[136px] items-stretch overflow-hidden rounded-md border border-border bg-card">
            <button
              type="button"
              aria-label={t`Pass`}
              aria-pressed={passed}
              disabled={isReadOnly}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                persistCell(characteristic, sampleIndex, { passed: "true" });
              }}
              className={cn(
                "flex flex-1 items-center justify-center transition-[background-color,color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
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
              aria-pressed={failed}
              disabled={isReadOnly}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                persistCell(characteristic, sampleIndex, { passed: "false" });
              }}
              className={cn(
                "flex flex-1 items-center justify-center border-l border-border transition-[background-color,color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
                failed
                  ? "bg-red-500/15 text-red-700 dark:text-red-400"
                  : "text-muted-foreground/60 hover:bg-accent hover:text-foreground"
              )}
            >
              <LuX className="size-4" />
            </button>
          </div>
        </div>
      );
    },
    [cellStatus, isReadOnly, persistCell, t]
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
            <span className="flex shrink-0 items-center gap-1">
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
          <TooltipContent>
            {t`Sample size ${characteristic.sampleSize} · accept up to ${characteristic.acceptanceNumber} failed · reject at ${characteristic.rejectionNumber}`}
          </TooltipContent>
        </Tooltip>
      );
    },
    [featureCounts, t]
  );

  // A characteristic's identity, the same in both layouts: its balloon number,
  // name and limits (the plan's own notation in the tooltip).
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
    (characteristic: Characteristic) => (
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
    ),
    [gauges, recentGauges, gaugeFor, isReadOnly, persistGauge]
  );

  // ── Columns ───────────────────────────────────────────────────────────────
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
            <div
              data-feature-header={characteristic.featureId}
              onClick={() =>
                hasFeatures && onActiveFeatureChange(characteristic.featureId)
              }
              className="flex w-full min-w-[180px] flex-col gap-1.5 whitespace-normal py-1 font-normal"
            >
              {renderCharacteristic(characteristic, characteristicIndex)}
              <div className="flex items-center gap-2">
                {renderProgress(characteristic)}
              </div>
              {hasFeatures &&
              (!isReadOnly || gaugeFor(characteristic.featureId)) ? (
                <div
                  data-gauge-picker
                  className={cn(
                    "h-8 w-full max-w-72 overflow-hidden rounded-md",
                    // Read-only, the gauge is a fact, not a field.
                    !isReadOnly && "border border-border"
                  )}
                >
                  {renderGauge(characteristic)}
                </div>
              ) : null}
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
        : []),
      {
        id: "progress",
        header: t`Result`,
        cell: ({ row }) =>
          renderProgress(characteristics[row.original.characteristicIndex]!)
      }
    ];

    for (let i = 0; i < columnCount; i++) {
      const sample = sampleAt(i);
      cols.push({
        accessorKey: sampleKey(i),
        header: isSerial
          ? (sample?.trackedEntity?.readableId ?? `${i + 1}`)
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
    t,
    isReadOnly,
    gaugeFor
  ]);

  // Numeric cells edit through the shared Editable machinery, coloured live
  // while the inspector types; attribute cells render the SAME Pass/Fail
  // control as the display cell, so opening a cell keeps the buttons on screen.
  const editableComponents = useMemo(() => {
    const components: Record<
      string,
      (props: EditableTableCellComponentProps<GridRow>) => JSX.Element
    > = {};
    const keys =
      layout === "byPart"
        ? characteristics.map((_, characteristicIndex) =>
            featureKey(characteristicIndex)
          )
        : Array.from({ length: columnCount }, (_, i) => sampleKey(i));
    for (const key of keys) {
      const NumberEditor = EditableNumber<GridRow>(
        onCellEdit,
        { formatOptions: { maximumFractionDigits: 6 } },
        {
          clearable: true,
          liveInputClassName: (row, text) => {
            const { characteristicIndex } = cellAt(key, row);
            const spec = characteristics[characteristicIndex]?.spec;
            const value = parseMeasurementToken(text);
            if (!spec || value === null) return undefined;
            return verdictFill(valuateMeasurement(spec, value));
          }
        }
      );
      components[key] = (props) => {
        const { characteristicIndex, sampleIndex } = cellAt(key, props.row);
        const characteristic = characteristics[characteristicIndex];
        if (!characteristic) return <span />;
        if (!characteristic.isNumeric) {
          return renderPassFail(characteristic, sampleIndex);
        }
        // The marker keeps the cell recognisable as an entry cell while its
        // editor is open (the display cell's marker is unmounted).
        return (
          <div
            data-entry-cell
            data-feature-id={characteristic.featureId}
            data-sample-index={sampleIndex}
            className="contents"
          >
            <NumberEditor {...props} />
          </div>
        );
      };
    }
    return components;
  }, [layout, characteristics, columnCount, onCellEdit, renderPassFail]);

  const gridRef = useRef<HTMLDivElement>(null);

  // Balloon click direction: bring the active characteristic into view.
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
  // row, wrapping to the next row; Shift+Tab reverses (D8). By characteristic
  // that walks a characteristic's samples; by part, a part's characteristics.
  // Entry cells are resolved live from the DOM via the `data-entry-cell` markers.
  const onGridKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (isReadOnly) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row][data-column]"
      );
      if (!cell || !gridRef.current?.contains(cell)) return;

      // A selected go / no-go cell: P records a pass, F a fail, then the
      // selection moves on as Enter would — keyboard-only entry never stalls.
      const verdict = verdictForKey(event);
      const attributeCell = cell.querySelector<HTMLElement>(
        "[data-entry-cell][data-attribute]"
      );
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
          persistCell(characteristic, sampleIndex, { passed: verdict });
          const next = nextEntryCell(cell, false);
          if (next) {
            next.scrollIntoView({ block: "nearest", inline: "nearest" });
            next.click();
          }
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

      const rowIndex = Number(cell.getAttribute("data-row"));
      const currentColumn = Number(cell.getAttribute("data-column"));

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
      const target = nextEntryCell(cell, reverse);

      // Let Tab exit the grid at the boundary rather than trapping focus.
      if (event.key === "Tab" && !target) {
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (active?.tagName === "INPUT") active.blur(); // commit before moving
      if (target) {
        go(target);
      } else {
        cell.focus();
      }
    },
    [isReadOnly, characteristics, persistCell]
  );

  return (
    <div
      ref={gridRef}
      onKeyDownCapture={onGridKeyDownCapture}
      onPasteCapture={onPasteCapture}
      onClickCapture={(event) => {
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
      className="flex h-full min-h-0 w-full flex-col"
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
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {hasFeatures
                ? `${t`Characteristics`} (${characteristics.length})`
                : t`Result`}
            </span>
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

// The keys that record a go / no-go verdict on a selected cell.
function verdictForKey(event: React.KeyboardEvent): "true" | "false" | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "p") return "true";
  if (key === "f") return "false";
  return null;
}

// The entry cells of one row of the grid, in column order.
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
