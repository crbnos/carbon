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
  LuMapPin,
  LuPackage,
  LuShieldCheck,
  LuSquareUser,
  LuStar,
  LuWrench
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { CustomerAvatar, Empty, Hyperlink, New, Table } from "~/components";
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

/** The asset's open service jobs: the filtered count `CUSTOMER_ASSET_COLUMNS` embeds. */
function openServiceJobCount(asset: CustomerAsset) {
  return asset.openServiceJobs?.[0]?.count ?? 0;
}

type CustomerAssetsTableProps = {
  data: CustomerAsset[];
  count: number;
  /** On a customer's page: no customer column, no customer filter. */
  customerId?: string;
};

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
          id: "openServiceJobs",
          header: t`Open Jobs`,
          enableSorting: false,
          accessorFn: openServiceJobCount,
          cell: ({ row }) => openServiceJobCount(row.original) || "—",
          meta: {
            icon: <LuWrench />
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
            disabled={!permissions.can("create", "service")}
            onClick={() =>
              navigate(
                `${path.to.newServiceJob}?customerId=${row.customerId}&customerAssetId=${row.id}`
              )
            }
          >
            <MenuIcon icon={<LuWrench />} />
            <Trans>New Service Job</Trans>
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
            <Empty
              title={<Trans>No assets</Trans>}
              description={
                <Trans>
                  Units this customer owns show here once registered.
                </Trans>
              }
            />
          ) : undefined
        }
      />
    );
  }
);
CustomerAssetsTable.displayName = "CustomerAssetsTable";

export default CustomerAssetsTable;
