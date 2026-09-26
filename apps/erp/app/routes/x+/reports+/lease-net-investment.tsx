import { requirePermissions } from "@carbon/auth/auth.server";
import { cn, DatePicker, HStack, VStack } from "@carbon/react";
import { datetime, formatDate, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Table } from "~/components";
import { useCurrencyFormatter, useUrlParams } from "~/hooks";
import type { LeaseNetInvestmentRow } from "~/modules/accounting";
import { getLeaseNetInvestment } from "~/modules/accounting";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Net Investment in Leases`,
  to: path.to.leaseNetInvestment,
  module: "accounting"
};

// A bad bookmark must not 500 — an unparseable `asOf` falls back to today.
function parseAsOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return parseDate(raw).toString();
  } catch {
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const asOf =
    parseAsOf(url.searchParams.get("asOf")) ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();

  const report = await getLeaseNetInvestment(client, companyId, { asOf });
  // A failed query must surface, not render as "no leases".
  if (report.error) {
    throw new Error(report.error.message);
  }

  return {
    asOf,
    fiscalYears: report.data?.fiscalYears ?? [],
    rows: report.data?.rows ?? []
  };
}

type DisplayRow = {
  id: string;
  rentalAgreementId: string | null;
  agreement: string;
  customerName: string;
  fixedAssetId: string | null;
  unit: string;
  initialNetInvestment: number;
  postedPrincipal: number;
  currentNetInvestment: number;
  nextInterestDate: string | null;
  nextInterestAmount: number | null;
  maturityByFiscalYear: Record<number, number>;
  closingTarget: number;
  isTotal: boolean;
};

const toDisplayRow = (row: LeaseNetInvestmentRow): DisplayRow => ({
  id: row.id,
  rentalAgreementId: row.rentalAgreementId,
  agreement: row.rentalAgreementReadableId ?? "",
  customerName: row.customerName ?? "",
  fixedAssetId: row.fixedAssetId,
  unit: row.unit,
  initialNetInvestment: row.initialNetInvestment,
  postedPrincipal: row.postedPrincipal,
  currentNetInvestment: row.currentNetInvestment,
  nextInterestDate: row.nextInterestDate,
  nextInterestAmount: row.nextInterestAmount,
  maturityByFiscalYear: row.maturityByFiscalYear,
  closingTarget: row.closingTarget,
  isTotal: false
});

export default function LeaseNetInvestmentRoute() {
  const { asOf, fiscalYears, rows } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { locale } = useLocale();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();

  // The service rows plus a grand-total row. Accumulate at full precision and
  // round once, at this display boundary.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const out = rows.map(toDisplayRow);
    if (rows.length === 0) return out;
    const sum = (pick: (row: LeaseNetInvestmentRow) => number) =>
      round(rows.reduce((total, row) => total + pick(row), 0));
    const maturity: Record<number, number> = {};
    for (const year of fiscalYears) {
      maturity[year] = sum((row) => row.maturityByFiscalYear[year] ?? 0);
    }
    out.push({
      id: "total",
      rentalAgreementId: null,
      agreement: t`Total`,
      customerName: "",
      fixedAssetId: null,
      unit: "",
      initialNetInvestment: sum((row) => row.initialNetInvestment),
      postedPrincipal: sum((row) => row.postedPrincipal),
      currentNetInvestment: sum((row) => row.currentNetInvestment),
      nextInterestDate: null,
      // Next interest falls on different dates per lease; no total.
      nextInterestAmount: null,
      maturityByFiscalYear: maturity,
      closingTarget: sum((row) => row.closingTarget),
      isTotal: true
    });
    return out;
  }, [rows, fiscalYears, t]);

  const columns = useMemo<ColumnDef<DisplayRow>[]>(() => {
    const money = (value: number | null) =>
      value === null ? "" : currencyFormatter.format(value);
    const moneyCell =
      (pick: (row: DisplayRow) => number | null) =>
      ({ row }: { row: { original: DisplayRow } }) => (
        <span
          className={cn(
            "tabular-nums",
            row.original.isTotal && "font-semibold"
          )}
        >
          {money(pick(row.original))}
        </span>
      );

    const maturityColumns: ColumnDef<DisplayRow>[] = fiscalYears.map((year) => {
      const pick = (row: DisplayRow) => row.maturityByFiscalYear[year] ?? 0;
      return {
        id: `fy-${year}`,
        header: t`FY ${year}`,
        cell: moneyCell(pick),
        meta: { exportValue: pick }
      };
    });

    return [
      {
        accessorKey: "agreement",
        header: t`Agreement`,
        cell: ({ row }) =>
          row.original.rentalAgreementId ? (
            <Link
              to={path.to.rentalAgreementDetails(
                row.original.rentalAgreementId
              )}
              className="hover:underline"
            >
              {row.original.agreement}
            </Link>
          ) : (
            <span className="font-semibold">{row.original.agreement}</span>
          ),
        meta: { exportValue: (row: DisplayRow) => row.agreement }
      },
      {
        accessorKey: "customerName",
        header: t`Customer`,
        cell: ({ row }) => row.original.customerName,
        meta: { exportValue: (row: DisplayRow) => row.customerName }
      },
      {
        accessorKey: "unit",
        header: t`Unit`,
        cell: ({ row }) =>
          row.original.fixedAssetId ? (
            <Link
              to={path.to.fixedAsset(row.original.fixedAssetId)}
              className="hover:underline"
            >
              {row.original.unit}
            </Link>
          ) : (
            row.original.unit
          ),
        meta: { exportValue: (row: DisplayRow) => row.unit }
      },
      {
        accessorKey: "initialNetInvestment",
        header: t`At Commencement`,
        cell: moneyCell((row) => row.initialNetInvestment),
        meta: { exportValue: (row: DisplayRow) => row.initialNetInvestment }
      },
      {
        accessorKey: "postedPrincipal",
        header: t`Principal Collected`,
        cell: moneyCell((row) => row.postedPrincipal),
        meta: { exportValue: (row: DisplayRow) => row.postedPrincipal }
      },
      {
        accessorKey: "currentNetInvestment",
        header: t`Net Investment`,
        cell: moneyCell((row) => row.currentNetInvestment),
        meta: { exportValue: (row: DisplayRow) => row.currentNetInvestment }
      },
      {
        accessorKey: "nextInterestAmount",
        header: t`Next Interest`,
        cell: ({ row }) => (
          <span
            className={cn(
              "tabular-nums",
              row.original.isTotal && "font-semibold"
            )}
          >
            {money(row.original.nextInterestAmount)}
            {row.original.nextInterestDate && (
              <span className="ml-2 text-xs text-muted-foreground">
                {formatDate(row.original.nextInterestDate, undefined, locale)}
              </span>
            )}
          </span>
        ),
        meta: { exportValue: (row: DisplayRow) => row.nextInterestAmount }
      },
      ...maturityColumns,
      {
        accessorKey: "closingTarget",
        header: t`Residual and Option`,
        cell: moneyCell((row) => row.closingTarget),
        meta: { exportValue: (row: DisplayRow) => row.closingTarget }
      }
    ];
  }, [t, locale, fiscalYears, currencyFormatter]);

  const filters = (
    <HStack>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>As of:</Trans>
      </span>
      <DatePicker
        size="sm"
        value={parseDate(asOf)}
        onChange={(value) => setParams({ asOf: value?.toString() ?? asOf })}
      />
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        {/* Every row is returned at once, and search / sort / pagination are
            URL-driven server-side controls this loader does not read — turn
            them off rather than render controls that do nothing. */}
        <Table<DisplayRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Net Investment in Leases`}
          primaryAction={filters}
          withPagination={false}
          withSearch={false}
          withSimpleSorting={false}
        />
      </div>
    </VStack>
  );
}
