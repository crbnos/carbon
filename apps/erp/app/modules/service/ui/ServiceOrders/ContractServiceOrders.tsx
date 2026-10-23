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
  /** The planned start of the order's next unfinished visit. */
  scheduledAt: string | null;
  /** The order's posted cost, or null when it could not be read. */
  actual: number | null;
};

/**
 * The service orders a customer contract covers, one row each: the order, its
 * status, the customer asset, the next visit and the cost posted to it (base
 * currency). The site, dates and billing live on the service order page.
 */
export default function ContractServiceOrders({
  rows
}: {
  rows: ContractServiceOrderRow[];
}) {
  const { t } = useLingui();
  const formatMoney = useCurrencyFormatter();

  const columns = useMemo<ColumnDef<ContractServiceOrderRow>[]>(
    () => [
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
        size: 144,
        header: t`Customer Asset`,
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
        accessorKey: "scheduledAt",
        size: 120,
        header: t`Scheduled`,
        cell: ({ row }) => (
          <DateTime
            value={row.original.scheduledAt}
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
            <Trans>Total Cost</Trans>
          </span>
        ),
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.actual === null
              ? "—"
              : formatMoney.format(row.original.actual)}
          </span>
        )
      }
    ],
    [formatMoney, t]
  );

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
