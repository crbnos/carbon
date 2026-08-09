import {
  Badge,
  BadgeCloseButton,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MultiSelect,
  Switch
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuBookmark,
  LuBookmarkPlus,
  LuCheck,
  LuColumns3,
  LuCornerDownRight,
  LuDownload,
  LuListFilter,
  LuRows3,
  LuSigma,
  LuX
} from "react-icons/lu";
import { PeriodSelector } from "~/components";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import { useUrlParams } from "~/hooks";
import { useCustomers, useItems, useSuppliers } from "~/stores";
import type {
  AnalyticsReportKey,
  PivotMeasure,
  PivotState
} from "../../accounting.models";
import { financialReportColumns, pivotMeasures } from "../../accounting.models";
import type { getActiveDimensionsWithValues } from "../../accounting.service";
import type { ReportView } from "../../types";
import SaveViewModal from "./SaveViewModal";

export type PivotDimension = NonNullable<
  Awaited<ReturnType<typeof getActiveDimensionsWithValues>>["data"]
>[number];

/**
 * Entity types with far too many rows to eagerly load into the loader payload.
 * Their filter options are sourced lazily from the client stores
 * (useCustomers / useSuppliers / useItems), exactly like DimensionSelector.
 */
const HIGH_CARDINALITY_ENTITY_TYPES = new Set(["Customer", "Supplier", "Item"]);

type PivotControlBarProps = {
  reportKey: AnalyticsReportKey;
  dimensions: PivotDimension[];
  state: PivotState;
  savedViews: ReportView[];
  activeViewId?: string;
  accountScopeLabel: string;
  onDownload: () => void;
};

const PivotControlBar = ({
  reportKey,
  dimensions,
  state,
  savedViews,
  activeViewId,
  accountScopeLabel,
  onDownload
}: PivotControlBarProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();

  // Transient interaction state only (like modal open/close) — all report
  // state lives in the URL per the pivot param contract.
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [pendingFilterId, setPendingFilterId] = useState<string | null>(null);

  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();
  const [items] = useItems();

  // Lazily-sourced options for the high-cardinality entity types, keyed by
  // entityType — the same mechanism DimensionSelector uses.
  const optionsByEntityType = useMemo(
    () => ({
      Customer: customers.map((c) => ({ value: c.id, label: c.name })),
      Supplier: suppliers.map((s) => ({ value: s.id, label: s.name })),
      Item: items.map((i) => ({
        value: i.id,
        label: i.readableIdWithRevision,
        helper: i.name
      }))
    }),
    [customers, suppliers, items]
  );

  const dimensionById = useMemo(
    () => new Map(dimensions.map((d) => [d.dimensionId, d])),
    [dimensions]
  );

  const optionsForDimension = (dim: PivotDimension) =>
    HIGH_CARDINALITY_ENTITY_TYPES.has(dim.entityType)
      ? (optionsByEntityType[
          dim.entityType as keyof typeof optionsByEntityType
        ] ?? [])
      : dim.values.map((v) => ({ value: v.id, label: v.name }));

  const valueLabel = (dim: PivotDimension, valueId: string) =>
    optionsForDimension(dim).find((o) => o.value === valueId)?.label ?? valueId;

  const columnLabels: Record<(typeof financialReportColumns)[number], string> =
    {
      month: t`Monthly`,
      quarter: t`Quarterly`,
      year: t`Yearly`
    };

  const measureLabels: Record<PivotMeasure, string> = {
    amount: t`Amount`,
    quantity: t`Quantity`,
    count: t`Count`
  };

  // -- Rows --

  const row1 = state.rows[0];
  const row2 = state.rows[1];

  const setRows = (rows: string[]) => {
    setParams({ rows: rows.length > 0 ? rows.join(",") : undefined });
  };

  const onRow1Change = (dimensionId: string) => {
    if (!dimensionId) {
      // Clearing the first level promotes the second, if any
      setRows(row2 ? [row2] : []);
      return;
    }
    setRows([dimensionId, ...(row2 && row2 !== dimensionId ? [row2] : [])]);
  };

  const onRow2Change = (dimensionId: string) => {
    if (!row1) return;
    setRows(dimensionId ? [row1, dimensionId] : [row1]);
  };

  // -- Columns --

  const columnAxisValue =
    state.columnAxis.type === "period" ? state.columnAxis.bucket : "dimension";

  const columnDimensionId =
    state.columnAxis.type === "dimension"
      ? state.columnAxis.dimensionId
      : undefined;

  const columnDimensionCandidates = dimensions.filter(
    (d) => !state.rows.includes(d.dimensionId)
  );

  const columnLabel =
    state.columnAxis.type === "period"
      ? columnLabels[state.columnAxis.bucket]
      : (dimensionById.get(state.columnAxis.dimensionId)?.dimensionName ??
        t`By dimension`);

  const onColumnAxisChange = (value: string) => {
    if (value === "dimension") {
      const fallback = columnDimensionCandidates[0];
      if (!fallback) return;
      setParams({ col: `dim:${fallback.dimensionId}` });
      return;
    }
    // period:month is the default — omit it from the URL like ReportFilters
    setParams({ col: value === "month" ? undefined : `period:${value}` });
  };

  // -- Filters --

  const filters = state.filters;

  const setFilters = (next: { dimensionId: string; valueIds: string[] }[]) => {
    setParams({
      filters: next.length > 0 ? JSON.stringify(next) : undefined
    });
  };

  const upsertFilter = (dimensionId: string, valueIds: string[]) => {
    const exists = filters.some((f) => f.dimensionId === dimensionId);
    const next = exists
      ? filters
          .map((f) =>
            f.dimensionId === dimensionId ? { dimensionId, valueIds } : f
          )
          .filter((f) => f.valueIds.length > 0)
      : valueIds.length > 0
        ? [...filters, { dimensionId, valueIds }]
        : filters;
    setFilters(next);
  };

  const pendingFilterDimension = pendingFilterId
    ? dimensionById.get(pendingFilterId)
    : undefined;

  const addableFilterDimensions = dimensions.filter(
    (d) =>
      !filters.some((f) => f.dimensionId === d.dimensionId) &&
      d.dimensionId !== pendingFilterId
  );

  const filterChipLabel = (filter: {
    dimensionId: string;
    valueIds: string[];
  }) => {
    const dim = dimensionById.get(filter.dimensionId);
    if (!dim) return filter.dimensionId;
    if (filter.valueIds.length > 2) {
      return `${dim.dimensionName}: ${filter.valueIds.length}`;
    }
    return `${dim.dimensionName}: ${filter.valueIds
      .map((id) => valueLabel(dim, id))
      .join(", ")}`;
  };

  // -- Saved views --

  const privateViews = savedViews.filter((v) => v.visibility === "Private");
  const companyViews = savedViews.filter((v) => v.visibility === "Company");
  const activeView = savedViews.find((v) => v.id === activeViewId);

  const onSelectView = (id: string) => {
    if (!id) return;
    // The view's config supplies the pivot state, so drop any explicit pivot
    // params (which would otherwise win over the view in the loader). Dates
    // are unrelated to the saved config and are preserved.
    setParams({
      view: id,
      rows: undefined,
      col: undefined,
      measure: undefined,
      pct: undefined,
      filters: undefined
    });
  };

  const onReset = () => {
    setParams({
      rows: undefined,
      col: undefined,
      measure: undefined,
      pct: undefined,
      filters: undefined,
      view: undefined,
      startDate: undefined,
      endDate: undefined
    });
  };

  return (
    <div className="flex flex-wrap px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full">
      <HStack className="flex-wrap gap-y-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuRows3 />}>
              {row1
                ? (dimensionById.get(row1)?.dimensionName ?? row1)
                : t`Group by`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={row1 ?? ""}
              onValueChange={onRow1Change}
            >
              <DropdownMenuRadioItem value="">
                <Trans>None</Trans>
              </DropdownMenuRadioItem>
              {dimensions.map((dim) => (
                <DropdownMenuRadioItem
                  key={dim.dimensionId}
                  value={dim.dimensionId}
                >
                  <DropdownMenuIcon
                    icon={
                      <DimensionEntityTypeIcon
                        entityType={dim.entityType as any}
                      />
                    }
                  />
                  {dim.dimensionName}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              leftIcon={<LuCornerDownRight />}
              isDisabled={!row1}
            >
              {row2
                ? (dimensionById.get(row2)?.dimensionName ?? row2)
                : t`Then by`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={row2 ?? ""}
              onValueChange={onRow2Change}
            >
              <DropdownMenuRadioItem value="">
                <Trans>None</Trans>
              </DropdownMenuRadioItem>
              {dimensions
                .filter((dim) => dim.dimensionId !== row1)
                .map((dim) => (
                  <DropdownMenuRadioItem
                    key={dim.dimensionId}
                    value={dim.dimensionId}
                  >
                    <DropdownMenuIcon
                      icon={
                        <DimensionEntityTypeIcon
                          entityType={dim.entityType as any}
                        />
                      }
                    />
                    {dim.dimensionName}
                  </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuColumns3 />}>
              {columnLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={columnAxisValue}
              onValueChange={onColumnAxisChange}
            >
              {financialReportColumns.map((granularity) => (
                <DropdownMenuRadioItem key={granularity} value={granularity}>
                  {columnLabels[granularity]}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem
                value="dimension"
                disabled={columnDimensionCandidates.length === 0}
              >
                <Trans>By dimension</Trans>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {state.columnAxis.type === "dimension" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                {columnDimensionId
                  ? (dimensionById.get(columnDimensionId)?.dimensionName ??
                    columnDimensionId)
                  : t`Column dimension`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={columnDimensionId ?? ""}
                onValueChange={(value) => {
                  if (value) setParams({ col: `dim:${value}` });
                }}
              >
                {columnDimensionCandidates.map((dim) => (
                  <DropdownMenuRadioItem
                    key={dim.dimensionId}
                    value={dim.dimensionId}
                  >
                    <DropdownMenuIcon
                      icon={
                        <DimensionEntityTypeIcon
                          entityType={dim.entityType as any}
                        />
                      }
                    />
                    {dim.dimensionName}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" leftIcon={<LuSigma />}>
              {measureLabels[state.measure]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={state.measure}
              onValueChange={(value) =>
                setParams({ measure: value === "amount" ? undefined : value })
              }
            >
              {pivotMeasures.map((measure) => (
                <DropdownMenuRadioItem key={measure} value={measure}>
                  {measureLabels[measure]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Switch
          variant="small"
          checked={state.percentOfTotal}
          onCheckedChange={(checked) =>
            setParams({ pct: checked ? "1" : undefined })
          }
          label={t`% of total`}
        />
        {addableFilterDimensions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" leftIcon={<LuListFilter />}>
                {t`Filter`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>
                <Trans>Dimensions</Trans>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {addableFilterDimensions.map((dim) => (
                <DropdownMenuItem
                  key={dim.dimensionId}
                  onSelect={() => setPendingFilterId(dim.dimensionId)}
                >
                  <DropdownMenuIcon
                    icon={
                      <DimensionEntityTypeIcon
                        entityType={dim.entityType as any}
                      />
                    }
                  />
                  {dim.dimensionName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {pendingFilterDimension && (
          <div className="flex items-center gap-1">
            <MultiSelect
              size="sm"
              className="w-52"
              value={
                filters.find(
                  (f) => f.dimensionId === pendingFilterDimension.dimensionId
                )?.valueIds ?? []
              }
              options={optionsForDimension(pendingFilterDimension)}
              placeholder={pendingFilterDimension.dimensionName}
              onChange={(valueIds) =>
                upsertFilter(pendingFilterDimension.dimensionId, valueIds)
              }
            />
            <IconButton
              aria-label={t`Done`}
              variant="ghost"
              icon={<LuCheck />}
              onClick={() => setPendingFilterId(null)}
            />
          </div>
        )}
        {filters
          .filter((f) => f.dimensionId !== pendingFilterId)
          .map((filter) => (
            <Badge
              key={filter.dimensionId}
              role="group"
              tabIndex={0}
              variant="outline"
              className="inline-flex items-center gap-1 cursor-pointer"
              onClick={() => setPendingFilterId(filter.dimensionId)}
            >
              <span>{filterChipLabel(filter)}</span>
              <BadgeCloseButton
                tabIndex={0}
                aria-label={t`Remove filter`}
                onClick={(e) => {
                  e.stopPropagation();
                  upsertFilter(filter.dimensionId, []);
                }}
              />
            </Badge>
          ))}
        <PeriodSelector variant="range" />
        <Badge variant="secondary">{accountScopeLabel}</Badge>
        {savedViews.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" leftIcon={<LuBookmark />}>
                {activeView?.name ?? t`Views`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup
                value={activeViewId ?? ""}
                onValueChange={onSelectView}
              >
                {privateViews.length > 0 && (
                  <>
                    <DropdownMenuLabel>
                      <Trans>Private</Trans>
                    </DropdownMenuLabel>
                    {privateViews.map((view) => (
                      <DropdownMenuRadioItem key={view.id} value={view.id}>
                        {view.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                )}
                {privateViews.length > 0 && companyViews.length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {companyViews.length > 0 && (
                  <>
                    <DropdownMenuLabel>
                      <Trans>Company</Trans>
                    </DropdownMenuLabel>
                    {companyViews.map((view) => (
                      <DropdownMenuRadioItem key={view.id} value={view.id}>
                        {view.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="secondary"
          leftIcon={<LuBookmarkPlus />}
          onClick={() => setSaveModalOpen(true)}
        >
          {t`Save view`}
        </Button>
        {[...params.entries()].length > 0 && (
          <Button variant="secondary" rightIcon={<LuX />} onClick={onReset}>
            {t`Reset`}
          </Button>
        )}
      </HStack>
      <Button
        variant="secondary"
        leftIcon={<LuDownload />}
        onClick={onDownload}
      >
        {t`Download`}
      </Button>
      {saveModalOpen && (
        <SaveViewModal
          reportKey={reportKey}
          state={state}
          view={activeView}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
};

export default PivotControlBar;
