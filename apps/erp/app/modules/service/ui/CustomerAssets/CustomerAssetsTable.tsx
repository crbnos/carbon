// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClipboardList,
  LuMapPin,
  LuPackage,
  LuShieldCheck,
  LuSquareUser,
  LuStar
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, Hyperlink, New, Table } from "~/components";
import { useDateFormatter, usePermissions } from "~/hooks";
import { useCustomers } from "~/stores";
import { path } from "~/utils/path";
import { customerAssetStatuses, warrantyStatuses } from "../../service.models";
import type { CustomerAsset } from "../../types";
import {
  CustomerAssetStatus,
  useWarrantyStatusLabels,
  WarrantyBadge
} from "../ServiceStatus";

type CustomerAssetsTableProps = {
  data: CustomerAsset[];
  count: number;
  /** On a customer's page: no customer column, no customer filter. */
  customerId?: string;
};

/** The count of the asset's orders that are not Closed or Cancelled. */
export function openOrderCount(asset: { openOrders: unknown }) {
  const rows = asset.openOrders as { count: number }[] | null;
  return rows?.[0]?.count ?? 0;
}

const CustomerAssetsTable = memo(
  ({ data, count, customerId }: CustomerAssetsTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const navigate = useNavigate();
    const { formatDate } = useDateFormatter();
    const [customers] = useCustomers();
    const warrantyLabels = useWarrantyStatusLabels();

    const columns = useMemo<ColumnDef<CustomerAsset>[]>(() => {
      const all: (ColumnDef<CustomerAsset> | null)[] = [
        {
          id: "serial",
          header: t`Serial`,
          enableSorting: false,
          accessorFn: (row) => row.trackedEntity?.readableId ?? "",
          cell: ({ row }) => (
            <Hyperlink to={path.to.customerAsset(row.original.id)}>
              <span className="whitespace-nowrap">
                {row.original.trackedEntity?.readableId}
              </span>
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "itemId",
          header: t`Item`,
          cell: ({ row }) => (
            <div className="flex flex-col min-w-0">
              <span className="truncate">
                {row.original.item?.readableIdWithRevision}
              </span>
              {row.original.item?.name && (
                <span className="text-xs text-muted-foreground truncate">
                  {row.original.item.name}
                </span>
              )}
            </div>
          ),
          meta: {
            icon: <LuPackage />,
            exportValue: (row: CustomerAsset) =>
              row.item?.readableIdWithRevision ?? row.itemId
          }
        },
        customerId
          ? null
          : {
              accessorKey: "customerId",
              header: t`Customer`,
              cell: ({ row }) => (
                <CustomerAvatar customerId={row.original.customerId} />
              ),
              meta: {
                filter: {
                  type: "static",
                  options: customers?.map((customer) => ({
                    value: customer.id,
                    label: customer.name
                  }))
                },
                icon: <LuSquareUser />,
                exportValue: (row: CustomerAsset) =>
                  row.customer?.name ?? row.customerId
              }
            },
        {
          id: "site",
          header: t`Site`,
          enableSorting: false,
          accessorFn: (row) => row.customerLocation?.name ?? "",
          cell: ({ row }) => row.original.customerLocation?.name ?? "—",
          meta: {
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "shippedDate",
          header: t`Ship Date`,
          cell: (item) => formatDate(item.getValue<string>()) || "—",
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          id: "warrantyStatus",
          header: t`Warranty`,
          enableSorting: false,
          cell: ({ row }) => <WarrantyBadge asset={row.original} />,
          meta: {
            filter: {
              type: "static",
              options: warrantyStatuses.map((status) => ({
                value: status,
                label: warrantyLabels[status]
              }))
            },
            icon: <LuShieldCheck />
          }
        },
        {
          id: "openOrders",
          header: t`Open Orders`,
          enableSorting: false,
          accessorFn: (row) => openOrderCount(row),
          cell: ({ row }) => (
            <span className="tabular-nums">{openOrderCount(row.original)}</span>
          ),
          meta: {
            icon: <LuClipboardList />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <CustomerAssetStatus status={row.original.status} />
          ),
          meta: {
            filter: {
              type: "static",
              options: customerAssetStatuses.map((status) => ({
                value: status,
                label: <CustomerAssetStatus status={status} />
              }))
            },
            pluralHeader: t`Statuses`,
            icon: <LuStar />
          }
        }
      ];
      return all.filter(
        (column): column is ColumnDef<CustomerAsset> => column !== null
      );
    }, [customerId, customers, formatDate, t, warrantyLabels]);

    const renderContextMenu = useMemo(() => {
      return (row: CustomerAsset) => (
        <>
          <MenuItem onClick={() => navigate(path.to.customerAsset(row.id))}>
            <MenuIcon icon={<LuBookMarked />} />
            <Trans>View Asset</Trans>
          </MenuItem>
          <MenuItem
            disabled={
              !permissions.can("create", "service") ||
              row.status !== "In Service"
            }
            onClick={() =>
              navigate(`${path.to.newServiceOrder}?customerAssetId=${row.id}`)
            }
          >
            <MenuIcon icon={<LuClipboardList />} />
            <Trans>New Service Order</Trans>
          </MenuItem>
        </>
      );
    }, [navigate, permissions]);

    const newAssetPath = customerId
      ? `${path.to.newCustomerAsset}?customerId=${customerId}`
      : path.to.newCustomerAsset;

    return (
      <Table<CustomerAsset>
        count={count}
        columns={columns}
        data={data}
        defaultColumnPinning={{
          left: ["serial"]
        }}
        primaryAction={
          permissions.can("create", "service") && (
            <New label={t`Asset`} to={newAssetPath} />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Customer Assets`}
        table="customerAsset"
        withSavedView={!customerId}
        emptyState={
          customerId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Trans>This customer has no registered assets yet.</Trans>
            </p>
          ) : undefined
        }
      />
    );
  }
);
CustomerAssetsTable.displayName = "CustomerAssetsTable";

export default CustomerAssetsTable;
