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
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

const cellKey = (sampleIndex: number, featureId: string) =>
  `${sampleIndex}:${featureId}`;

function verdictFill(status: string | undefined) {
  switch (status) {
    case "Passed":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Failed":
      return "bg-red-500/15 font-semibold text-red-600 dark:text-red-400";
    default:
      return "bg-transparent text-foreground hover:bg-muted/40 focus:bg-background";
  }
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
  toolbarActions
}: InspectionMeasurementMatrixProps) => {
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

  // The samples the matrix knows: the loader's plus those made by saves since.
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
  // Freeze the default once the grid has samples, so scanning more of them
  // never flips the layout under the inspector.
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

  // ── Cell state ────────────────────────────────────────────────────────────
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
    (characteristic: Characteristic) => {
      if (characteristic.isNumeric) return;
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
    [columnCount, cellStatus, knownSampleCount, runBulk]
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

  const sampleLabels = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, index) => {
        const sample = samples[index];
        // MES entity display convention (AssemblyView precedent): readableId,
        // else the first 8 characters of the entity id.
        const entityLabel =
          sample?.trackedEntity?.readableId ??
          sample?.trackedEntityId?.slice(0, 8);
        return isSerial && entityLabel ? entityLabel : `${index + 1}`;
      }),
    [columnCount, samples, isSerial]
  );

  // Spreadsheet-style entry (D8): Enter/Tab move to the next entry cell in
  // the row, wrapping to the next row; Shift+Tab moves back. Moving focus
  // blurs the input, which commits it.
  const tableRef = useRef<HTMLTableElement>(null);
  const onKeyDownCapture = useCallback((event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    // On a go / no-go cell, P records a pass and F a fail, then focus moves on.
    const verdict = verdictForKey(event);
    if (verdict && target.tagName === "BUTTON") {
      const cell = target.closest<HTMLElement>(
        "[data-entry-cell][data-attribute]"
      );
      if (!cell || !tableRef.current?.contains(cell)) return;
      event.preventDefault();
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
    // Enter on a Pass/Fail button presses it.
    if (event.key === "Enter" && target.tagName === "BUTTON") return;
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
  }, []);

  const renderPassAll = (characteristic: Characteristic) =>
    characteristic.isNumeric || isReadOnly ? null : (
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
          passAll(characteristic);
        }}
      />
    );

  const renderProgress = (characteristic: Characteristic) => {
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
        className="font-mono text-[0.625rem] tabular-nums"
        title={`n ${characteristic.sampleSize} · Ac ${characteristic.acceptanceNumber} · Re ${characteristic.rejectionNumber}`}
      >
        {counts.passed}/{characteristic.sampleSize}
        {counts.failed > 0 ? ` · ${counts.failed}F` : ""}
      </Badge>
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

  const renderEntryCell = (
    characteristic: Characteristic,
    sampleIndex: number
  ) => {
    const status = cellStatus(sampleIndex, characteristic.featureId);
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
            disabled={isReadOnly}
            status={status}
            spec={characteristic.spec}
            value={cellValue(sampleIndex, characteristic.featureId)}
            aboveLabel={t`Above the upper limit`}
            belowLabel={t`Below the lower limit`}
            onCommit={(value) =>
              persistCell(characteristic, sampleIndex, { value })
            }
          />
        ) : (
          <PassFailCell
            disabled={isReadOnly}
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

  const toolbar = (
    <div className="flex min-h-10 flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">
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
              <LuRows3 className="size-4 md:mr-1.5" />
              <span className="max-md:sr-only">{t`By characteristic`}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="byPart" title={t`One row per part`}>
              <LuTableProperties className="size-4 md:mr-1.5" />
              <span className="max-md:sr-only">{t`By part`}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {toolbarActions}
      </span>
    </div>
  );

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
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-sm font-semibold text-foreground tabular-nums">
          {characteristic.label}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className="line-clamp-2 text-sm font-semibold text-foreground"
          title={characteristic.description ?? undefined}
        >
          {characteristic.description ??
            (characteristic.featureId === OVERALL_ROW_ID
              ? characteristic.label
              : "—")}
        </div>
        {characteristic.limitsLabel || characteristic.specLabel ? (
          <div
            className="font-mono text-xs text-foreground"
            title={characteristic.specLabel}
          >
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
                    >
                      {characteristicHeader(characteristic)}
                      {hasFeatures ? (
                        // The click must not toggle the active column.
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
                const status =
                  sampleStatusByColumn[sampleIndex] ??
                  samples[sampleIndex]?.status;
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
                        <span className="max-w-[140px] truncate font-mono text-xs font-semibold">
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
                    >
                      {characteristicHeader(characteristic)}
                      {hasFeatures ? (
                        // Phones: the gauge sits under the characteristic.
                        // The click must not toggle the active row.
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

// The keys that record a go / no-go verdict on a focused cell.
function verdictForKey(event: React.KeyboardEvent): "true" | "false" | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "p") return "true";
  if (key === "f") return "false";
  return null;
}

function NumericCell({
  disabled,
  status,
  spec,
  value,
  aboveLabel,
  belowLabel,
  onCommit
}: {
  disabled: boolean;
  status: string | undefined;
  spec: MeasurementFeatureSpec | null;
  value: number | null;
  aboveLabel: string;
  belowLabel: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));

  // Re-sync when the persisted value changes underneath (e.g. save response).
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  const persisted = value == null ? "" : String(value);
  const isDirty = draft.trim() !== persisted;

  // While typing, the draft's own verdict (D2); a draft that does not parse
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
    onCommit(String(draftValue));
  };

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={cn(
          "block h-full min-h-12 w-full min-w-[88px] text-center font-mono text-base tabular-nums outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
          verdictFill(shownStatus)
        )}
      />
      {deviation && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-red-600 dark:text-red-400">
          <span aria-hidden>{deviation === "above" ? "↑" : "↓"}</span>
          <span className="sr-only">
            {deviation === "above" ? aboveLabel : belowLabel}
          </span>
        </span>
      )}
    </>
  );
}

function PassFailCell({
  disabled,
  status,
  passLabel,
  failLabel,
  onToggle
}: {
  disabled: boolean;
  status: string | undefined;
  passLabel: string;
  failLabel: string;
  onToggle: (passed: "true" | "false") => void;
}) {
  return (
    <div className="flex h-full min-h-12 items-stretch">
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
