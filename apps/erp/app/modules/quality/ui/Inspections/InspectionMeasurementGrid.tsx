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
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan
} from "~/modules/quality/types";
import { path } from "~/utils/path";

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
} & Record<string, unknown>;

type InspectionMeasurementGridProps = {
  inspectionId: string;
  isReadOnly: boolean;
  isSerial: boolean;
  features: InspectionSamplingPlan[];
  samples: InspectionSample[];
  measurements: InspectionMeasurement[];
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
          rejectionNumber: lotRejectionNumber
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
        rejectionNumber: lotFeature.rejectionNumber
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
        header: t`Feature`,
        cell: ({ row }) => (
          <span
            className="line-clamp-2 max-w-[180px] text-xs"
            title={row.original.description ?? undefined}
          >
            {row.original.description ?? "—"}
          </span>
        )
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
      const numberEditor = EditableNumber<FeatureGridRow>(
        onCellEdit,
        // react-aria NumberField defaults to 3 fraction digits, which rounds
        // fine measurements (e.g. thousandths/ten-thousandths of an inch) on
        // blur. Allow up to 6 so precision readings persist intact.
        { formatOptions: { maximumFractionDigits: 6 } },
        {
          clearable: true
        }
      );
      components[key] = (props) => {
        if (!props.row.isNumeric) {
          // Attribute feature: keep the Pass/Fail toggle visible when focused.
          return renderPassFail(props.row, i);
        }
        return numberEditor(props);
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

      // The cell currently being edited has its marker replaced by the editor —
      // include it explicitly.
      const columns = sampleColumnsForRow(rowIndex);
      if (!columns.includes(currentColumn)) columns.push(currentColumn);
      columns.sort((a, b) => a - b);
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
            {hasFeatures ? `${t`Features`} (${rows.length})` : t`Result`}
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
