// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DatePicker,
  HStack,
  Table as SimpleTable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { datetime, formatDate, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { Table } from "~/components";
import {
  useCurrencyFormatter,
  usePercentFormatter,
  useQuantityFormatter,
  useUrlParams
} from "~/hooks";
import { getLeaseLiabilities } from "~/modules/accounting/accounting.service";
import type { LeaseLiabilityRow } from "~/modules/accounting/lease-liabilities";
import { useLesseeClassificationLabel } from "~/modules/purchasing/ui/Leases";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "reports/lease-liabilities");

export const handle: Handle = {
  breadcrumb: msg`Lease Liabilities`,
  to: path.to.leaseLiabilities,
  module: "accounting"
};

// A bad bookmark must not 500 — an unparseable date falls back to the default.
function parseDateParam(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return parseDate(raw).toString();
  } catch {
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  // The lease tables' RLS is purchasing_view: without it every lease reads
  // as absent and the report would show no liability at all.
  const { client, companyId } = await requirePermissions(request, {
    view: ["accounting", "purchasing"],
    role: "employee"
  });

  const url = new URL(request.url);
  const asOf =
    parseDateParam(url.searchParams.get("asOf")) ??
    datetime.today(await getCompanyTimeZone(client, companyId)).toString();
  let from = parseDateParam(url.searchParams.get("from")) ?? undefined;
  let to = parseDateParam(url.searchParams.get("to")) ?? undefined;
  if (from && to && to < from) [from, to] = [to, from];

  const report = await getLeaseLiabilities(client, companyId, {
    asOf,
    from,
    to
  });
  // A failed query must surface, not render as "no leases".
  if (report.error || !report.data) {
    logger.error("Failed to load lease liabilities", {
      companyId,
      asOf,
      error: report.error
    });
    throw new Error(
      report.error?.message ?? "Failed to load lease liabilities"
    );
  }

  return report.data;
}

type DisplayRow = Omit<LeaseLiabilityRow, "classification"> & {
  classification: LeaseLiabilityRow["classification"] | null;
  isTotal: boolean;
};

export default function LeaseLiabilitiesRoute() {
  const {
    asOf,
    from,
    to,
    fiscalYears,
    rows,
    totals,
    costs,
    leaseRunPostedThrough,
    firstUnpostedLeaseMonth
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const formatQuantity = useQuantityFormatter();
  const classificationLabel = useLesseeClassificationLabel();

  const money = (value: number | null) =>
    value === null ? "" : currencyFormatter.format(value);
  // Rates are stored as percentage points (6 = 6 %).
  const rate = (value: number | null) =>
    value === null ? "" : percentFormatter.format(value / 100);

  // The service rows plus a grand-total row. Accumulate at full precision and
  // round once, at this display boundary.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const out: DisplayRow[] = rows.map((row) => ({ ...row, isTotal: false }));
    if (rows.length === 0) return out;
    const sum = (pick: (row: LeaseLiabilityRow) => number) =>
      round(rows.reduce((total, row) => total + pick(row), 0));
    const maturity: Record<number, number> = {};
    for (const year of fiscalYears) {
      maturity[year] = sum((row) => row.maturityByFiscalYear[year] ?? 0);
    }
    out.push({
      id: "total",
      leaseLineId: "total",
      leaseId: t`Total`,
      name: "",
      asset: "",
      supplierName: null,
      classification: null,
      // Months and rates do not add up; the summary below weights them.
      remainingMonths: 0,
      discountRate: 0,
      liability: sum((row) => row.liability),
      currentPortion: sum((row) => row.currentPortion),
      nonCurrentPortion: sum((row) => row.nonCurrentPortion),
      netRou: sum((row) => row.netRou),
      maturityByFiscalYear: maturity,
      maturityThereafter: sum((row) => row.maturityThereafter),
      undiscountedPayments: sum((row) => row.undiscountedPayments),
      isTotal: true
    });
    return out;
  }, [rows, fiscalYears, t]);

  const columns = useMemo<ColumnDef<DisplayRow>[]>(() => {
    const format = (value: number | null) =>
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
          {format(pick(row.original))}
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
        accessorKey: "leaseId",
        header: t`Lease`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            <span className="font-semibold">{row.original.leaseId}</span>
          ) : (
            <Link
              to={path.to.leaseDetails(row.original.id)}
              className="hover:underline"
            >
              {row.original.leaseId}
            </Link>
          ),
        meta: { exportValue: (row: DisplayRow) => row.leaseId }
      },
      {
        accessorKey: "name",
        header: t`Name`,
        cell: ({ row }) => row.original.name,
        meta: { exportValue: (row: DisplayRow) => row.name }
      },
      {
        accessorKey: "asset",
        header: t`Asset`,
        cell: ({ row }) => row.original.asset,
        meta: { exportValue: (row: DisplayRow) => row.asset }
      },
      {
        accessorKey: "supplierName",
        header: t`Supplier`,
        cell: ({ row }) => row.original.supplierName ?? "",
        meta: { exportValue: (row: DisplayRow) => row.supplierName ?? "" }
      },
      {
        accessorKey: "classification",
        header: t`Classification`,
        cell: ({ row }) =>
          row.original.classification
            ? classificationLabel(row.original.classification)
            : "",
        meta: {
          exportValue: (row: DisplayRow) =>
            row.classification ? classificationLabel(row.classification) : ""
        }
      },
      {
        accessorKey: "remainingMonths",
        header: t`Months Left`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            ""
          ) : (
            <span className="tabular-nums">
              {formatQuantity(row.original.remainingMonths)}
            </span>
          ),
        meta: {
          exportValue: (row: DisplayRow) =>
            row.isTotal ? null : row.remainingMonths
        }
      },
      {
        accessorKey: "discountRate",
        header: t`Rate`,
        cell: ({ row }) =>
          row.original.isTotal ? (
            ""
          ) : (
            <span className="tabular-nums">
              {percentFormatter.format(row.original.discountRate / 100)}
            </span>
          ),
        meta: {
          exportValue: (row: DisplayRow) =>
            row.isTotal ? null : row.discountRate
        }
      },
      {
        accessorKey: "liability",
        header: t`Liability`,
        cell: moneyCell((row) => row.liability),
        meta: { exportValue: (row: DisplayRow) => row.liability }
      },
      {
        accessorKey: "currentPortion",
        header: t`Current`,
        cell: moneyCell((row) => row.currentPortion),
        meta: { exportValue: (row: DisplayRow) => row.currentPortion }
      },
      {
        accessorKey: "nonCurrentPortion",
        header: t`Non-Current`,
        cell: moneyCell((row) => row.nonCurrentPortion),
        meta: { exportValue: (row: DisplayRow) => row.nonCurrentPortion }
      },
      {
        accessorKey: "netRou",
        header: t`Net ROU Asset`,
        cell: moneyCell((row) => row.netRou),
        meta: { exportValue: (row: DisplayRow) => row.netRou }
      },
      ...maturityColumns,
      {
        accessorKey: "maturityThereafter",
        header: t`Thereafter`,
        cell: moneyCell((row) => row.maturityThereafter),
        meta: { exportValue: (row: DisplayRow) => row.maturityThereafter }
      }
    ];
  }, [
    t,
    fiscalYears,
    currencyFormatter,
    percentFormatter,
    formatQuantity,
    classificationLabel
  ]);

  const [operating, finance] = [
    totals.find((total) => total.classification === "Operating"),
    totals.find((total) => total.classification === "Finance")
  ];

  const datePicker = (
    label: ReactNode,
    value: string,
    onChange: (value: string) => void
  ) => (
    <HStack>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <DatePicker
        size="sm"
        value={parseDate(value)}
        onChange={(next) => onChange(next?.toString() ?? value)}
      />
    </HStack>
  );

  const summaryRows: {
    key: string;
    label: ReactNode;
    pick: (total: NonNullable<typeof operating>) => string;
    emphasis?: boolean;
  }[] = [
    ...fiscalYears.map((year) => ({
      key: `fy-${year}`,
      label: <Trans>FY {year}</Trans>,
      pick: (total: NonNullable<typeof operating>) =>
        money(total.maturityByFiscalYear[year] ?? 0)
    })),
    {
      key: "thereafter",
      label: <Trans>Thereafter</Trans>,
      pick: (total) => money(total.maturityThereafter)
    },
    {
      key: "undiscounted",
      label: <Trans>Total undiscounted payments</Trans>,
      pick: (total) => money(total.undiscountedPayments),
      emphasis: true
    },
    {
      key: "imputed",
      label: <Trans>Less imputed interest</Trans>,
      pick: (total) => money(-total.imputedInterest)
    },
    {
      key: "liability",
      label: <Trans>Lease liability</Trans>,
      pick: (total) => money(total.liability),
      emphasis: true
    },
    {
      key: "current",
      label: <Trans>Current portion</Trans>,
      pick: (total) => money(total.currentPortion)
    },
    {
      key: "non-current",
      label: <Trans>Non-current portion</Trans>,
      pick: (total) => money(total.nonCurrentPortion)
    },
    {
      key: "net-rou",
      label: <Trans>Net right-of-use asset</Trans>,
      pick: (total) => money(total.netRou)
    },
    {
      key: "term",
      label: <Trans>Weighted-average remaining term (years)</Trans>,
      pick: (total) =>
        total.weightedAverageRemainingTermYears === null
          ? ""
          : formatQuantity(total.weightedAverageRemainingTermYears)
    },
    {
      key: "rate",
      label: <Trans>Weighted-average discount rate</Trans>,
      pick: (total) => rate(total.weightedAverageDiscountRate)
    }
  ];

  const totalLeaseCost =
    costs.operatingLeaseCost +
    costs.financeAmortization +
    costs.financeInterest +
    costs.shortTermLeaseCost +
    costs.variableLeaseCost;
  const costRows: {
    key: string;
    label: ReactNode;
    value: number;
    emphasis?: boolean;
  }[] = [
    {
      key: "operating",
      label: <Trans>Operating lease cost</Trans>,
      value: costs.operatingLeaseCost
    },
    {
      key: "finance-amortization",
      label: <Trans>Finance lease: amortization of ROU assets</Trans>,
      value: costs.financeAmortization
    },
    {
      key: "finance-interest",
      label: <Trans>Finance lease: interest on lease liabilities</Trans>,
      value: costs.financeInterest
    },
    {
      key: "short-term",
      label: <Trans>Short-term lease cost</Trans>,
      value: costs.shortTermLeaseCost
    },
    {
      key: "variable",
      label: <Trans>Variable lease cost</Trans>,
      value: costs.variableLeaseCost
    },
    {
      key: "total",
      label: <Trans>Total lease cost</Trans>,
      value: round(totalLeaseCost),
      emphasis: true
    },
    {
      key: "cash-operating",
      label: <Trans>Cash paid: operating leases</Trans>,
      value: costs.cashPaidOperating
    },
    {
      key: "cash-finance",
      label: <Trans>Cash paid: finance leases</Trans>,
      value: costs.cashPaidFinance
    }
  ];

  return (
    <VStack spacing={0} className="h-full">
      {firstUnpostedLeaseMonth && (
        <div className="w-full p-4 pb-0">
          <Alert variant="warning">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {leaseRunPostedThrough ? (
                <Trans>
                  Lease runs are posted through{" "}
                  {formatDate(leaseRunPostedThrough)}
                </Trans>
              ) : (
                <Trans>No lease run is posted yet</Trans>
              )}
            </AlertTitle>
            <AlertDescription>
              <Trans>
                The lease entries from {formatDate(firstUnpostedLeaseMonth)} to{" "}
                {formatDate(asOf)} are not in the general ledger yet. These
                figures follow the lease schedules, so they will not tie to the
                ledger until a lease run posts them.
              </Trans>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="flex-1 min-h-0 w-full">
        {/* Every row is returned at once, and search / sort / pagination are
            URL-driven server-side controls this loader does not read — turn
            them off rather than render controls that do nothing. */}
        <Table<DisplayRow>
          data={displayRows}
          columns={columns}
          count={displayRows.length}
          title={t`Lease Liabilities`}
          primaryAction={datePicker(<Trans>As of:</Trans>, asOf, (value) =>
            setParams({ asOf: value })
          )}
          withPagination={false}
          withSearch={false}
          withSimpleSorting={false}
        />
      </div>
      <div className="w-full max-h-[50%] overflow-y-auto border-t border-border bg-background p-4">
        <div className="grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Maturity Analysis</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Undiscounted payments still to come, by fiscal year, less the
                  interest the remaining months will charge.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SimpleTable>
                <Thead>
                  <Tr>
                    <Th />
                    <Th className="text-right">
                      {classificationLabel("Operating")}
                    </Th>
                    <Th className="text-right">
                      {classificationLabel("Finance")}
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {summaryRows.map((row) => (
                    <Tr key={row.key}>
                      <Td className={cn(row.emphasis && "font-semibold")}>
                        {row.label}
                      </Td>
                      <Td
                        className={cn(
                          "text-right tabular-nums",
                          row.emphasis && "font-semibold"
                        )}
                      >
                        {operating ? row.pick(operating) : ""}
                      </Td>
                      <Td
                        className={cn(
                          "text-right tabular-nums",
                          row.emphasis && "font-semibold"
                        )}
                      >
                        {finance ? row.pick(finance) : ""}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </SimpleTable>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Lease Cost</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Lease run entries and posted lease invoice lines in the
                  period.
                </Trans>
              </CardDescription>
              <HStack className="pt-2 flex-wrap">
                {datePicker(<Trans>From:</Trans>, from, (value) =>
                  setParams({ from: value })
                )}
                {datePicker(<Trans>To:</Trans>, to, (value) =>
                  setParams({ to: value })
                )}
              </HStack>
            </CardHeader>
            <CardContent>
              <SimpleTable>
                <Tbody>
                  {costRows.map((row) => (
                    <Tr key={row.key}>
                      <Td className={cn(row.emphasis && "font-semibold")}>
                        {row.label}
                      </Td>
                      <Td
                        className={cn(
                          "text-right tabular-nums",
                          row.emphasis && "font-semibold"
                        )}
                      >
                        {money(row.value)}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </SimpleTable>
            </CardContent>
          </Card>
        </div>
      </div>
    </VStack>
  );
}
