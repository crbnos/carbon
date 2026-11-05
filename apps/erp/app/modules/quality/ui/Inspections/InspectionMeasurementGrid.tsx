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
  toast
} from "@carbon/react";
import type { InspectionGridLayout } from "@carbon/utils";
import {
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
const cellKey = (sampleIndex: number, featureId: string) =>
  `${sampleIndex}:${featureId}`;

// Mirrors RECENT_INSPECTION_GAUGE_LIMIT in packages/database/src/quality.ts
// (the server's "recently used" cap) — that module is server-only (Kysely), so
// it cannot be imported into this client component.
const RECENT_INSPECTION_GAUGE_LIMIT = 10;

// Synthetic feature id for the single pass/fail row shown when the lot has no
// inspection document. Its cells write the sample's status directly (via the
// sample route) rather than a per-feature measurement.
const OVERALL_ROW_ID = "__overall__";

// Opaque fills, so the Table's yellow "edited" tint never shows through.
function verdictFill(status: string | undefined) {
  switch (status) {
    case "Failed":
      return "bg-red-100 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300";
    case "Passed":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    default:
      return undefined;
  }
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
  samples,
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

  // Sample index -> sample id. Anonymous samples resolve lazily from save
  // responses; keyed by index because unsaved samples have no id yet. The ref
  // is the same map, read by queued saves that run after a render.
  const [sampleIdByColumn, setSampleIdByColumn] = useState<
    Record<number, string>
  >({});
  const sampleIdRef = useRef<Record<number, string>>({});
  useEffect(() => {
    setSampleIdByColumn((prev) => {
      const next = { ...prev };
      samples.forEach((sample, index) => {
        next[index] = sample.id;
      });
      sampleIdRef.current = { ...sampleIdRef.current, ...next };
      return next;
    });
  }, [samples]);

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
    : Math.min(lotSize, Math.max(maxSampleSize, knownSampleCount + 1));

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
  useEffect(() => {
    if (autoLayout !== null || columnCount === 0) return;
    setAutoLayout(
      defaultInspectionGridLayout({
        sampleCount: columnCount,
        characteristicCount: characteristics.length
      })
    );
  }, [autoLayout, columnCount, characteristics.length]);
  // A serial lot with no scanned sample has no part rows to show.
  const layout: InspectionGridLayout =
    columnCount === 0
      ? "byCharacteristic"
      : (layoutChoice ?? autoLayout ?? "byCharacteristic");
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
  const [sampleStatusByColumn, setSampleStatusByColumn] = useState<
    Record<number, string>
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
      const key = cellKey(sampleIndex, featureId);
      const optimistic = optimisticByCell[key];
      if (optimistic) return optimistic;
      const saved = statusByCell[key];
      if (saved) return saved;
      // The "Overall result" row has no measurement — its verdict is the
      // sample's own status (Pending shows as an untoggled cell).
      if (featureId === OVERALL_ROW_ID) {
        return samples[sampleIndex]?.status;
      }
      return measurementFor(sampleIdByColumn[sampleIndex], featureId)?.status;
    },
    [optimisticByCell, statusByCell, sampleIdByColumn, measurementFor, samples]
  );

  const cellValue = useCallback(
    (sampleIndex: number, featureId: string): number | null => {
      const key = cellKey(sampleIndex, featureId);
      if (key in valueByCell) return valueByCell[key] ?? null;
      const measurement = measurementFor(
        sampleIdByColumn[sampleIndex],
        featureId
      );
      return measurement?.value == null ? null : Number(measurement.value);
    },
    [valueByCell, sampleIdByColumn, measurementFor]
  );

  const sampleStatus = useCallback(
    (sampleIndex: number) =>
      sampleStatusByColumn[sampleIndex] ?? samples[sampleIndex]?.status,
    [sampleStatusByColumn, samples]
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
      const trackedEntityId = samples[sampleIndex]?.trackedEntityId;
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
    [inspectionId, samples, t]
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
      const key = cellKey(sampleIndex, characteristic.featureId);
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
          [key]: result.measurementStatus
        }));
        setSampleStatusByColumn((prev) => ({
          ...prev,
          [sampleIndex]: result.sampleStatus
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
        const sample = samples[sampleIndex];
        const row: GridRow = {
          rowKey: `sample-${sampleIndex}`,
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
  }, [layout, columnCount, samples, isSerial, characteristics, cellValue]);

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
            "-mx-4 -my-2 flex min-w-[64px] items-center justify-center gap-1 px-4 py-2 font-mono text-xs tabular-nums",
            verdictFill(status),
            value == null && "text-muted-foreground/60"
          )}
        >
          {value == null ? "—" : String(value)}
          {deviation && (
            <span
              title={
                deviation === "above"
                  ? t`Above the upper limit`
                  : t`Below the lower limit`
              }
            >
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
      return (
        <div
          data-entry-cell
          data-feature-id={characteristic.featureId}
          data-sample-index={sampleIndex}
          className="-mx-4 -my-2 flex justify-center px-1.5 py-1"
        >
          <div className="flex h-10 w-full min-w-[92px] max-w-[152px] items-stretch overflow-hidden rounded-lg border border-border bg-background">
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
                "flex flex-1 items-center justify-center transition-transform active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
                passed
                  ? "bg-emerald-500 text-white"
                  : "text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
              )}
            >
              <LuCheck className="h-5 w-5" />
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
                "flex flex-1 items-center justify-center border-l border-border transition-transform active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
                failed
                  ? "bg-red-500 text-white"
                  : "text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
              )}
            >
              <LuX className="h-5 w-5" />
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
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t`Pass all empty cells of ${characteristic.label}`}
          title={t`Pass all empty cells`}
          icon={<LuCheckCheck />}
          isDisabled={bulkProgress !== null || columnCount === 0}
          onClick={(event) => {
            event.stopPropagation();
            passAll(characteristicIndex);
          }}
        />
      );
    },
    [characteristics, isReadOnly, bulkProgress, columnCount, passAll, t]
  );

  const renderProgress = useCallback(
    (characteristic: Characteristic) => {
      const counts = featureCounts(characteristic);
      const exceeded = counts.failed >= characteristic.rejectionNumber;
      return (
        <Badge
          variant={
            exceeded
              ? "destructive"
              : counts.recorded >= characteristic.sampleSize &&
                  counts.failed <= characteristic.acceptanceNumber
                ? "green"
                : "secondary"
          }
          className="font-mono text-[0.625rem]"
          title={`n ${characteristic.sampleSize} · Ac ${characteristic.acceptanceNumber} · Re ${characteristic.rejectionNumber}`}
        >
          {counts.passed}/{characteristic.sampleSize}
          {counts.failed > 0 ? ` · ${counts.failed}F` : ""}
        </Badge>
      );
    },
    [featureCounts]
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
          cell: ({ row }) => {
            const status = sampleStatus(row.original.sampleIndex);
            return (
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
                <span className="max-w-[140px] truncate font-mono text-xs font-semibold">
                  {String(row.original.sampleLabel)}
                </span>
              </span>
            );
          }
        }
      ];
      characteristics.forEach((characteristic, characteristicIndex) => {
        const isActive = characteristic.featureId === activeFeatureId;
        cols.push({
          accessorKey: featureKey(characteristicIndex),
          header: () => (
            <div
              data-feature-header={characteristic.featureId}
              onClick={() =>
                hasFeatures && onActiveFeatureChange(characteristic.featureId)
              }
              className={cn(
                "-mx-2 flex min-w-[120px] max-w-[200px] flex-col gap-1 whitespace-normal rounded-md px-2 py-1 font-normal",
                isActive && "bg-accent"
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-foreground">
                  {characteristic.label}
                </span>
                {renderProgress(characteristic)}
                <span className="ml-auto">
                  {renderPassAll(characteristicIndex)}
                </span>
              </span>
              {characteristic.description && hasFeatures ? (
                <span
                  className="line-clamp-1 text-xs text-muted-foreground"
                  title={characteristic.description}
                >
                  {characteristic.description}
                </span>
              ) : null}
              {characteristic.limitsLabel || characteristic.specLabel ? (
                <span
                  className="whitespace-nowrap font-mono text-xs text-foreground"
                  title={characteristic.specLabel}
                >
                  {characteristic.limitsLabel ?? characteristic.specLabel}
                </span>
              ) : null}
              {hasFeatures ? (
                <div
                  data-gauge-picker
                  className="-mx-2 h-8 rounded-md border border-border"
                >
                  {renderGauge(characteristic)}
                </div>
              ) : null}
            </div>
          ),
          meta: {
            headerClassName: "justify-center",
            // CSV: the characteristic's label heads its column; a reading
            // exports its value, a go / no-go check its verdict.
            filterHeader: characteristic.label,
            exportValue: (row: GridRow) =>
              characteristic.isNumeric
                ? cellValue(row.sampleIndex, characteristic.featureId)
                : cellStatus(row.sampleIndex, characteristic.featureId)
          },
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
        cell: ({ row }) => {
          const characteristicIndex = row.original.characteristicIndex;
          const characteristic = characteristics[characteristicIndex]!;
          return (
            <div className="flex min-w-[220px] max-w-[300px] items-center gap-2 whitespace-normal">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold">
                {characteristic.label}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className="truncate text-xs font-medium"
                  title={characteristic.description ?? undefined}
                >
                  {characteristic.description ?? "—"}
                </span>
                {characteristic.limitsLabel || characteristic.specLabel ? (
                  <span
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={characteristic.specLabel}
                  >
                    {characteristic.limitsLabel ?? characteristic.specLabel}
                  </span>
                ) : null}
              </span>
              {renderPassAll(characteristicIndex)}
            </div>
          );
        }
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
      const sample = samples[i];
      cols.push({
        accessorKey: sampleKey(i),
        header: isSerial
          ? (sample?.trackedEntity?.readableId ?? `${i + 1}`)
          : `${i + 1}`,
        meta: {
          headerClassName: "justify-center",
          exportValue: (row: GridRow) => {
            const characteristic = characteristics[row.characteristicIndex];
            if (!characteristic) return null;
            return characteristic.isNumeric
              ? cellValue(i, characteristic.featureId)
              : cellStatus(i, characteristic.featureId);
          }
        },
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
    samples,
    isSerial,
    characteristics,
    hasFeatures,
    activeFeatureId,
    onActiveFeatureChange,
    sampleStatus,
    cellValue,
    cellStatus,
    renderReading,
    renderPassFail,
    renderPassAll,
    renderProgress,
    renderGauge,
    t
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
      if (event.key !== "Enter" && event.key !== "Tab") return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row][data-column]"
      );
      if (!cell || !gridRef.current?.contains(cell)) return;

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

      const entryColumnsForRow = (r: number): number[] => {
        const markers = gridRef.current?.querySelectorAll<HTMLElement>(
          `[data-row="${r}"][data-column] [data-entry-cell]`
        );
        const columnsSet = new Set<number>();
        markers?.forEach((marker) => {
          const column = marker
            .closest<HTMLElement>("[data-column]")
            ?.getAttribute("data-column");
          if (column != null) columnsSet.add(Number(column));
        });
        return [...columnsSet].sort((a, b) => a - b);
      };

      // Every entry cell carries a marker, the open editor included, so a
      // cell without one (characteristic, gauge, result) is not an entry cell.
      const entryColumns = entryColumnsForRow(rowIndex);
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
      let targetRow = rowIndex;
      let targetColumn: number | undefined = reverse
        ? entryColumns[position - 1]
        : entryColumns[position + 1];

      if (targetColumn === undefined) {
        // Wrap to the adjacent row.
        targetRow = rowIndex + (reverse ? -1 : 1);
        const nextColumns = entryColumnsForRow(targetRow);
        targetColumn = reverse
          ? nextColumns[nextColumns.length - 1]
          : nextColumns[0];
      }

      const target =
        targetColumn !== undefined
          ? gridRef.current?.querySelector<HTMLElement>(
              `[data-row="${targetRow}"][data-column="${targetColumn}"]`
            )
          : null;

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
    [isReadOnly]
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
              <Badge variant="destructive" className="tabular-nums">
                {t`Failed: ${failedReadings}`}
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
                  aria-label={t`One row per characteristic`}
                  title={t`One row per characteristic`}
                >
                  <LuRows3 className="mr-1.5 size-4" />
                  {t`By characteristic`}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="byPart"
                  aria-label={t`One row per part`}
                  title={t`One row per part`}
                >
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
