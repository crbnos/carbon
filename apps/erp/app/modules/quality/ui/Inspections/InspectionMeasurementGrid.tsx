import { Badge, Button, cn, HStack, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuPlus } from "react-icons/lu";
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
  activeFeatureId: string | null;
  onActiveFeatureChange: (id: string | null) => void;
  onAddSample: () => void;
  onMeasurementSaved: (result: MeasurementSaveResult) => void;
  // Rendered in the Table header (e.g. the collapse/expand toggle when the
  // grid is the bottom panel of the execution view).
  primaryAction?: React.ReactNode;
};

const sampleKey = (columnIndex: number) => `sample-${columnIndex}`;

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
  activeFeatureId,
  onActiveFeatureChange,
  onAddSample,
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

  // Column model: serial lots get one column per scanned sample; non-serial
  // lots pre-create columns up to the max required n (sample rows are created
  // server-side on the first measurement into a column).
  const columnCount = isSerial
    ? samples.length
    : Math.max(maxSampleSize, samples.length);

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
      return measurementFor(sampleIdByColumn[columnIndex], featureId)?.status;
    },
    [statusByCell, sampleIdByColumn, measurementFor]
  );

  const persistCell = useCallback(
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

      const result: MeasurementSaveResult = {
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
    [inspectionId, sampleIdByColumn, onMeasurementSaved, t]
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
    liveFeatures,
    columnCount,
    sampleIdByColumn,
    valueByCell,
    measurementFor
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
        cell: ({ row }) => {
          const original = row.original;
          const enabled = i < original.sampleSize;
          if (!enabled) {
            return (
              <span className="block text-center text-xs text-muted-foreground/40">
                ·
              </span>
            );
          }
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
          return (
            <HStack data-sample-col={i} spacing={1} className="justify-center">
              <Button
                size="sm"
                variant={status === "Passed" ? "primary" : "secondary"}
                className="h-6 px-1.5 text-[10px]"
                isDisabled={isReadOnly}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  persistCell(original, i, { passed: "true" });
                }}
              >
                P
              </Button>
              <Button
                size="sm"
                variant={status === "Failed" ? "destructive" : "secondary"}
                className="h-6 px-1.5 text-[10px]"
                isDisabled={isReadOnly}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  persistCell(original, i, { passed: "false" });
                }}
              >
                F
              </Button>
            </HStack>
          );
        }
      });
    }

    if (isSerial && !isReadOnly) {
      cols.push({
        id: "add-sample",
        header: () => (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<LuPlus />}
            onClick={onAddSample}
          >
            {t`Sample`}
          </Button>
        ),
        cell: () => null
      });
    }

    return cols;
  }, [
    columnCount,
    samples,
    isSerial,
    isReadOnly,
    featureCounts,
    cellStatus,
    persistCell,
    onAddSample,
    t
  ]);

  // Numeric sample cells edit through the shared Editable machinery; attribute
  // rows keep their inline P/F buttons (the editable component falls back to
  // them so an opened cell renders the same UI).
  const editableComponents = useMemo(() => {
    const components: Record<
      string,
      (props: EditableTableCellComponentProps<FeatureGridRow>) => JSX.Element
    > = {};
    for (let i = 0; i < columnCount; i++) {
      const key = sampleKey(i);
      const numberEditor = EditableNumber<FeatureGridRow>(
        onCellEdit,
        undefined,
        {
          clearable: true
        }
      );
      components[key] = (props) => {
        const enabled = i < props.row.sampleSize;
        if (!enabled || !props.row.isNumeric) {
          // Not numerically editable — render nothing; the display cell's
          // buttons / placeholder stay in charge.
          return <div className="px-2 text-xs text-muted-foreground/40">·</div>;
        }
        return numberEditor(props);
      };
    }
    return components;
  }, [columnCount, onCellEdit]);

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
            {t`Features`} ({rows.length})
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
