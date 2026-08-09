import { Badge, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import {
  CustomerAvatar,
  PeriodSelector,
  SupplierAvatar,
  Table
} from "~/components";
import { useCurrencyFormatter } from "~/hooks";
import type { SpendByPartyRow } from "~/modules/invoicing";

type SpendByPartyReportProps = {
  kind: "customer" | "supplier";
  data: SpendByPartyRow[];
  /** Fiscal year start month (1-12) — drives the PeriodSelector presets. */
  fiscalStartMonth: number;
};

// A row shaped for the table: the party id lives under the accessor key the CSV
// export knows how to resolve to a name (`customerId` / `supplierId`).
type SpendDisplayRow = SpendByPartyRow & {
  customerId?: string;
  supplierId?: string;
};

function formatVariance(variance: number): string {
  return `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%`;
}

/**
 * Revenue by Customer / Expenses by Supplier. One row per party, summing issued
 * invoices over the selected period, with a period-over-period variance badge.
 * The period is driven by the shared `range` PeriodSelector (startDate/endDate
 * URL params), the same control the income statement and balance sheet use.
 */
export default function SpendByPartyReport({
  kind,
  data,
  fiscalStartMonth
}: SpendByPartyReportProps) {
  const { t } = useLingui();
  const currencyFormatter = useCurrencyFormatter();

  const rows = useMemo<SpendDisplayRow[]>(
    () =>
      data.map((row) => ({
        ...row,
        [kind === "customer" ? "customerId" : "supplierId"]: row.partyId
      })),
    [data, kind]
  );

  const columns = useMemo<ColumnDef<SpendDisplayRow>[]>(() => {
    return [
      {
        accessorKey: kind === "customer" ? "customerId" : "supplierId",
        header: kind === "customer" ? t`Customer` : t`Supplier`,
        cell: ({ row }) =>
          kind === "customer" ? (
            <CustomerAvatar customerId={row.original.partyId} />
          ) : (
            <SupplierAvatar supplierId={row.original.partyId} />
          )
      },
      {
        accessorKey: "total",
        header: t`Total Spend`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(row.original.total))}
          </span>
        ),
        meta: {
          exportValue: (row: SpendDisplayRow) => Number(row.total)
        }
      },
      {
        accessorKey: "variance",
        header: t`Variance`,
        cell: ({ row }) => {
          const { variance } = row.original;
          if (variance === null) {
            return <Badge variant="gray">{t`New`}</Badge>;
          }
          return (
            <Badge variant={variance >= 0 ? "green" : "red"}>
              {formatVariance(variance)}
            </Badge>
          );
        },
        meta: {
          exportValue: (row: SpendDisplayRow) =>
            row.variance === null ? t`New` : formatVariance(row.variance)
        }
      }
    ];
  }, [kind, t, currencyFormatter]);

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex-1 w-full">
        <Table<SpendDisplayRow>
          data={rows}
          columns={columns}
          count={rows.length}
          title={
            kind === "customer"
              ? t`Revenue by Customer`
              : t`Expenses by Supplier`
          }
          primaryAction={
            <PeriodSelector
              variant="range"
              fiscalStartMonth={fiscalStartMonth}
            />
          }
        />
      </div>
    </VStack>
  );
}
