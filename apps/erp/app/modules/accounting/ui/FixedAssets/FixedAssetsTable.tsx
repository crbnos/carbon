import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuBuilding2,
  LuCircleDollarSign,
  LuHash,
  LuLayers,
  LuMapPin,
  LuPencil,
  LuStar,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import { fixedAssetStatuses } from "../../accounting.models";
import type { FixedAssetListItem } from "../../types";
import FixedAssetStatus from "./FixedAssetStatus";

type FixedAssetsTableProps = {
  data: FixedAssetListItem[];
  count: number;
  assetClasses: { id: string; name: string }[];
  primaryAction?: ReactNode;
};

const FixedAssetsTable = memo(
  ({ data, count, assetClasses, primaryAction }: FixedAssetsTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const { company } = useUser();
    const currencyFormatter = useCurrencyFormatter({
      currency: company.baseCurrencyCode
    });
    const locations = useLocations();
    const [selectedAsset, setSelectedAsset] =
      useState<FixedAssetListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<FixedAssetListItem>[]>(
      () => [
        {
          accessorKey: "fixedAssetId",
          header: "Asset ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.fixedAsset(row.original.id)}>
              {row.original.fixedAssetId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          accessorKey: "name",
          header: "Name",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "serialNumber",
          header: "Serial Number",
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <FixedAssetStatus
              status={
                row.original.status as (typeof fixedAssetStatuses)[number]
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: fixedAssetStatuses.map((v) => ({
                label: <FixedAssetStatus status={v} />,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "fixedAssetClassId",
          header: "Asset Class",
          cell: ({ row }) => {
            const cls = row.original.fixedAssetClass as {
              id: string;
              name: string;
            } | null;
            return <Enumerable value={cls?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: assetClasses.map((c) => ({
                label: <Enumerable value={c.name} />,
                value: c.id
              }))
            },
            icon: <LuLayers />
          }
        },
        {
          accessorKey: "location.name",
          header: "Location",
          cell: ({ row }) => {
            const loc = (row.original as any).location as {
              id: string;
              name: string;
            } | null;
            return <Enumerable value={loc?.name ?? null} />;
          },
          meta: {
            filter: {
              type: "static",
              options: locations.map((l) => ({
                label: <Enumerable value={l.label} />,
                value: l.label
              }))
            },
            icon: <LuMapPin />
          }
        },
        {
          accessorKey: "acquisitionCost",
          header: "Acquisition Cost",
          cell: ({ row }) =>
            currencyFormatter.format(Number(row.original.acquisitionCost)),
          meta: {
            icon: <LuCircleDollarSign />
          }
        },
        {
          id: "netBookValue",
          header: "Net Book Value",
          cell: ({ row }) => {
            const nbv =
              Number(row.original.acquisitionCost) -
              Number(row.original.accumulatedDepreciation);
            return currencyFormatter.format(nbv);
          },
          meta: {
            icon: <LuCircleDollarSign />
          }
        }
      ],
      [assetClasses, currencyFormatter, locations]
    );

    const renderContextMenu = useCallback(
      (row: FixedAssetListItem) => {
        const isDraft = row.status === "Draft";
        return (
          <>
            <MenuItem
              disabled={!permissions.can("view", "accounting")}
              onClick={() => navigate(path.to.fixedAsset(row.id))}
            >
              <MenuIcon icon={<LuPencil />} />
              {isDraft ? "Edit Asset" : "View Asset"}
            </MenuItem>
            {isDraft && (
              <MenuItem
                disabled={!permissions.can("delete", "accounting")}
                destructive
                onClick={() => {
                  setSelectedAsset(row);
                  deleteModal.onOpen();
                }}
              >
                <MenuIcon icon={<LuTrash />} />
                Delete Asset
              </MenuItem>
            )}
          </>
        );
      },
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<FixedAssetListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title="Fixed Assets"
        />
        {selectedAsset && (
          <ConfirmDelete
            action={path.to.deleteFixedAsset(selectedAsset.id)}
            isOpen={deleteModal.isOpen}
            name={selectedAsset.fixedAssetId}
            text={`Are you sure you want to delete ${selectedAsset.fixedAssetId}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedAsset(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedAsset(null);
            }}
          />
        )}
      </>
    );
  }
);

FixedAssetsTable.displayName = "FixedAssetsTable";
export default FixedAssetsTable;
