// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, cn, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
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

type FeatureGridRow = {
  featureId: string;
  label: string;
  description: string | null;
  pageNumber: number;
  isNumeric: boolean;
  specLabel: string;
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
  gaugeTypeId: string | null;
  gaugeTypeName: string | null;
} & Record<string, unknown>;

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
  // Lot size caps how many sample columns can exist — a feature's n is the
  // required minimum, but the inspector may record up to the whole lot.
  lotSize: number;
  // Lot-level acceptance/rejection numbers, used only for the synthetic
  // "Overall result" row shown when the lot has no inspection-document features.
  lotAcceptanceNumber: number;
  lotRejectionNumber: number;
  activeFeatureId: string | null;
  onActiveFeatureChange: (id: string | null) => void;
  onMeasurementSaved: (result: MeasurementSaveResult) => void;
  // Rendered in the Table header (e.g. the collapse/expand toggle when the
  // grid is the bottom panel of the execution view).
  primaryAction?: React.ReactNode;
};

const sampleKey = (columnIndex: number) => `sample-${columnIndex}`;

// Mirrors RECENT_INSPECTION_GAUGE_LIMIT in packages/database/src/quality.ts
// (the server's "recently used" cap) — that module is server-only (Kysely), so
// it cannot be imported into this client component.
const RECENT_INSPECTION_GAUGE_LIMIT = 10;

// Synthetic feature id for the single pass/fail row shown when the lot has no
// inspection document. Its cells write the sample's status directly (via the
// sample route) rather than a per-feature measurement.
const OVERALL_ROW_ID = "__overall__";

function parseSpecNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

// Features x samples measurement grid (1factory "Spreadsheet View"). Built on
// the shared Table's inline-editing machinery — the same pattern as
// InventoryCountLines, with N editable sample columns instead of one.
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
  // the grid collapses to a single "Overall result" pass/fail row per sample.
  const hasFeatures = liveFeatures.length > 0;

  // Column model: serial lots get one column per scanned sample; non-serial
  // lots pre-create columns up to the max required n plus one spare, growing
  // as columns are used, capped at the lot size (sample rows are created
  // server-side on the first measurement into a column). n is a minimum —
  // recording MORE than n samples is always allowed, up to the full lot.
  const columnCount = isSerial
    ? samples.length
    : Math.min(lotSize, Math.max(maxSampleSize, samples.length + 1));

  // Column index -> sample id. Anonymous columns resolve lazily from save
  // responses; keyed by index because unsaved columns have no id yet.
  const [sampleIdByColumn, setSampleIdByColumn] = useState<
    Record<number, string>
  >({});
  useEffect(() => {
    setSampleIdByColumn((prev) => {
      const next = { ...prev };
      samples.forEach((sample, index) => {
        next[index] = sample.id;
      });
      return next;
    });
  }, [samples]);

  // Measurement status + value per cell, seeded from the loader and patched by
  // save responses (per-cell saves are quiet — no revalidation). The value
  // mirror matters because the rows memo rebuilds from loader data on every
  // local-state change, which would otherwise discard the Table's in-place
  // patch and blank the cell until a reload.
  const [statusByCell, setStatusByCell] = useState<Record<string, string>>({});
  const [valueByCell, setValueByCell] = useState<Record<string, number | null>>(
    {}
  );
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
    (columnIndex: number, featureId: string): string | undefined => {
      const override = statusByCell[`${columnIndex}:${featureId}`];
      if (override) return override;
      // The "Overall result" row has no measurement — its verdict is the
      // sample's own status (Pending shows as an untoggled cell).
      if (featureId === OVERALL_ROW_ID) {
        return samples[columnIndex]?.status;
      }
      return measurementFor(sampleIdByColumn[columnIndex], featureId)?.status;
    },
    [statusByCell, sampleIdByColumn, measurementFor, samples]
  );

  // Document-driven cell: record a per-feature measurement.
  const persistMeasurement = useCallback(
    async (
      row: FeatureGridRow,
      columnIndex: number,
      payload: { value?: string; passed?: "true" | "false" }
    ): Promise<MeasurementSaveResult | null> => {
      const formData = new FormData();
      formData.set("inspectionId", inspectionId);
      const sampleId = sampleIdByColumn[columnIndex];
      if (sampleId) formData.set("sampleId", sampleId);
      formData.set("inspectionFeatureId", row.featureId);
      if (payload.value !== undefined) formData.set("value", payload.value);
      if (payload.passed !== undefined) formData.set("passed", payload.passed);

      const response = await fetch(
        path.to.inspectionMeasurement(inspectionId),
        { method: "post", body: formData }
      );
      const body = (await response.json().catch(() => null)) as {
        data?: {
          sampleId: string;
          measurementId: string;
          measurementStatus: string;
          sampleStatus: string;
        } | null;
        error?: { message: string } | null;
      } | null;

      if (!response.ok || !body?.data || body.error) {
        toast.error(body?.error?.message ?? t`Failed to save measurement`);
        return null;
      }

      return {
        sampleId: body.data.sampleId,
        measurementId: body.data.measurementId,
        measurementStatus: body.data
          .measurementStatus as MeasurementSaveResult["measurementStatus"],
        sampleStatus: body.data
          .sampleStatus as MeasurementSaveResult["sampleStatus"],
        inspectionFeatureId: row.featureId,
        columnIndex,
        value:
          payload.value !== undefined && payload.value !== ""
            ? Number(payload.value)
            : null,
        passed: payload.passed !== undefined ? payload.passed === "true" : null
      };
    },
    [inspectionId, sampleIdByColumn, t]
  );

  // No-document cell: set the sample's Pass/Fail status directly. Serial
  // columns already carry a scanned tracked entity (upsert by it); anonymous
  // columns update in place by sampleId once one exists.
  const persistOverall = useCallback(
    async (
      columnIndex: number,
      payload: { passed?: "true" | "false" }
    ): Promise<MeasurementSaveResult | null> => {
      const status = payload.passed === "true" ? "Passed" : "Failed";
      const formData = new FormData();
      formData.set("inspectionId", inspectionId);
      formData.set("status", status);
      formData.set("quiet", "true");
      const sampleId = sampleIdByColumn[columnIndex];
      if (sampleId) formData.set("sampleId", sampleId);
      const trackedEntityId = samples[columnIndex]?.trackedEntityId;
      if (trackedEntityId) formData.set("trackedEntityId", trackedEntityId);

      const response = await fetch(
        `${path.to.inspection(inspectionId)}/sample`,
        { method: "post", body: formData }
      );
      const body = (await response.json().catch(() => null)) as {
        sampleId?: string;
        error?: { message: string } | null;
      } | null;

      if (!response.ok || !body?.sampleId || body.error) {
        toast.error(body?.error?.message ?? t`Failed to save result`);
        return null;
      }

      return {
        sampleId: body.sampleId,
        measurementId: "",
        measurementStatus: status,
        sampleStatus: status,
        inspectionFeatureId: OVERALL_ROW_ID,
        columnIndex,
        value: null,
        passed: status === "Passed"
      };
    },
    [inspectionId, sampleIdByColumn, samples, t]
  );

  const persistCell = useCallback(
    async (
      row: FeatureGridRow,
      columnIndex: number,
      payload: { value?: string; passed?: "true" | "false" }
    ): Promise<MeasurementSaveResult | null> => {
      // The "Overall result" row (no-document lots) sets the sample's status
      // directly through the sample route instead of recording a measurement.
      const result =
        row.featureId === OVERALL_ROW_ID
          ? await persistOverall(columnIndex, payload)
          : await persistMeasurement(row, columnIndex, payload);
      if (!result) return null;

      setSampleIdByColumn((prev) =>
        prev[columnIndex] === result.sampleId
          ? prev
          : { ...prev, [columnIndex]: result.sampleId }
      );
      setStatusByCell((prev) => ({
        ...prev,
        [`${columnIndex}:${row.featureId}`]: result.measurementStatus
      }));
      setValueByCell((prev) => ({
        ...prev,
        [`${columnIndex}:${row.featureId}`]: result.value
      }));
      onMeasurementSaved(result);
      return result;
    },
    [persistMeasurement, persistOverall, onMeasurementSaved]
  );

  // EditableNumber-compatible mutation for numeric cells.
  const onCellEdit = useCallback(
    async (
      accessorKey: string,
      value: unknown,
      row: FeatureGridRow
    ): Promise<PostgrestSingleResponse<unknown>> => {
      const columnIndex = Number(accessorKey.replace("sample-", ""));
      const result = await persistCell(row, columnIndex, {
        value: value === "" || value == null ? "" : String(value)
      });
      return {
        data: null,
        error: result ? null : { message: t`Failed to save measurement` }
      } as unknown as PostgrestSingleResponse<unknown>;
    },
    [persistCell, t]
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

  const rows = useMemo<FeatureGridRow[]>(() => {
    if (!hasFeatures) {
      // Single synthetic pass/fail row for lots with no inspection document.
      return [
        {
          featureId: OVERALL_ROW_ID,
          label: "1",
          description: t`Overall result`,
          pageNumber: 1,
          isNumeric: false,
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
      const isNumeric =
        feature.type === "Measurement" &&
        parseSpecNumber(feature.nominalValue) !== null;
      const spec = isNumeric
        ? [
            feature.nominalValue,
            feature.tolerancePlus != null || feature.toleranceMinus != null
              ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
              : null,
            feature.unit
          ]
            .filter(Boolean)
            .join(" ")
        : (feature.nominalValue ?? "");

      const row: FeatureGridRow = {
        featureId: feature.id,
        label: feature.label,
        description: feature.description,
        pageNumber: feature.pageNumber ?? 1,
        isNumeric,
        specLabel: spec,
        sampleSize: lotFeature.sampleSize,
        acceptanceNumber: lotFeature.acceptanceNumber,
        rejectionNumber: lotFeature.rejectionNumber,
        gaugeTypeId: feature.gaugeTypeId ?? null,
        gaugeTypeName: feature.gaugeType?.name ?? null
      };
      for (let i = 0; i < columnCount; i++) {
        const override = valueByCell[`${i}:${feature.id}`];
        const measurement = measurementFor(sampleIdByColumn[i], feature.id);
        row[sampleKey(i)] =
          override !== undefined ? override : (measurement?.value ?? null);
      }
      return row;
    });
  }, [
    hasFeatures,
    liveFeatures,
    columnCount,
    sampleIdByColumn,
    valueByCell,
    measurementFor,
    maxSampleSize,
    lotAcceptanceNumber,
    lotRejectionNumber,
    t
  ]);

  // Pass/fail chip counts per feature (loader data + local overrides).
  const featureCounts = useCallback(
    (row: FeatureGridRow) => {
      let passed = 0;
      let failed = 0;
      for (let i = 0; i < columnCount; i++) {
        const status = cellStatus(i, row.featureId);
        if (status === "Passed") passed += 1;
        if (status === "Failed") failed += 1;
      }
      return { passed, failed, recorded: passed + failed };
    },
    [columnCount, cellStatus]
  );

  // Attribute pass/fail: a segmented, color-coded toggle. Each half is a
  // full-height tap target (shop-floor friendly), green ✓ pass / red ✗ fail,
  // filled when selected and tinted on hover otherwise. Shared by the display
  // cell AND the editable cell so opening a cell (keyboard nav / focus) keeps
  // the same buttons on screen instead of swapping them for an empty editor.
  const renderPassFail = useCallback(
    (original: FeatureGridRow, i: number) => {
      const status = cellStatus(i, original.featureId);
      const passed = status === "Passed";
      const failed = status === "Failed";
      return (
        <div
          data-sample-col={i}
          className="-mx-4 -my-2 flex justify-center px-1.5 py-1"
        >
          {/* Negative margins cancel the cell's px-4 py-2 so the segmented
              control fills the full cell for a large, finger-friendly target;
              a shared divider splits pass / fail. */}
          <div className="flex h-10 w-full min-w-[92px] max-w-[152px] items-stretch overflow-hidden rounded-lg border border-border bg-background">
            <button
              type="button"
              aria-label={t`Pass`}
              aria-pressed={passed}
              disabled={isReadOnly}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                persistCell(original, i, { passed: "true" });
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
                persistCell(original, i, { passed: "false" });
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

  const columns = useMemo<ColumnDef<FeatureGridRow>[]>(() => {
    const cols: ColumnDef<FeatureGridRow>[] = [
      {
        accessorKey: "label",
        header: "#",
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold">
            {row.original.label}
          </span>
        )
      },
      {
        accessorKey: "description",
        header: t`Characteristic`,
        cell: ({ row }) => (
          <span
            className="line-clamp-2 max-w-[180px] text-xs max-md:whitespace-normal"
            title={row.original.description ?? undefined}
          >
            {row.original.description ?? "—"}
          </span>
        ),
        meta: { mobile: "P1" }
      },
      {
        accessorKey: "specLabel",
        header: t`Spec`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs">
            {row.original.specLabel || "—"}
          </span>
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
                  <InspectionGaugePicker
                    gauges={gauges}
                    characteristicLabel={row.original.label}
                    recentGaugeIds={recentGauges}
                    gaugeTypeId={row.original.gaugeTypeId}
                    gaugeTypeName={row.original.gaugeTypeName}
                    value={gaugeFor(row.original.featureId)}
                    isReadOnly={isReadOnly}
                    onChange={(gaugeId) =>
                      persistGauge(row.original.featureId, gaugeId)
                    }
                  />
                </div>
              )
            } satisfies ColumnDef<FeatureGridRow>
          ]
        : []),
      {
        accessorKey: "sampleSize",
        header: "n / Ac",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
            {row.original.sampleSize} / {row.original.acceptanceNumber}
          </span>
        )
      },
      {
        id: "progress",
        header: t`Result`,
        cell: ({ row }) => {
          const counts = featureCounts(row.original);
          const exceeded = counts.failed >= row.original.rejectionNumber;
          return (
            <Badge
              variant={
                exceeded
                  ? "destructive"
                  : counts.recorded >= row.original.sampleSize &&
                      counts.failed <= row.original.acceptanceNumber
                    ? "green"
                    : "secondary"
              }
              className="font-mono text-[10px]"
            >
              {counts.passed}/{row.original.sampleSize}
              {counts.failed > 0 ? ` · ${counts.failed}F` : ""}
            </Badge>
          );
        }
      }
    ];

    for (let i = 0; i < columnCount; i++) {
      const key = sampleKey(i);
      const sample = samples[i];
      const header = isSerial
        ? (sample?.trackedEntity?.readableId ?? `${i + 1}`)
        : `${i + 1}`;
      cols.push({
        accessorKey: key,
        header,
        meta: { headerClassName: "justify-center" },
        cell: ({ row }) => {
          const original = row.original;
          const status = cellStatus(i, original.featureId);
          if (original.isNumeric) {
            const value = original[key];
            return (
              <span
                data-sample-col={i}
                className={cn(
                  "block min-w-[48px] text-center font-mono text-xs tabular-nums",
                  status === "Failed" && "font-semibold text-red-500",
                  value == null && "text-muted-foreground/60"
                )}
              >
                {value == null ? "—" : String(value)}
              </span>
            );
          }
          // Attribute pass/fail toggle — shared with the editable cell so
          // focusing the cell keeps the buttons visible.
          return renderPassFail(original, i);
        }
      });
    }

    return cols;
  }, [
    columnCount,
    samples,
    isSerial,
    featureCounts,
    cellStatus,
    renderPassFail,
    hasFeatures,
    gauges,
    recentGauges,
    gaugeFor,
    isReadOnly,
    persistGauge,
    t
  ]);

  // Numeric sample cells edit through the shared Editable machinery; attribute
  // cells render the SAME Pass/Fail control as the display cell, so opening a
  // cell (single click, or keyboard nav that clicks the next cell) keeps the
  // buttons on screen instead of swapping them for an empty placeholder.
  const editableComponents = useMemo(() => {
    const components: Record<
      string,
      (props: EditableTableCellComponentProps<FeatureGridRow>) => JSX.Element
    > = {};
    for (let i = 0; i < columnCount; i++) {
      const key = sampleKey(i);
      const NumberEditor = EditableNumber<FeatureGridRow>(
        onCellEdit,
        { formatOptions: { maximumFractionDigits: 6 } },
        {
          clearable: true
        }
      );
      components[key] = (props) => {
        if (!props.row.isNumeric) {
          return renderPassFail(props.row, i);
        }
        // The marker keeps the cell recognisable as a sample column while
        // its editor is open (the display cell's marker is unmounted).
        return (
          <div data-sample-col={i} className="contents">
            <NumberEditor {...props} />
          </div>
        );
      };
    }
    return components;
  }, [columnCount, onCellEdit, renderPassFail]);

  const gridRef = useRef<HTMLDivElement>(null);

  // Balloon click direction: scroll the active feature's row into view.
  useEffect(() => {
    if (!activeFeatureId) return;
    const index = rows.findIndex((r) => r.featureId === activeFeatureId);
    if (index < 0) return;
    gridRef.current
      ?.querySelector(`[data-row="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeFeatureId, rows]);

  // Spreadsheet-style entry across the sample columns: Enter/Tab advance to
  // the next sample cell in the row, wrapping to the next row; Shift+Tab
  // reverses. Adapted from InventoryCountLines' capture-phase model — sample
  // columns are resolved live from the DOM via the `data-sample-col` markers.
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

      const sampleColumnsForRow = (r: number): number[] => {
        const markers = gridRef.current?.querySelectorAll<HTMLElement>(
          `[data-row="${r}"][data-column] [data-sample-col]`
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

      // Every sample cell carries a marker, the open editor included, so a
      // cell without one (label, spec, gauge, …) is not a sample column.
      const columns = sampleColumnsForRow(rowIndex);
      if (columns.length === 0) return;

      const active = document.activeElement as HTMLElement | null;

      // From a non-sample cell, jump into the row's first sample cell.
      const position = columns.indexOf(currentColumn);
      if (position < 0) {
        event.preventDefault();
        event.stopPropagation();
        gridRef.current
          ?.querySelector<HTMLElement>(
            `[data-row="${rowIndex}"][data-column="${columns[0]}"]`
          )
          ?.click();
        return;
      }

      const reverse = event.key === "Tab" && event.shiftKey;
      let targetRow = rowIndex;
      let targetColumn: number | undefined = reverse
        ? columns[position - 1]
        : columns[position + 1];

      if (targetColumn === undefined) {
        // Wrap to the adjacent row.
        targetRow = rowIndex + (reverse ? -1 : 1);
        const nextColumns = sampleColumnsForRow(targetRow);
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
        target.click();
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
      onClickCapture={(event) => {
        const cell = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-row][data-column]"
        );
        if (!cell) return;
        const rowIndex = Number(cell.getAttribute("data-row"));
        const featureId = rows[rowIndex]?.featureId;
        if (featureId) onActiveFeatureChange(featureId);
      }}
      className="flex h-full min-h-0 w-full flex-col"
    >
      <Table<FeatureGridRow>
        mobileLayout="table"
        compact
        columns={columns}
        data={rows}
        count={rows.length}
        editableComponents={editableComponents}
        getRowClassName={(row) =>
          row.featureId === activeFeatureId ? "bg-accent/40" : undefined
        }
        titleBadge={
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {hasFeatures ? `${t`Characteristics`} (${rows.length})` : t`Result`}
          </span>
        }
        primaryAction={primaryAction}
        withInlineEditing={!isReadOnly}
        forceEditMode={!isReadOnly}
      />
    </div>
  );
};

export default InspectionMeasurementGrid;
