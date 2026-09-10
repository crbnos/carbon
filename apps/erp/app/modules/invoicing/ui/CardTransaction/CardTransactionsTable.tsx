import type { Database } from "@carbon/database";
import { formatDate, formatMoney } from "@carbon/utils";
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
import { useCurrencyDecimalsLookup } from "~/hooks";
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
    // Each transaction carries its own currencyCode (a company can hold cards in
    // several currencies), so the amount is formatted per row from a decimals
    // lookup rather than a single-currency hook — and there is no cross-currency
    // total, which would sum unlike units into a meaningless number.
    const currencyDecimals = useCurrencyDecimalsLookup();

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
          cell: ({ row }) => {
            const code = row.original.currencyCode || "USD";
            return (
              <span className="tabular-nums">
                {formatMoney(
                  row.original.amount,
                  locale,
                  code,
                  currencyDecimals(code)
                )}
              </span>
            );
          },
          meta: {
            icon: <LuCoins />
          }
        },
        {
          accessorKey: "journalId",
          header: t`Journal`,
          cell: ({ row }) => row.original.journalId ?? null,
          meta: { icon: <LuCreditCard /> }
        }
      ],
      [t, locale, currencyDecimals]
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
