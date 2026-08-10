import {
  ActionMenu,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Switch
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuBookmarkPlus,
  LuColumns3,
  LuCornerDownRight,
  LuDownload,
  LuListFilter,
  LuRows3,
  LuSigma,
  LuTrash2,
  LuX
} from "react-icons/lu";
import { PeriodSelector } from "~/components";
import { DimensionEntityTypeIcon } from "~/components/Icons";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
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

export type PivotAccount = {
  id: string;
  number: string | null;
  name: string;
};

type PivotControlBarProps = {
  reportKey: AnalyticsReportKey;
  dimensions: PivotDimension[];
  state: PivotState;
  savedViews: ReportView[];
  activeViewId?: string;
  currentUserId: string;
  accounts: PivotAccount[];
  onDownload: () => void;
};

const PivotControlBar = ({
  reportKey,
  dimensions,
  state,
  savedViews,
  activeViewId,
  currentUserId,
  accounts,
  onDownload
}: PivotControlBarProps) => {
  const { t } = useLingui();
  const [params, setParams] = useUrlParams();

  // Transient interaction state only (like modal open/close) — all report
  // state lives in the URL per the pivot param contract.
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const dimensionById = useMemo(
    () => new Map(dimensions.map((d) => [d.dimensionId, d])),
    [dimensions]
  );

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

  // -- Accounts --
  // A subset of the report's account scope. Empty = the full scope (all
  // accounts); a non-empty set narrows the report to those accounts.

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const selectedAccountIds = state.accountIds.filter((id) =>
    accountById.has(id)
  );

  const setAccounts = (ids: string[]) => {
    setParams({ accounts: ids.length > 0 ? ids.join(",") : undefined });
  };

  const toggleAccount = (id: string) => {
    setAccounts(
      selectedAccountIds.includes(id)
        ? selectedAccountIds.filter((a) => a !== id)
        : [...selectedAccountIds, id]
    );
  };

  const accountsLabel =
    selectedAccountIds.length === 0
      ? t`All accounts`
      : selectedAccountIds.length === 1
        ? (accountById.get(selectedAccountIds[0])?.name ??
          selectedAccountIds[0])
        : t`${selectedAccountIds.length} accounts`;

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
      filters: undefined,
      accounts: undefined,
      sort: undefined
    });
  };

  const onReset = () => {
    setParams({
      rows: undefined,
      col: undefined,
      measure: undefined,
      pct: undefined,
      filters: undefined,
      accounts: undefined,
      sort: undefined,
      view: undefined,
      startDate: undefined,
      endDate: undefined
    });
  };

  return (
    <div className="flex flex-wrap px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full">
      <HStack className="flex-wrap gap-y-2">
        <PeriodSelector variant="range" />
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
        {accounts.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" leftIcon={<LuListFilter />}>
                {accountsLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 overflow-y-auto"
            >
              <DropdownMenuLabel>
                <Trans>Accounts</Trans>
              </DropdownMenuLabel>
              {selectedAccountIds.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => setAccounts([])}>
                    <DropdownMenuIcon icon={<LuX />} />
                    <Trans>Clear selection</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {accounts.map((account) => (
                <DropdownMenuCheckboxItem
                  key={account.id}
                  checked={selectedAccountIds.includes(account.id)}
                  onSelect={(event) => {
                    // Keep the menu open so several accounts can be toggled.
                    event.preventDefault();
                    toggleAccount(account.id);
                  }}
                >
                  {account.number ? `${account.number} · ` : ""}
                  {account.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Switch
          variant="small"
          checked={state.percentOfTotal}
          onCheckedChange={(checked) =>
            setParams({ pct: checked ? "1" : undefined })
          }
          label={t`% of total`}
        />
        {[...params.entries()].length > 0 && (
          <Button variant="secondary" rightIcon={<LuX />} onClick={onReset}>
            {t`Reset`}
          </Button>
        )}
      </HStack>
      <HStack className="gap-2">
        <Button
          variant="secondary"
          leftIcon={<LuDownload />}
          onClick={onDownload}
        >
          {t`Download`}
        </Button>
        <ActionMenu>
          <DropdownMenuItem onClick={() => setSaveModalOpen(true)}>
            <DropdownMenuIcon icon={<LuBookmarkPlus />} />
            <Trans>Save view</Trans>
          </DropdownMenuItem>
          {activeView && activeView.createdBy === currentUserId && (
            <DropdownMenuItem
              destructive
              onClick={() => setDeleteModalOpen(true)}
            >
              <DropdownMenuIcon icon={<LuTrash2 />} />
              <Trans>Delete view</Trans>
            </DropdownMenuItem>
          )}
          {savedViews.length > 0 && (
            <>
              <DropdownMenuSeparator />
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
            </>
          )}
        </ActionMenu>
      </HStack>
      {saveModalOpen && (
        <SaveViewModal
          reportKey={reportKey}
          state={state}
          view={activeView}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
      {deleteModalOpen && activeView && (
        <ConfirmDelete
          action={path.to.deleteReportView(activeView.id)}
          name={activeView.name}
          text={t`Are you sure you want to delete the "${activeView.name}" view? This cannot be undone.`}
          onCancel={() => setDeleteModalOpen(false)}
          onSubmit={() => setDeleteModalOpen(false)}
        />
      )}
    </div>
  );
};

export default PivotControlBar;
