import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import {
  computeReportPeriodBuckets,
  datetime,
  defaultReportRange
} from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useFetcher, useLoaderData } from "react-router";
import type {
  AnalyticsReportKey,
  DimensionPivotLine,
  PivotState
} from "~/modules/accounting";
import {
  analyticsReportKeys,
  analyticsReports,
  deleteReportView,
  getActiveDimensionsWithValues,
  getDimensionPivot,
  getFiscalYearSettings,
  getReportViews,
  getScrapAccountIds,
  pivotStateValidator,
  reportViewValidator,
  upsertReportView
} from "~/modules/accounting";
import type { PivotCellCoordinates } from "~/modules/accounting/ui/Reports";
import {
  getPeriodColumnLabel,
  PivotControlBar,
  PivotLinesDrawer,
  PivotTree
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

const breadcrumbByReportKey: Record<AnalyticsReportKey, MessageDescriptor> = {
  revenue: msg`Revenue`,
  expenses: msg`Expenses`,
  cogs: msg`COGS`,
  "inventory-change": msg`Inventory Change`,
  scrap: msg`Scrap`
};

export const handle: Handle = {
  // handle is static per route module, so the per-report label comes from the
  // function form (Breadcrumbs calls it with the route params).
  breadcrumb: (params: { reportKey?: string }) =>
    breadcrumbByReportKey[params.reportKey as AnalyticsReportKey] ??
    msg`Analytics`
};

/**
 * Explicit pivot params from the URL, per the contract documented above
 * pivotStateValidator. Only params that are PRESENT are returned, so they can
 * override the base state (saved view config or report default) field by
 * field. Values are validated later by pivotStateValidator on the merged
 * object — a bad bookmark must not 500.
 */
function parsePivotUrlParams(
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
  if (measure !== null) {
    partial.measure = measure;
  }

  const pct = searchParams.get("pct");
  if (pct !== null) {
    partial.percentOfTotal = pct === "1";
  }

  const filters = searchParams.get("filters");
  if (filters !== null) {
    try {
      partial.filters = JSON.parse(filters);
    } catch {
      // Malformed filters param — ignore it
    }
  }

  return partial;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting",
      role: "employee"
    }
  );

  const reportKey = analyticsReportKeys.find((key) => key === params.reportKey);
  if (!reportKey) {
    throw new Response("Not found", { status: 404 });
  }
  const report = analyticsReports[reportKey];
  const isScrap = "source" in report.accountScope;

  const url = new URL(request.url);

  // Default range: the trailing six months (shared with every other range
  // report via defaultReportRange), in the company's business timezone.
  const range = defaultReportRange(
    url.searchParams.get("endDate") ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const startDate = url.searchParams.get("startDate") ?? range.startDate;
  const endDate = range.endDate;

  const [
    dimensionsResult,
    savedViewsResult,
    fiscalYearSettings,
    scrapAccounts
  ] = await Promise.all([
    getActiveDimensionsWithValues(client, companyGroupId, companyId),
    getReportViews(client, { companyId, reportKey }),
    getFiscalYearSettings(client, companyId),
    isScrap
      ? getScrapAccountIds(client, companyId)
      : Promise.resolve({ data: [] as string[], error: null })
  ]);

  const dimensions = dimensionsResult.data ?? [];
  const savedViews = savedViewsResult.data ?? [];

  // -- Resolve the pivot state --
  // Precedence: explicit URL pivot params > the selected saved view's config >
  // the report default. The view param supplies the BASE state; any explicit
  // pivot param present in the URL overrides that field.
  const viewParam = url.searchParams.get("view");
  const activeView = viewParam
    ? savedViews.find((view) => view.id === viewParam)
    : undefined;

  let baseState: PivotState | undefined;
  if (activeView) {
    const config = pivotStateValidator.safeParse(activeView.config);
    if (config.success) {
      baseState = config.data;
    }
  }

  const defaultState = pivotStateValidator.parse({
    rows: report.defaultRows
  });
  const merged = pivotStateValidator.safeParse({
    ...(baseState ?? defaultState),
    ...parsePivotUrlParams(url.searchParams)
  });
  const rawState = merged.success ? merged.data : (baseState ?? defaultState);

  // Resolve "et:<entityType>" aliases (the report defaults use them) to the
  // first matching active dimension; unresolvable entries are dropped.
  const resolveAlias = (entry: string): string | null => {
    if (!entry.startsWith("et:")) return entry;
    const entityType = entry.slice("et:".length);
    return (
      dimensions.find((dimension) => dimension.entityType === entityType)
        ?.dimensionId ?? null
    );
  };

  const resolvedRows: string[] = [];
  for (const entry of rawState.rows) {
    const resolved = resolveAlias(entry);
    if (resolved && !resolvedRows.includes(resolved)) {
      resolvedRows.push(resolved);
    }
  }

  let columnAxis: PivotState["columnAxis"] = rawState.columnAxis;
  if (columnAxis.type === "dimension") {
    const resolved = resolveAlias(columnAxis.dimensionId);
    columnAxis = resolved
      ? { type: "dimension", dimensionId: resolved }
      : { type: "period", bucket: "month" };
  }

  const state: PivotState = { ...rawState, rows: resolvedRows, columnAxis };

  // January is the fallback only for genuinely-unset settings (PGRST116 = no
  // row); a failed query must not silently mis-bucket a non-January fiscal year.
  if (
    fiscalYearSettings.error &&
    fiscalYearSettings.error.code !== "PGRST116"
  ) {
    throw new Error("Failed to load fiscal year settings");
  }
  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;

  const periods =
    state.columnAxis.type === "period"
      ? computeReportPeriodBuckets(
          startDate,
          endDate,
          state.columnAxis.bucket,
          fiscalStartMonth
        )
      : [];

  const pivotResult = await getDimensionPivot(client, {
    companyId,
    companyGroupId,
    report,
    ...(isScrap ? { scrapAccountIds: scrapAccounts.data } : {}),
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
        error(pivotResult.error, "Failed to load analytics report")
      )
    );
  }

  return {
    pivot: pivotResult.data,
    dimensions,
    savedViews,
    state,
    periods,
    startDate,
    endDate,
    reportKey,
    activeViewId: activeView?.id
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-view") {
    const validation = await validator(reportViewValidator).validate(formData);
    if (validation.error) {
      return validationError(validation.error);
    }

    const { id, config, ...reportView } = validation.data;

    let parsedConfig: PivotState;
    try {
      const result = pivotStateValidator.safeParse(JSON.parse(config));
      if (!result.success) throw result.error;
      parsedConfig = result.data;
    } catch (err) {
      return data(
        {},
        await flash(request, error(err, "Invalid view configuration"))
      );
    }

    const upsert = await upsertReportView(
      client,
      id
        ? {
            id,
            ...reportView,
            config: parsedConfig as unknown as Json,
            companyId,
            updatedBy: userId
          }
        : {
            ...reportView,
            config: parsedConfig as unknown as Json,
            companyId,
            createdBy: userId
          }
    );

    if (upsert.error) {
      return data(
        {},
        await flash(request, error(upsert.error, "Failed to save view"))
      );
    }

    return data(
      { id: upsert.data.id },
      await flash(request, success("View saved"))
    );
  }

  if (intent === "delete-view") {
    const id = formData.get("id");
    if (typeof id !== "string" || id.length === 0) {
      return data(
        {},
        await flash(request, error("Missing view id", "Failed to delete view"))
      );
    }

    const deletion = await deleteReportView(client, id, companyId);
    if (deletion.error) {
      return data(
        {},
        await flash(request, error(deletion.error, "Failed to delete view"))
      );
    }

    return data({}, await flash(request, success("View deleted")));
  }

  return data(
    {},
    await flash(request, error("Unknown intent", "Invalid request"))
  );
}

export default function AnalyticsReportRoute() {
  const {
    pivot,
    dimensions,
    savedViews,
    state,
    periods,
    startDate,
    endDate,
    reportKey,
    activeViewId
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();

  const linesFetcher = useFetcher<{ lines: DimensionPivotLine[] }>();
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
    if (state.filters.length > 0) {
      searchParams.set("filters", JSON.stringify(state.filters));
    }

    // NULL semantics per getDimensionPivotLines: sending the dimension WITHOUT
    // a value means the Unassigned bucket; sending neither leaves the axis
    // unconstrained (e.g. a level-1 parent cell).
    const rowDimension1 = state.rows[0];
    if (rowDimension1 && (cell.rowValue1IsNull || cell.rowValue1Id)) {
      searchParams.set("r1d", rowDimension1);
      if (cell.rowValue1IsNull) {
        searchParams.set("r1null", "1");
      } else if (cell.rowValue1Id) {
        searchParams.set("r1", cell.rowValue1Id);
      }
    }

    const rowDimension2 = state.rows[1];
    if (rowDimension2 && (cell.rowValue2IsNull || cell.rowValue2Id)) {
      searchParams.set("r2d", rowDimension2);
      if (cell.rowValue2IsNull) {
        searchParams.set("r2null", "1");
      } else if (cell.rowValue2Id) {
        searchParams.set("r2", cell.rowValue2Id);
      }
    }

    if (!cell.isRowTotal) {
      if (state.columnAxis.type === "dimension") {
        searchParams.set("cold", state.columnAxis.dimensionId);
        if (cell.columnKey === null) {
          searchParams.set("colvnull", "1");
        } else {
          searchParams.set("colv", cell.columnKey);
        }
      } else if (cell.columnKey !== null) {
        // Period column: narrow by the bucket's date bounds
        const period = periods.find((p) => p.end === cell.columnKey);
        if (period) {
          searchParams.set("colstart", period.start);
          searchParams.set("colend", period.end);
        }
      }
    }

    setDrillTitle(titleParts.join(" · "));
    linesFetcher.load(
      `${path.to.api.analyticsReportLines(reportKey)}&${searchParams.toString()}`
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
      totalLabel: t`Total`
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

    // Standalone Blob + anchor download — same mechanism as exportReport.ts.
    // Label cells (dimension values, saved names) are user-controlled: prefix
    // formula-trigger characters so spreadsheets treat them as text. Numeric
    // measure cells (incl. negatives) pass through untouched.
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
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportKey}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  return (
    <VStack spacing={0} className="h-full">
      <PivotControlBar
        reportKey={reportKey}
        dimensions={dimensions}
        state={state}
        savedViews={savedViews}
        activeViewId={activeViewId}
        onDownload={onDownload}
      />
      <PivotTree
        pivot={pivot}
        state={state}
        columnLabels={columnLabels}
        onCellClick={onCellClick}
      />
      <PivotLinesDrawer
        open={drillTitle !== null}
        onClose={() => setDrillTitle(null)}
        title={drillTitle ?? ""}
        lines={linesFetcher.data?.lines ?? null}
        isLoading={linesFetcher.state !== "idle"}
      />
    </VStack>
  );
}
