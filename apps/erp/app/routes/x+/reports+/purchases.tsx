import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import {
  computeReportPeriodBuckets,
  datetime,
  defaultReportRange
} from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useUrlParams } from "~/hooks";
import type { PivotState, PurchaseLinePivotLine } from "~/modules/accounting";
import {
  applyPivotDisplayParams,
  getFiscalYearSettings,
  getPurchaseLinePivot,
  pivotStateValidator,
  purchaseGroupingFields
} from "~/modules/accounting";
import type { PivotCellCoordinates } from "~/modules/accounting/ui/Reports";
import {
  getPeriodColumnLabel,
  PivotTree,
  PurchaseLinesDrawer,
  PurchasesControlBar
} from "~/modules/accounting/ui/Reports";
import {
  buildPivotTree,
  pivotToCsvRows,
  UNASSIGNED_COLUMN_KEY
} from "~/modules/accounting/ui/Reports/pivotData";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { revalidateIgnoringPivotDisplay } from "~/utils/revalidate";

export const handle: Handle = {
  breadcrumb: () => msg`Purchases`
};

const isGroupingField = (value: string): boolean =>
  (purchaseGroupingFields as readonly string[]).includes(value);

// Explicit pivot params present in the URL override the report default field by
// field. Rows/column carry grouping-field keys (not journal dimension ids).
function parsePurchaseUrlParams(
  searchParams: URLSearchParams
): Record<string, unknown> {
  const partial: Record<string, unknown> = {};

  const rows = searchParams.get("rows");
  if (rows !== null) {
    partial.rows = rows.split(",").filter(Boolean).slice(0, 2);
  }

  const col = searchParams.get("col");
  if (col?.startsWith("period:")) {
    partial.columnAxis = {
      type: "period",
      bucket: col.slice("period:".length)
    };
  } else if (col?.startsWith("dim:")) {
    partial.columnAxis = {
      type: "dimension",
      dimensionId: col.slice("dim:".length)
    };
  }

  const measure = searchParams.get("measure");
  if (measure !== null) partial.measure = measure;

  const pct = searchParams.get("pct");
  if (pct !== null) partial.percentOfTotal = pct === "1";

  const sort = searchParams.get("sort");
  if (sort !== null) {
    const separator = sort.lastIndexOf(":");
    const key = separator > 0 ? sort.slice(0, separator) : "";
    const direction = separator > 0 ? sort.slice(separator + 1) : "";
    if (key && (direction === "asc" || direction === "desc")) {
      partial.sort = { key, direction };
    }
  }

  return partial;
}

// measure / % of total / sort are applied client-side by buildPivotTree, so a
// change to only those skips the pivot refetch; the component re-derives them
// from the URL via applyPivotDisplayParams.
export const shouldRevalidate = revalidateIgnoringPivotDisplay;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);

  const range = defaultReportRange(
    url.searchParams.get("endDate") ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const startDate = url.searchParams.get("startDate") ?? range.startDate;
  const endDate = range.endDate;

  const fiscalYearSettings = await getFiscalYearSettings(client, companyId);
  if (
    fiscalYearSettings.error &&
    fiscalYearSettings.error.code !== "PGRST116"
  ) {
    throw new Error("Failed to load fiscal year settings");
  }
  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;

  // Precedence: explicit URL pivot params over the report default (Supplier).
  const defaultState = pivotStateValidator.parse({ rows: ["supplier"] });
  const merged = pivotStateValidator.safeParse({
    ...defaultState,
    ...parsePurchaseUrlParams(url.searchParams)
  });
  const rawState = merged.success ? merged.data : defaultState;

  // Keep only valid grouping fields; a bad bookmark must not 500.
  const rows: string[] = [];
  for (const entry of rawState.rows) {
    if (isGroupingField(entry) && !rows.includes(entry)) rows.push(entry);
  }

  let columnAxis: PivotState["columnAxis"] = rawState.columnAxis;
  if (
    columnAxis.type === "dimension" &&
    !isGroupingField(columnAxis.dimensionId)
  ) {
    columnAxis = { type: "period", bucket: "month" };
  }

  const state: PivotState = { ...rawState, rows, columnAxis };

  const periods =
    state.columnAxis.type === "period"
      ? computeReportPeriodBuckets(
          startDate,
          endDate,
          state.columnAxis.bucket,
          fiscalStartMonth
        )
      : [];

  const pivotResult = await getPurchaseLinePivot(client, {
    companyId,
    startDate,
    endDate,
    ...(state.columnAxis.type === "period"
      ? { periodEnds: periods.map((bucket) => bucket.end) }
      : {}),
    state
  });

  if (pivotResult.error || !pivotResult.data) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(pivotResult.error, "Failed to load purchases report")
      )
    );
  }

  return { pivot: pivotResult.data, state, periods, startDate, endDate };
}

export default function PurchasesReportRoute() {
  const {
    pivot,
    state: loaderState,
    periods,
    startDate,
    endDate
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const [searchParams] = useUrlParams();

  // measure / % of total / sort are applied client-side; when only those change
  // the loader is skipped (revalidateIgnoringPivotDisplay), so overlay them from
  // the URL to keep the pivot in sync without a refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the URL string, not the unstable URLSearchParams identity
  const state = useMemo(
    () => applyPivotDisplayParams(loaderState, searchParams),
    [loaderState, searchParams.toString()]
  );

  const linesFetcher = useFetcher<{ lines: PurchaseLinePivotLine[] }>();
  const [drillTitle, setDrillTitle] = useState<string | null>(null);

  const bucket =
    state.columnAxis.type === "period" ? state.columnAxis.bucket : undefined;

  const columnLabels = useMemo(() => {
    const labels: Record<string, string> = {
      [UNASSIGNED_COLUMN_KEY]: t`Unassigned`
    };
    if (bucket) {
      for (const period of periods) {
        labels[period.end] = getPeriodColumnLabel(period, bucket, locale);
      }
    } else {
      for (const key of pivot.columnKeys) {
        if (key === UNASSIGNED_COLUMN_KEY) continue;
        labels[key] = pivot.valueNames[key] ?? key;
      }
    }
    return labels;
  }, [bucket, periods, pivot, locale, t]);

  const onCellClick = (cell: PivotCellCoordinates) => {
    const titleParts: string[] = [];
    if (cell.rowValue1IsNull) {
      titleParts.push(t`Unassigned`);
    } else if (cell.rowValue1Id) {
      titleParts.push(pivot.valueNames[cell.rowValue1Id] ?? cell.rowValue1Id);
    }
    if (cell.rowValue2IsNull) {
      titleParts.push(t`Unassigned`);
    } else if (cell.rowValue2Id) {
      titleParts.push(pivot.valueNames[cell.rowValue2Id] ?? cell.rowValue2Id);
    }
    titleParts.push(
      cell.isRowTotal
        ? t`Total`
        : cell.columnKey === null
          ? t`Unassigned`
          : (columnLabels[cell.columnKey] ?? cell.columnKey)
    );

    const searchParams = new URLSearchParams({ startDate, endDate });

    const rowField1 = state.rows[0];
    if (rowField1 && (cell.rowValue1IsNull || cell.rowValue1Id)) {
      searchParams.set("r1f", rowField1);
      if (cell.rowValue1IsNull) searchParams.set("r1null", "1");
      else if (cell.rowValue1Id) searchParams.set("r1", cell.rowValue1Id);
    }

    const rowField2 = state.rows[1];
    if (rowField2 && (cell.rowValue2IsNull || cell.rowValue2Id)) {
      searchParams.set("r2f", rowField2);
      if (cell.rowValue2IsNull) searchParams.set("r2null", "1");
      else if (cell.rowValue2Id) searchParams.set("r2", cell.rowValue2Id);
    }

    if (!cell.isRowTotal) {
      if (state.columnAxis.type === "dimension") {
        searchParams.set("colf", state.columnAxis.dimensionId);
        if (cell.columnKey === null) searchParams.set("colvnull", "1");
        else searchParams.set("colv", cell.columnKey);
      } else if (cell.columnKey !== null) {
        const period = periods.find((p) => p.end === cell.columnKey);
        if (period) {
          searchParams.set("colstart", period.start);
          searchParams.set("colend", period.end);
        }
      }
    }

    setDrillTitle(titleParts.join(" · "));
    linesFetcher.load(
      `${path.to.api.purchasesReportLines}?${searchParams.toString()}`
    );
  };

  const onDownload = () => {
    const tree = buildPivotTree({
      groups: pivot.groups,
      valueNames: pivot.valueNames,
      columnKeys: pivot.columnKeys,
      rowCount: Math.min(state.rows.length, 2) as 0 | 1 | 2,
      measure: state.measure,
      unassignedLabel: t`Unassigned`,
      totalLabel: t`Total`,
      sort: state.sort
    });

    const rows = pivotToCsvRows({
      flatTree: tree.flatTree,
      columnKeys: tree.columnKeys,
      columnTotals: tree.columnTotals,
      grandTotal: tree.grandTotal,
      measure: state.measure,
      columnLabels
    });
    if (rows.length === 0) return;

    const sanitizeCell = (value: string) => {
      if (value === "" || Number.isFinite(Number(value))) return value;
      return /^[=+\-@]/.test(value) ? `'${value}` : value;
    };
    const csvData = rows
      .map((row) =>
        row
          .map(sanitizeCell)
          .map((value) =>
            /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
          )
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csvData], { type: "text/csv" });
    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = "purchases.csv";
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(anchor);
  };

  return (
    <VStack spacing={0} className="h-full">
      <PurchasesControlBar state={state} onDownload={onDownload} />
      <PivotTree
        pivot={pivot}
        state={state}
        columnLabels={columnLabels}
        onCellClick={onCellClick}
      />
      <PurchaseLinesDrawer
        open={drillTitle !== null}
        onClose={() => setDrillTitle(null)}
        title={drillTitle ?? ""}
        lines={linesFetcher.data?.lines ?? null}
        isLoading={linesFetcher.state !== "idle"}
      />
    </VStack>
  );
}
