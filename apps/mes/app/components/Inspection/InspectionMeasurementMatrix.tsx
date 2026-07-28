import { cn, toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import type {
  InspectionMeasurement,
  InspectionSample,
  InspectionSamplingPlan
} from "~/services/types";
import { path } from "~/utils/path";

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

// Synthetic feature id for the single pass/fail row shown when the lot has no
// inspection document. Its cells write the sample's status directly (via the
// sample route) rather than a per-feature measurement.
export const OVERALL_ROW_ID = "__overall__";

type MatrixRow = {
  featureId: string;
  label: string;
  description: string | null;
  isNumeric: boolean;
  specLabel: string;
  sampleSize: number;
  acceptanceNumber: number;
  rejectionNumber: number;
};

type InspectionMeasurementMatrixProps = {
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
};

function parseSpecNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

// Shop-floor features × samples matrix. Implements the same per-cell quiet
// POST contract as the ERP grid (measurement route for feature cells,
// sample route for the "Overall result" row) with plain touch-sized cells
// instead of the ERP Table's inline-editing machinery.
const InspectionMeasurementMatrix = ({
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
  onMeasurementSaved
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

  const rows = useMemo<MatrixRow[]>(() => {
    if (!hasFeatures) {
      return [
        {
          featureId: OVERALL_ROW_ID,
          label: t`Overall result`,
          description: null,
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
      const nominal = parseSpecNumber(feature.nominalValue);
      const isNumeric = feature.type === "Measurement" && nominal != null;
      const specLabel = [
        feature.nominalValue,
        feature.tolerancePlus != null || feature.toleranceMinus != null
          ? `+${feature.tolerancePlus ?? "0"}/−${feature.toleranceMinus ?? "0"}`
          : null,
        feature.unit
      ]
        .filter(Boolean)
        .join(" ");
      return {
        featureId: feature.id,
        label: feature.label,
        description: feature.description,
        isNumeric,
        specLabel,
        sampleSize: lotFeature.sampleSize,
        acceptanceNumber: lotFeature.acceptanceNumber,
        rejectionNumber: lotFeature.rejectionNumber
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
  // save responses (per-cell saves are quiet — no revalidation).
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

  const cellValue = useCallback(
    (columnIndex: number, featureId: string): number | null => {
      const key = `${columnIndex}:${featureId}`;
      if (key in valueByCell) return valueByCell[key];
      const measurement = measurementFor(
        sampleIdByColumn[columnIndex],
        featureId
      );
      return measurement?.value == null ? null : Number(measurement.value);
    },
    [valueByCell, sampleIdByColumn, measurementFor]
  );

  // Document-driven cell: record a per-feature measurement.
  const persistMeasurement = useCallback(
    async (
      row: MatrixRow,
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

      const response = await fetch(path.to.inspectionSample(inspectionId), {
        method: "post",
        body: formData
      });
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
      row: MatrixRow,
      columnIndex: number,
      payload: { value?: string; passed?: "true" | "false" }
    ): Promise<MeasurementSaveResult | null> => {
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

  const columnHeaders = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, index) => {
        const sample = samples[index];
        // MES entity display convention (AssemblyView precedent): readableId,
        // else the first 8 characters of the entity id.
        const entityLabel =
          sample?.trackedEntity?.readableId ??
          sample?.trackedEntityId?.slice(0, 8);
        return {
          label: isSerial && entityLabel ? entityLabel : `${index + 1}`,
          status: sample?.status ?? "Pending"
        };
      }),
    [columnCount, samples, isSerial]
  );

  if (columnCount === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {isSerial
          ? t`Scan a tracked entity to add the first sample column.`
          : t`No samples required.`}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 min-w-[220px] border-b border-r border-border bg-card px-3 py-2 text-left font-medium text-muted-foreground">
              {hasFeatures ? (
                <span>{t`Feature`}</span>
              ) : (
                <span>{t`Result`}</span>
              )}
            </th>
            {columnHeaders.map((column, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              <th
                key={`column-${index}`}
                className="min-w-[96px] border-b border-r border-border bg-card px-2 py-2 text-center font-medium last:border-r-0"
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className="max-w-[140px] truncate font-mono text-xs">
                    {column.label}
                  </span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isActive = hasFeatures && activeFeatureId === row.featureId;
            return (
              <tr
                key={row.featureId}
                className={cn(isActive && "bg-accent/40")}
              >
                <td
                  className={cn(
                    "sticky left-0 z-10 cursor-pointer border-b border-r border-border bg-card px-3 py-2 align-top",
                    isActive && "bg-accent"
                  )}
                  onClick={() =>
                    hasFeatures
                      ? onActiveFeatureChange(isActive ? null : row.featureId)
                      : undefined
                  }
                >
                  <div className="flex items-start gap-3">
                    {row.featureId !== OVERALL_ROW_ID ? (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-sm font-semibold text-foreground tabular-nums">
                        {row.label}
                      </div>
                    ) : null}
                    <div className="flex min-w-0 flex-col gap-1">
                      <div
                        className="line-clamp-2 text-sm font-semibold text-foreground"
                        title={row.description ?? undefined}
                      >
                        {row.description ??
                          (row.featureId === OVERALL_ROW_ID ? row.label : "—")}
                      </div>
                      {row.specLabel ? (
                        <div className="font-mono text-xs text-muted-foreground">
                          {row.specLabel}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground tabular-nums">
                        n {row.sampleSize} · Ac {row.acceptanceNumber} · Re{" "}
                        {row.rejectionNumber}
                      </div>
                    </div>
                  </div>
                </td>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const disabled = isReadOnly;
                  const status = cellStatus(columnIndex, row.featureId);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    <td
                      key={`${row.featureId}-${columnIndex}`}
                      className="h-px border-b border-r border-border p-0 text-center align-middle last:border-r-0"
                    >
                      {row.isNumeric ? (
                        <NumericCell
                          disabled={disabled}
                          status={status}
                          value={cellValue(columnIndex, row.featureId)}
                          onCommit={(value) =>
                            persistCell(row, columnIndex, { value })
                          }
                        />
                      ) : (
                        <PassFailCell
                          disabled={disabled}
                          status={status}
                          onToggle={(passed) =>
                            persistCell(row, columnIndex, { passed })
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function statusClasses(status: string | undefined) {
  switch (status) {
    case "Passed":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Failed":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    default:
      return "bg-transparent text-foreground hover:bg-muted/40 focus:bg-background";
  }
}

function NumericCell({
  disabled,
  status,
  value,
  onCommit
}: {
  disabled: boolean;
  status: string | undefined;
  value: number | null;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));

  // Re-sync when the persisted value changes underneath (e.g. save response).
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const persisted = value == null ? "" : String(value);
    if (draft.trim() === persisted) return;
    onCommit(draft.trim());
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "block h-full min-h-12 w-full min-w-[88px] text-center font-mono text-base tabular-nums outline-none transition-colors focus:ring-2 focus:ring-inset focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        statusClasses(status)
      )}
    />
  );
}

function PassFailCell({
  disabled,
  status,
  onToggle
}: {
  disabled: boolean;
  status: string | undefined;
  onToggle: (passed: "true" | "false") => void;
}) {
  return (
    <div className="flex h-full min-h-12 items-stretch">
      <button
        type="button"
        disabled={disabled}
        aria-label="Pass"
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
        aria-label="Fail"
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
