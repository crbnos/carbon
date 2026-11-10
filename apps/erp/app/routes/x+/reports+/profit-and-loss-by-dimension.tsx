// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { Combobox, cn, DatePicker, HStack, VStack } from "@carbon/react";
import { datetime, defaultReportRange, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Table } from "~/components";
import { useCurrencyFormatter, useUrlParams } from "~/hooks";
import {
  getProfitAndLossByDimension,
  type ProfitAndLossDimensionAccount
} from "~/modules/accounting/accounting.service";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { getDatabaseClient } from "~/services/database.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`P&L by Custom Dimension`,
  to: path.to.profitAndLossByDimension,
  module: "accounting"
};

function validDate(value: string | null): string | null {
  if (!value) return null;
  try {
    return parseDate(value).toString();
  } catch {
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "accounting", role: "employee" }
  );
  const params = new URL(request.url).searchParams;
  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const defaultRange = defaultReportRange(today);
  const startDate =
    validDate(params.get("startDate")) ?? defaultRange.startDate;
  const endDate = validDate(params.get("endDate")) ?? defaultRange.endDate;
  const report = await getProfitAndLossByDimension(getDatabaseClient(), {
    companyId,
    companyGroupId,
    startDate,
    endDate,
    dimensionId: params.get("dimensionId")
  });
  return { ...report, startDate, endDate };
}

const UNASSIGNED = "__unassigned__";
const TOTAL = "__total__";

type ReportRow = {
  id: string;
  label: string;
  section: "Revenue" | "Expense" | "Profit";
  isTotal: boolean;
  amounts: Record<string, number>;
};

function sumAmounts(rows: ReportRow[]): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, amount] of Object.entries(row.amounts)) {
      amounts[key] = (amounts[key] ?? 0) + amount;
    }
  }
  return amounts;
}

function reportRows(accounts: ProfitAndLossDimensionAccount[]): ReportRow[] {
  const byAccount = new Map<string, ReportRow>();
  for (const account of accounts) {
    let row = byAccount.get(account.accountId);
    if (!row) {
      row = {
        id: account.accountId,
        label: [account.accountNumber, account.accountName]
          .filter(Boolean)
          .join(" · "),
        section: account.accountClass,
        isTotal: false,
        amounts: {}
      };
      byAccount.set(account.accountId, row);
    }
    const key = account.valueId ?? UNASSIGNED;
    row.amounts[key] = (row.amounts[key] ?? 0) + account.amount;
    row.amounts[TOTAL] = (row.amounts[TOTAL] ?? 0) + account.amount;
  }

  const revenue = [...byAccount.values()].filter(
    (row) => row.section === "Revenue"
  );
  const expense = [...byAccount.values()].filter(
    (row) => row.section === "Expense"
  );
  const revenueTotals = sumAmounts(revenue);
  const expenseTotals = sumAmounts(expense);
  const profit: Record<string, number> = {};
  for (const key of new Set([
    ...Object.keys(revenueTotals),
    ...Object.keys(expenseTotals)
  ])) {
    profit[key] = (revenueTotals[key] ?? 0) - (expenseTotals[key] ?? 0);
  }
  return [
    ...revenue,
    {
      id: "revenue-total",
      label: "Total Revenue",
      section: "Revenue",
      isTotal: true,
      amounts: revenueTotals
    },
    ...expense,
    {
      id: "expense-total",
      label: "Total Expenses",
      section: "Expense",
      isTotal: true,
      amounts: expenseTotals
    },
    {
      id: "profit-total",
      label: "Net Profit",
      section: "Profit",
      isTotal: true,
      amounts: profit
    }
  ];
}

export default function ProfitAndLossByDimensionRoute() {
  const {
    dimensions,
    selectedDimension,
    values,
    accounts,
    startDate,
    endDate
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const [, setParams] = useUrlParams();
  const currencyFormatter = useCurrencyFormatter();
  const rows = useMemo(() => reportRows(accounts), [accounts]);
  const columns = useMemo<ColumnDef<ReportRow>[]>(() => {
    const moneyColumn = (id: string, label: string): ColumnDef<ReportRow> => ({
      id,
      header: label,
      accessorFn: (row) => row.amounts[id] ?? 0,
      cell: ({ row }) => (
        <span
          className={cn(
            "tabular-nums whitespace-nowrap",
            row.original.isTotal && "font-semibold"
          )}
        >
          {currencyFormatter.format(round(row.original.amounts[id] ?? 0))}
        </span>
      ),
      meta: { exportValue: (row: ReportRow) => row.amounts[id] ?? 0 }
    });
    return [
      {
        id: "account",
        header: t`Account`,
        accessorFn: (row) => row.label,
        cell: ({ row }) => (
          <span className={cn(row.original.isTotal && "font-semibold")}>
            {row.original.id === "revenue-total"
              ? t`Total Revenue`
              : row.original.id === "expense-total"
                ? t`Total Expenses`
                : row.original.id === "profit-total"
                  ? t`Net Profit`
                  : row.original.label}
          </span>
        )
      },
      ...values.map((value) => moneyColumn(value.id, value.name)),
      moneyColumn(UNASSIGNED, t`Unassigned`),
      moneyColumn(TOTAL, t`Total`)
    ];
  }, [values, t, currencyFormatter]);

  const filters = (
    <HStack spacing={2} className="flex-wrap">
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>From:</Trans>
      </span>
      <DatePicker
        size="sm"
        aria-label={t`Start date`}
        value={parseDate(startDate)}
        onChange={(value) =>
          setParams({ startDate: value?.toString() ?? startDate })
        }
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <Trans>To:</Trans>
      </span>
      <DatePicker
        size="sm"
        aria-label={t`End date`}
        value={parseDate(endDate)}
        onChange={(value) =>
          setParams({ endDate: value?.toString() ?? endDate })
        }
      />
      {selectedDimension && (
        <Combobox
          aria-label={t`Custom dimension`}
          className="min-w-44"
          value={selectedDimension.id}
          options={dimensions.map((dimension) => ({
            value: dimension.id,
            label: dimension.name
          }))}
          onChange={(dimensionId) => setParams({ dimensionId })}
        />
      )}
    </HStack>
  );

  return (
    <VStack spacing={0} className="h-full">
      {!selectedDimension ? (
        <div className="p-6 text-sm text-muted-foreground">
          <Trans>Create a Custom dimension to view this report.</Trans>
        </div>
      ) : (
        <div className="flex-1 w-full">
          <Table<ReportRow>
            data={rows}
            columns={columns}
            count={rows.length}
            title={t`P&L by Custom Dimension`}
            primaryAction={filters}
            withPagination={false}
            withSearch={false}
            withSimpleSorting={false}
          />
        </div>
      )}
    </VStack>
  );
}
