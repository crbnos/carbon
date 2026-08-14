import { cn } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuCircleDollarSign,
  LuLink,
  LuScale,
  LuSheet
} from "react-icons/lu";
import { DateTime, Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import type { AccountingSyncTieOutListItem } from "../../accounting.ee.service";

type SyncTieOutTableProps = {
  data: AccountingSyncTieOutListItem[];
  count: number;
  /** Active accounting integration ids — the integration filter's options. */
  integrations: string[];
  /** All (non-group) accounts — the account filter's options. */
  accounts: { id: string; number: string | null; name: string }[];
};

/** Display labels for the accounting integration ids. */
const INTEGRATION_LABELS: Record<string, string> = {
  xero: "Xero",
  quickbooks: "QuickBooks",
  rillet: "Rillet"
};

function periodLabel(
  period: AccountingSyncTieOutListItem["accountingPeriod"],
  locale: string
): string {
  if (!period) return "—";
  if (period.fiscalYear != null && period.periodNumber != null) {
    return `${period.fiscalYear}-${String(period.periodNumber).padStart(
      2,
      "0"
    )}`;
  }
  return `${formatDate(period.startDate, undefined, locale)} – ${formatDate(
    period.endDate,
    undefined,
    locale
  )}`;
}

const SyncTieOutTable = memo(
  ({ data, count, integrations, accounts }: SyncTieOutTableProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    const currencyFormatter = useCurrencyFormatter();

    const columns = useMemo<ColumnDef<AccountingSyncTieOutListItem>[]>(() => {
      const formatAmount = (value: number | null | undefined) =>
        value == null ? (
          "—"
        ) : (
          <span className="tabular-nums">
            {currencyFormatter.format(Number(value))}
          </span>
        );

      const formatDelta = (value: number | null | undefined) => {
        if (value == null) return "—";
        const nonzero = Math.abs(Number(value)) > 0.001;
        return (
          <span
            className={cn(
              "tabular-nums",
              nonzero && "font-semibold text-destructive"
            )}
          >
            {currencyFormatter.format(Number(value))}
          </span>
        );
      };

      return [
        {
          accessorKey: "accountingPeriodId",
          header: t`Period`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.accountingSyncTieOutCell(row.original.id)}>
              {periodLabel(row.original.accountingPeriod, locale)}
            </Hyperlink>
          ),
          meta: {
            icon: <LuCalendar />,
            exportValue: (row: AccountingSyncTieOutListItem) =>
              periodLabel(row.accountingPeriod, locale)
          }
        },
        {
          accessorKey: "accountId",
          header: t`Account`,
          cell: ({ row }) => (
            <div className="flex flex-col py-1">
              <span className="text-sm">
                {row.original.account?.number ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground line-clamp-1">
                {row.original.account?.name ?? "—"}
              </span>
            </div>
          ),
          meta: {
            icon: <LuSheet />,
            filter: {
              type: "static",
              options: accounts.map((account) => ({
                value: account.id,
                label: (
                  <Enumerable
                    value={[account.number, account.name]
                      .filter(Boolean)
                      .join(" - ")}
                  />
                )
              }))
            },
            exportValue: (row: AccountingSyncTieOutListItem) =>
              [row.account?.number, row.account?.name].filter(Boolean).join(" ")
          }
        },
        {
          accessorKey: "integration",
          header: t`Integration`,
          cell: ({ row }) => (
            <Enumerable
              value={
                INTEGRATION_LABELS[row.original.integration] ??
                row.original.integration
              }
            />
          ),
          meta: {
            icon: <LuLink />,
            filter: {
              type: "static",
              options: integrations.map((integration) => ({
                value: integration,
                label: (
                  <Enumerable
                    value={INTEGRATION_LABELS[integration] ?? integration}
                  />
                )
              }))
            }
          }
        },
        {
          accessorKey: "carbonPostedAmount",
          header: t`Carbon Posted`,
          cell: ({ row }) => formatAmount(row.original.carbonPostedAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "syncedAmount",
          header: t`Synced`,
          cell: ({ row }) => formatAmount(row.original.syncedAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "docBackedAmount",
          header: t`Doc-Backed`,
          cell: ({ row }) => formatAmount(row.original.docBackedAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "excludedAmount",
          header: t`Excluded`,
          cell: ({ row }) => formatAmount(row.original.excludedAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "pendingAmount",
          header: t`Pending`,
          cell: ({ row }) => formatAmount(row.original.pendingAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "blockedAmount",
          header: t`Blocked`,
          cell: ({ row }) => formatAmount(row.original.blockedAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "providerAmount",
          header: t`Provider`,
          cell: ({ row }) => formatAmount(row.original.providerAmount),
          meta: { icon: <LuCircleDollarSign /> }
        },
        {
          accessorKey: "internalDelta",
          header: t`Internal Delta`,
          cell: ({ row }) => formatDelta(row.original.internalDelta),
          meta: { icon: <LuScale /> }
        },
        {
          accessorKey: "externalDelta",
          header: t`External Delta`,
          cell: ({ row }) => formatDelta(row.original.externalDelta),
          meta: { icon: <LuScale /> }
        },
        {
          accessorKey: "computedAt",
          header: t`Computed At`,
          cell: ({ row }) => <DateTime value={row.original.computedAt} />,
          meta: { icon: <LuCalendar /> }
        }
      ];
    }, [accounts, currencyFormatter, integrations, locale, t]);

    return (
      <Table<AccountingSyncTieOutListItem>
        data={data}
        columns={columns}
        count={count}
        title={t`Sync Tie-Out`}
      />
    );
  }
);

SyncTieOutTable.displayName = "SyncTieOutTable";
export default SyncTieOutTable;
