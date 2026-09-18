import { MenuIcon, MenuItem, Status } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo } from "react";
import { LuLink, LuLink2Off } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import { usePermissions } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { BankTransactionListItem } from "../../types";

type BankTransactionsTableProps = {
  data: BankTransactionListItem[];
  currencyCode: string;
  companyBankAccountId: string;
  primaryAction?: ReactNode;
  onMatch: (transaction: BankTransactionListItem) => void;
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
  ({
    data,
    currencyCode,
    companyBankAccountId,
    primaryAction,
    onMatch
  }: BankTransactionsTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter({ currency: currencyCode });
    const unmatchFetcher = useFetcher();

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

    const renderContextMenu = useCallback(
      (row: BankTransactionListItem) => {
        if (!permissions.can("update", "accounting")) return null;

        if (row.status === "Unmatched") {
          return (
            <MenuItem onClick={() => onMatch(row)}>
              <MenuIcon icon={<LuLink />} />
              {t`Match to GL Entry`}
            </MenuItem>
          );
        }

        if (row.status === "Matched") {
          return (
            <MenuItem
              onClick={() =>
                unmatchFetcher.submit(null, {
                  method: "post",
                  action: path.to.bankTransactionUnmatch(
                    companyBankAccountId,
                    row.id
                  )
                })
              }
            >
              <MenuIcon icon={<LuLink2Off />} />
              {t`Unmatch`}
            </MenuItem>
          );
        }

        return null;
      },
      [permissions, onMatch, unmatchFetcher, companyBankAccountId, t]
    );

    return (
      <Table<BankTransactionListItem>
        data={data}
        columns={columns}
        count={data.length}
        primaryAction={primaryAction}
        renderContextMenu={renderContextMenu}
        title={t`Transactions`}
      />
    );
  }
);

BankTransactionsTable.displayName = "BankTransactionsTable";
export default BankTransactionsTable;
