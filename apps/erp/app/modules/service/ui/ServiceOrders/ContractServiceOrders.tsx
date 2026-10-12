// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DateTime, Empty, Hyperlink, Table } from "~/components";
import { setupGridHeight } from "~/components/Setup";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { ServiceOrderStatus as ServiceOrderStatusType } from "../../service.models";
import { ServiceOrderStatus } from "../ServiceStatus";

export type ContractServiceOrderRow = {
  id: string;
  serviceOrderId: string;
  status: ServiceOrderStatusType;
  serial: string | null;
  customerAssetId: string | null;
  site: string | null;
  createdAt: string;
  completedAt: string | null;
  /** The order's posted cost, or null when it could not be read. */
  actual: number | null;
  /** What has been billed, or null when the contract has no project. */
  billed: number | null;
};

/**
 * The service orders a customer contract covers, one row each, with the cost
 * posted to each order and what has been billed (base currency).
 */
export default function ContractServiceOrders({
  rows
}: {
  rows: ContractServiceOrderRow[];
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();

  const columns = useMemo<ColumnDef<ContractServiceOrderRow>[]>(() => {
    const money = (value: number | null) =>
      value === null ? "—" : formatMoney.format(value);
    return [
      {
        accessorKey: "serviceOrderId",
        size: 120,
        header: t`Service Order`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.serviceOrderDetails(row.original.id)}>
            <span className="whitespace-nowrap">
              {row.original.serviceOrderId}
            </span>
          </Hyperlink>
        )
      },
      {
        accessorKey: "status",
        size: 112,
        header: t`Status`,
        cell: ({ row }) => <ServiceOrderStatus status={row.original.status} />
      },
      {
        accessorKey: "serial",
        size: 136,
        header: t`Serial`,
        cell: ({ row }) => {
          const serial = (
            <span className="whitespace-nowrap">
              {row.original.serial ?? "—"}
            </span>
          );
          return row.original.customerAssetId ? (
            <Hyperlink to={path.to.customerAsset(row.original.customerAssetId)}>
              {serial}
            </Hyperlink>
          ) : (
            serial
          );
        }
      },
      {
        accessorKey: "site",
        size: 120,
        header: t`Site`,
        cell: ({ row }) => (
          <span className="block truncate">{row.original.site ?? "—"}</span>
        )
      },
      {
        accessorKey: "createdAt",
        size: 112,
        header: t`Created`,
        cell: ({ row }) => (
          <DateTime value={row.original.createdAt} variant="date" />
        )
      },
      {
        accessorKey: "completedAt",
        size: 112,
        header: t`Completed`,
        cell: ({ row }) => (
          <DateTime
            value={row.original.completedAt}
            variant="date"
            fallback="—"
          />
        )
      },
      {
        accessorKey: "actual",
        size: 120,
        header: () => (
          <span className="block text-right">
            <Trans>Actual Cost</Trans>
          </span>
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {money(row.original.actual)}
          </span>
        )
      },
      {
        accessorKey: "billed",
        size: 112,
        header: () => (
          <span className="block text-right">
            <Trans>Billed</Trans>
          </span>
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {money(row.original.billed)}
          </span>
        )
      }
    ];
  }, [formatMoney, t]);

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
      style={{
        height: rows.length === 0 ? 320 : setupGridHeight(rows.length) + 12
      }}
    >
      <Table<ContractServiceOrderRow>
        compact
        title={t`Service Orders`}
        columns={columns}
        data={rows}
        count={rows.length}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
        emptyState={
          <Empty
            title={<Trans>No service orders</Trans>}
            description={
              <Trans>
                Service orders that name this contract for coverage show here.
              </Trans>
            }
          />
        }
      />
    </div>
  );
}
