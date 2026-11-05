// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { formatPeriodLabel } from "@carbon/utils";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useMemo } from "react";
import { LuDownload } from "react-icons/lu";
import { PeriodSelector, Table } from "~/components";
import {
  useCurrencyFormatter,
  useDateFormatter,
  useQuantityFormatter,
  useUrlParams
} from "~/hooks";
import type { BreadcrumbSegment, Handle } from "~/utils/handle";
import { path } from "~/utils/path";

/**
 * The route handle of a report page: Projects → Reports → the report, full
 * width like the accounting reports, so the module sidebar is hidden.
 */
export function projectReportHandle(
  reportKey: string,
  name: MessageDescriptor
): Handle {
  return {
    breadcrumb: (): BreadcrumbSegment[] => [
      { breadcrumb: msg`Reports`, to: path.to.projectReports },
      { breadcrumb: name, to: path.to.projectReport(reportKey) }
    ],
    to: path.to.projectReport(reportKey),
    module: "projects",
    hideModuleSidebar: true
  };
}

/**
 * The cell formats the reports share: dates, hours and amounts in the base
 * currency. A missing value is an empty cell.
 */
export function useReportFormat(options?: { wholeUnits?: boolean }) {
  const { formatDate } = useDateFormatter();
  const quantity = useQuantityFormatter();
  const currency = useCurrencyFormatter({ wholeUnits: options?.wholeUnits });
  return useMemo(
    () => ({
      date: (value: string | null) => (value ? formatDate(value) : ""),
      hours: (value: number | null) =>
        value === null ? "" : quantity(Number(value)),
      money: (value: number | null) =>
        value === null ? "" : currency.format(Number(value))
    }),
    [formatDate, quantity, currency]
  );
}

/** A number cell; `bold` for a total row. */
export function NumberCell({
  children,
  bold
}: {
  children: ReactNode;
  bold?: boolean;
}) {
  return (
    <span className={cn("tabular-nums", bold && "font-semibold")}>
      {children}
    </span>
  );
}

/** A charge number with its project or element name beside it. */
export function ChargeNumberCell({
  chargeNumber,
  name
}: {
  chargeNumber: string;
  name: string | null;
}) {
  if (!chargeNumber) return null;
  return (
    <span className="flex items-baseline gap-2 truncate">
      <span className="font-medium">{chargeNumber}</span>
      {name && <span className="truncate text-muted-foreground">{name}</span>}
    </span>
  );
}

type ProjectReportProps<T extends object> = {
  title: string;
  data: T[];
  columns: ColumnDef<T>[];
  /** The report's inputs: a date range, a period or a tax year. */
  filters: ReactNode;
  /** The report's CSV (`path.to.api.projectReport`) for the same inputs. */
  csvHref?: string;
  getRowClassName?: (row: T) => string | undefined;
  groupRowsBy?: {
    key: (row: T) => string;
    header: (rows: T[]) => ReactNode;
  };
  /** Rendered under the table (notes that belong to the report). */
  children?: ReactNode;
  /** The table's search box, read by the loader as `search`. */
  withSearch?: boolean;
  /** Controls beside the search box and the filters. */
  headerActions?: ReactNode;
  getRowId?: (row: T) => string;
  /** Row selection, with the actions for the selected rows. */
  renderActions?: (rows: T[]) => ReactNode;
  renderContextMenu?: (row: T) => JSX.Element | null;
  renderExpandedRow?: (row: T) => ReactNode;
  emptyState?: ReactNode;
};

/**
 * One report of Projects → Reports: its rows in a table, with the inputs and
 * the CSV download in the table's header. The CSV comes from the report's
 * export route, which writes the agreed column set, so the table's own
 * export is turned off.
 */
export function ProjectReport<T extends object>({
  title,
  data,
  columns,
  filters,
  csvHref,
  getRowClassName,
  groupRowsBy,
  children,
  withSearch = false,
  headerActions,
  getRowId,
  renderActions,
  renderContextMenu,
  renderExpandedRow,
  emptyState
}: ProjectReportProps<T>) {
  return (
    <VStack spacing={0} className="h-full">
      <div className="w-full flex-1 min-h-0">
        {/* Every row is returned at once, and sort / pagination are
            URL-driven server-side controls these loaders do not read — turn
            them off rather than render controls that do nothing. Search is
            on only where the loader reads it. */}
        <Table<T>
          data={data}
          columns={columns}
          count={data.length}
          title={title}
          primaryAction={
            <HStack>
              {filters}
              {csvHref && (
                <Button variant="secondary" leftIcon={<LuDownload />} asChild>
                  <a href={csvHref} download>
                    <Trans>Download CSV</Trans>
                  </a>
                </Button>
              )}
            </HStack>
          }
          getRowClassName={getRowClassName}
          groupRowsBy={groupRowsBy}
          headerActions={headerActions}
          getRowId={getRowId}
          renderActions={renderActions}
          renderContextMenu={renderContextMenu}
          renderExpandedRow={renderExpandedRow}
          emptyState={emptyState}
          withSelectableRows={Boolean(renderActions)}
          withCsvExport={false}
          withPagination={false}
          withSearch={withSearch}
          withSimpleSorting={false}
        />
      </div>
      {children}
    </VStack>
  );
}

/** The date range of a range report (`startDate` / `endDate` params). */
export function ReportRangeSelect({
  fiscalStartMonth
}: {
  fiscalStartMonth: number;
}) {
  return (
    <PeriodSelector
      fiscalStartMonth={fiscalStartMonth}
      defaultPresetId="this-month"
    />
  );
}

/** The accounting period of the labor distribution (`periodId` param). */
export function ReportPeriodSelect({
  periods,
  periodId
}: {
  periods: { id: string; startDate: string }[];
  periodId: string | null;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [, setParams] = useUrlParams();

  if (periods.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        <Trans>No accounting periods yet</Trans>
      </span>
    );
  }

  return (
    <Select
      value={periodId ?? undefined}
      onValueChange={(value) => setParams({ periodId: value })}
    >
      <SelectTrigger className="w-48" aria-label={t`Accounting period`}>
        <SelectValue placeholder={t`Choose a period`} />
      </SelectTrigger>
      <SelectContent>
        {periods.map((period) => (
          <SelectItem key={period.id} value={period.id}>
            {formatPeriodLabel(period.startDate, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** How many tax years the R&D tax reports offer, the current one included. */
const TAX_YEARS_OFFERED = 6;

/**
 * The tax year of an R&D tax report (`taxYear` param). A tax year is named
 * by the calendar year in which it starts.
 */
export function ReportTaxYearSelect({
  taxYear,
  currentTaxYear
}: {
  taxYear: number;
  currentTaxYear: number;
}) {
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const years = Array.from(
    { length: TAX_YEARS_OFFERED },
    (_, index) => currentTaxYear - index
  );
  if (!years.includes(taxYear)) years.push(taxYear);

  return (
    <Select
      value={String(taxYear)}
      onValueChange={(value) => setParams({ taxYear: value })}
    >
      <SelectTrigger className="w-32" aria-label={t`Tax year`}>
        <SelectValue placeholder={t`Choose a tax year`} />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
