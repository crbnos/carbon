import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuHash, LuText } from "react-icons/lu";
import { Table } from "~/components";

type TrialBalanceRow = {
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  accountClass: string | null;
  incomeBalance: string | null;
  debitBalance: number;
  creditBalance: number;
  netChange: number;
  translatedDebit?: number;
  translatedCredit?: number;
};

type TrialBalanceTableProps = {
  data: TrialBalanceRow[];
  count: number;
  showTranslated?: boolean;
  parentCurrency?: string | null;
};

function formatCurrency(value: number): string {
  if (value === 0) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

const TrialBalanceTable = memo(
  ({
    data,
    count,
    showTranslated = false,
    parentCurrency
  }: TrialBalanceTableProps) => {
    const { t } = useLingui();
    const columns = useMemo<ColumnDef<TrialBalanceRow>[]>(() => {
      const cols: ColumnDef<TrialBalanceRow>[] = [
        {
          accessorKey: "accountNumber",
          header: t`Account`,
          cell: ({ row }) => (
            <span className="font-mono text-muted-foreground">
              {row.original.accountNumber}
            </span>
          ),
          size: 100,
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "accountName",
          header: t`Name`,
          cell: ({ row }) => row.original.accountName,
          meta: {
            icon: <LuText />
          }
        },
        {
          accessorKey: "debitBalance",
          header: t`Debit`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatCurrency(row.original.debitBalance)}
            </span>
          ),
          size: 150,
          meta: {
            renderTotal: true,
            formatter: (val) => formatCurrency(Number(val))
          }
        },
        {
          accessorKey: "creditBalance",
          header: t`Credit`,
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatCurrency(row.original.creditBalance)}
            </span>
          ),
          size: 150,
          meta: {
            renderTotal: true,
            formatter: (val) => formatCurrency(Number(val))
          }
        }
      ];

      if (showTranslated) {
        cols.push(
          {
            accessorKey: "translatedDebit",
            header: t`Debit (${parentCurrency ?? "Translated"})`,
            cell: ({ row }) => (
              <span className="tabular-nums">
                {formatCurrency(row.original.translatedDebit ?? 0)}
              </span>
            ),
            size: 150,
            meta: {
              renderTotal: true,
              formatter: (val) => formatCurrency(Number(val))
            }
          },
          {
            accessorKey: "translatedCredit",
            header: t`Credit (${parentCurrency ?? "Translated"})`,
            cell: ({ row }) => (
              <span className="tabular-nums">
                {formatCurrency(row.original.translatedCredit ?? 0)}
              </span>
            ),
            size: 150,
            meta: {
              renderTotal: true,
              formatter: (val) => formatCurrency(Number(val))
            }
          }
        );
      }

      cols.push({
        accessorKey: "netChange",
        header: t`Net Change`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.netChange)}
          </span>
        ),
        size: 150,
        meta: {
          renderTotal: true,
          formatter: (val) => formatCurrency(Number(val))
        }
      });

      return cols;
    }, [showTranslated, parentCurrency, t]);

    return (
      <Table<TrialBalanceRow>
        data={data}
        columns={columns}
        count={count}
        withSimpleSorting={false}
        title={t`Trial Balance`}
      />
    );
  }
);

TrialBalanceTable.displayName = "TrialBalanceTable";
export default TrialBalanceTable;
