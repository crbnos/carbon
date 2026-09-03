import type { Database } from "@carbon/database";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCircleDot,
  LuCoins,
  LuCreditCard,
  LuHash,
  LuStore,
  LuUser
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import {
  cardTransactionStatus,
  cardTransactionType
} from "../../invoicing.models";
import CardTransactionStatus from "./CardTransactionStatus";

type CardTransactionRow =
  Database["public"]["Tables"]["cardTransaction"]["Row"];

type CardTransactionsTableProps = {
  data: CardTransactionRow[];
  count: number;
};

const CardTransactionsTable = memo(
  ({ data, count }: CardTransactionsTableProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    const currencyFormatter = useCurrencyFormatter();

    const columns = useMemo<ColumnDef<CardTransactionRow>[]>(
      () => [
        {
          accessorKey: "cardTransactionId",
          header: t`Transaction ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.cardTransaction(row.original.id)}>
              {row.original.cardTransactionId}
            </Hyperlink>
          ),
          meta: { icon: <LuHash /> }
        },
        {
          accessorKey: "type",
          header: t`Type`,
          cell: ({ row }) => <Enumerable value={row.original.type} />,
          meta: {
            icon: <LuCircleDot />,
            filter: {
              type: "static",
              options: cardTransactionType.map((type) => ({
                value: type,
                label: <Enumerable value={type} />
              }))
            },
            pluralHeader: t`Types`
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <CardTransactionStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuCircleDot />,
            filter: {
              type: "static",
              options: cardTransactionStatus.map((status) => ({
                value: status,
                label: <CardTransactionStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`
          }
        },
        {
          accessorKey: "transactionDate",
          header: t`Transaction Date`,
          cell: (item) =>
            formatDate(item.getValue<string>(), undefined, locale),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "merchantName",
          header: t`Merchant`,
          cell: ({ row }) => row.original.merchantName ?? null,
          meta: { icon: <LuStore /> }
        },
        {
          accessorKey: "cardHolderName",
          header: t`Card Holder`,
          cell: ({ row }) => row.original.cardHolderName ?? null,
          meta: { icon: <LuUser /> }
        },
        {
          accessorKey: "amount",
          header: t`Amount`,
          cell: (item) => (
            <span className="tabular-nums">
              {currencyFormatter.format(item.getValue<number>())}
            </span>
          ),
          meta: {
            icon: <LuCoins />,
            renderTotal: true,
            formatter: currencyFormatter.format
          }
        },
        {
          accessorKey: "journalId",
          header: t`Journal`,
          cell: ({ row }) => row.original.journalId ?? null,
          meta: { icon: <LuCreditCard /> }
        }
      ],
      [t, locale, currencyFormatter]
    );

    return (
      <Table<CardTransactionRow>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{ left: ["cardTransactionId"] }}
        defaultColumnVisibility={{
          journalId: false
        }}
        title={t`Card Transactions`}
        table="cardTransaction"
        withSavedView
      />
    );
  }
);

CardTransactionsTable.displayName = "CardTransactionsTable";

export default CardTransactionsTable;
