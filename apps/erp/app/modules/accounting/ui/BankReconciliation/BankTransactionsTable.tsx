import { Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Table } from "~/components";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import type { BankTransactionListItem } from "../../types";

type BankTransactionsTableProps = {
  data: BankTransactionListItem[];
  currencyCode: string;
};

const STATUS_COLOR: Record<
  BankTransactionListItem["status"],
  "green" | "yellow" | "gray"
> = {
  Matched: "green",
  Unmatched: "yellow",
  Excluded: "gray"
};

const BankTransactionsTable = memo(
  ({ data, currencyCode }: BankTransactionsTableProps) => {
    const { t } = useLingui();
    const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });

    const columns = useMemo<ColumnDef<BankTransactionListItem>[]>(
      () => [
        {
          accessorKey: "postedDate",
          header: t`Date`,
          cell: ({ row }) => formatDate(row.original.postedDate)
        },
        {
          accessorKey: "description",
          header: t`Description`
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.amount))
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <Status color={STATUS_COLOR[row.original.status]}>
              {row.original.status === "Matched"
                ? t`Matched`
                : row.original.status === "Excluded"
                  ? t`Excluded`
                  : t`Unmatched`}
            </Status>
          )
        },
        {
          accessorKey: "matchType",
          header: t`Match Type`,
          cell: ({ row }) => row.original.matchType ?? "—"
        }
      ],
      [t, currencyFormatter]
    );

    return (
      <Table<BankTransactionListItem>
        data={data}
        columns={columns}
        count={data.length}
        title={t`Transactions`}
      />
    );
  }
);

BankTransactionsTable.displayName = "BankTransactionsTable";
export default BankTransactionsTable;
