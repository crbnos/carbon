import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuHash, LuText } from "react-icons/lu";
import { Link } from "react-router";
import { Table } from "~/components";
import { useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { TrialBalanceRow } from "../../types";

type TrialBalanceTableProps = {
  data: TrialBalanceRow[];
  count: number;
};

function formatCurrency(value: number): string {
  if (!value) return "-";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Four-column trial balance (SAP F0996 handoff form): Opening | Period | Closing
// balance pairs, each debit/credit column footing to an equal total. Rendered on
// the shared Table so CSV export is automatic.
const TrialBalanceTable = memo(({ data, count }: TrialBalanceTableProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();

  const columns = useMemo<ColumnDef<TrialBalanceRow>[]>(() => {
    const window = new URLSearchParams(params);
    window.delete("offset");
    const qs = window.toString();

    const amountColumn = (
      key: keyof TrialBalanceRow,
      header: string
    ): ColumnDef<TrialBalanceRow> => ({
      accessorKey: key as string,
      header,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(Number(row.original[key] ?? 0))}
        </span>
      ),
      size: 130,
      meta: {
        renderTotal: true,
        formatter: (val) => formatCurrency(Number(val))
      }
    });

    return [
      {
        accessorKey: "accountNumber",
        header: t`Account`,
        cell: ({ row }) => (
          <Link
            to={`${path.to.generalLedger}?accountId=${row.original.accountId}${
              qs ? `&${qs}` : ""
            }`}
            className="font-mono text-muted-foreground hover:text-foreground hover:underline"
          >
            {row.original.accountNumber}
          </Link>
        ),
        size: 100,
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "accountName",
        header: t`Name`,
        cell: ({ row }) => row.original.accountName,
        meta: { icon: <LuText /> }
      },
      amountColumn("openingDebit", t`Opening Debit`),
      amountColumn("openingCredit", t`Opening Credit`),
      amountColumn("periodDebits", t`Period Debits`),
      amountColumn("periodCredits", t`Period Credits`),
      amountColumn("debitBalance", t`Closing Debit`),
      amountColumn("creditBalance", t`Closing Credit`),
      amountColumn("netChange", t`Net Change`)
    ];
  }, [params, t]);

  return (
    <Table<TrialBalanceRow>
      data={data}
      columns={columns}
      count={count}
      withSimpleSorting={false}
      title={t`Trial Balance`}
    />
  );
});

TrialBalanceTable.displayName = "TrialBalanceTable";
export default TrialBalanceTable;
