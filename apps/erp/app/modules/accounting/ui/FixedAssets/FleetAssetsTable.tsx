import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCircleCheck,
  LuCircleDollarSign,
  LuFactory,
  LuHash,
  LuKeyRound,
  LuLayers,
  LuPackageCheck,
  LuPencil,
  LuStar,
  LuWrench
} from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import { fleetStatuses } from "../../accounting.models";
import type { getFleetAssets } from "../../accounting.service";
import FleetStatus from "./FleetStatus";

export type FleetAssetRow = NonNullable<
  Awaited<ReturnType<typeof getFleetAssets>>["data"]
>[number];

type FleetAssetsTableProps = {
  data: FleetAssetRow[];
  count: number;
  primaryAction?: ReactNode;
};

// Active or Fully Depreciated — the states in which a fleet unit is on the
// books and can be taken out of service or returned to stock.
const isOnBooks = (row: FleetAssetRow) =>
  row.status === "Active" || row.status === "Fully Depreciated";

const FleetAssetsTable = memo(
  ({ data, count, primaryAction }: FleetAssetsTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const fetcher = useFetcher();
    const permissions = usePermissions();
    const { company } = useUser();
    const currencyFormatter = useCurrencyFormatter({
      currency: company.baseCurrencyCode
    });

    const columns = useMemo<ColumnDef<FleetAssetRow>[]>(
      () => [
        {
          accessorKey: "fixedAssetId",
          header: t`Asset ID`,
          cell: ({ row }) =>
            row.original.id ? (
              <Hyperlink to={path.to.fixedAsset(row.original.id)}>
                {row.original.fixedAssetId}
              </Hyperlink>
            ) : (
              row.original.fixedAssetId
            ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "itemReadableId",
          header: t`Item`,
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span>{row.original.itemReadableId}</span>
              {row.original.itemName && (
                <span className="text-xs text-muted-foreground">
                  {row.original.itemName}
                </span>
              )}
            </div>
          ),
          meta: {
            icon: <LuBox />
          }
        },
        {
          accessorKey: "serialNumber",
          header: t`Serial Number`,
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "className",
          header: t`Asset Class`,
          cell: ({ row }) => <Enumerable value={row.original.className} />,
          meta: {
            icon: <LuLayers />
          }
        },
        {
          accessorKey: "fleetStatus",
          header: t`Status`,
          cell: ({ row }) => <FleetStatus status={row.original.fleetStatus} />,
          meta: {
            filter: {
              type: "static",
              options: fleetStatuses.map((v) => ({
                label: <FleetStatus status={v} />,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "netBookValue",
          header: t`Net Book Value`,
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.netBookValue ?? 0)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          accessorKey: "workCenterName",
          header: t`Work Center`,
          cell: ({ row }) => <Enumerable value={row.original.workCenterName} />,
          meta: {
            icon: <LuFactory />
          }
        },
        {
          accessorKey: "outOfServiceReason",
          header: t`Out of Service Reason`,
          meta: {
            icon: <LuWrench />
          }
        }
      ],
      [currencyFormatter, t]
    );

    const renderContextMenu = useCallback(
      (row: FleetAssetRow) => {
        const id = row.id;
        if (!id) return null;
        const onBooks = isOnBooks(row);
        const isOutOfService = Boolean(row.outOfServiceSince);
        const canUpdate = permissions.can("update", "accounting");
        const canCreate = permissions.can("create", "accounting");

        return (
          <>
            <MenuItem
              disabled={!permissions.can("view", "accounting")}
              onClick={() => navigate(path.to.fixedAsset(id))}
            >
              <MenuIcon icon={<LuPencil />} />
              <Trans>View Asset</Trans>
            </MenuItem>
            {row.fleetStatus === "Available" && (
              <MenuItem
                disabled={!permissions.can("create", "sales")}
                onClick={() =>
                  navigate(`${path.to.newRentalAgreement}?fixedAssetId=${id}`)
                }
              >
                <MenuIcon icon={<LuKeyRound />} />
                <Trans>Rent</Trans>
              </MenuItem>
            )}
            {isOutOfService ? (
              <MenuItem
                disabled={!canUpdate}
                onClick={() =>
                  fetcher.submit(
                    {},
                    {
                      method: "post",
                      action: `${path.to.fixedAssetOutOfService(id)}?intent=return`
                    }
                  )
                }
              >
                <MenuIcon icon={<LuCircleCheck />} />
                <Trans>Return to Service</Trans>
              </MenuItem>
            ) : (
              onBooks &&
              row.fleetStatus !== "On Rent" && (
                <MenuItem
                  disabled={!canUpdate}
                  onClick={() => navigate(path.to.fixedAssetOutOfService(id))}
                >
                  <MenuIcon icon={<LuWrench />} />
                  <Trans>Take Out of Service</Trans>
                </MenuItem>
              )
            )}
            {/* A unit on a live rental line is returned from its agreement. */}
            {row.itemId &&
              onBooks &&
              row.fleetStatus !== "On Rent" &&
              row.fleetStatus !== "Reserved" && (
                <MenuItem
                  disabled={!canCreate}
                  onClick={() =>
                    navigate(path.to.fixedAssetReturnToInventory(id))
                  }
                >
                  <MenuIcon icon={<LuPackageCheck />} />
                  <Trans>Return to Inventory</Trans>
                </MenuItem>
              )}
          </>
        );
      },
      [fetcher, navigate, permissions]
    );

    return (
      <Table<FleetAssetRow>
        data={data}
        columns={columns}
        count={count}
        primaryAction={primaryAction}
        renderContextMenu={renderContextMenu}
        title={t`Fleet`}
      />
    );
  }
);

FleetAssetsTable.displayName = "FleetAssetsTable";
export default FleetAssetsTable;
