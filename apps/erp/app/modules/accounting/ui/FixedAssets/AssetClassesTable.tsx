import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuPencil,
  LuPercent,
  LuTrash
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { FixedAssetClassListItem } from "../../types";

type AssetClassesTableProps = {
  data: FixedAssetClassListItem[];
  count: number;
  taxDepreciationEnabled: boolean;
  primaryAction?: ReactNode;
};

function formatBookDepreciation(row: FixedAssetClassListItem): string {
  const method = row.depreciationMethod;
  const life = row.usefulLifeMonths;
  const residual = row.residualValuePercent;

  const years = life ? Math.round((life / 12) * 10) / 10 : null;
  const lifeStr = years ? `${years}yr` : "";
  const residualStr =
    residual && Number(residual) > 0 ? `, ${residual}% residual` : "";

  return `${method}, ${lifeStr}${residualStr}`;
}

function formatTaxDepreciation(row: FixedAssetClassListItem): string {
  const method = (row as any).taxDepreciationMethod;
  if (!method) return "Same as Book";

  if (method === "MACRS") {
    const cls = (row as any).macrsPropertyClass;
    return cls ? `MACRS ${cls}-Year` : "MACRS";
  }

  const life = (row as any).taxUsefulLifeMonths;
  const years = life ? Math.round((life / 12) * 10) / 10 : null;
  const lifeStr = years ? `, ${years}yr` : "";
  return `${method}${lifeStr}`;
}

const AssetClassesTable = memo(
  ({
    data,
    count,
    taxDepreciationEnabled,
    primaryAction
  }: AssetClassesTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selectedClass, setSelectedClass] =
      useState<FixedAssetClassListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<FixedAssetClassListItem>[]>(() => {
      const cols: ColumnDef<FixedAssetClassListItem>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Hyperlink to={path.to.assetClass(row.original.id)}>
              <Enumerable
                value={row.original.name}
                className="cursor-pointer"
              />
            </Hyperlink>
          ),
          meta: {
            icon: <LuBookMarked />
          }
        },
        {
          id: "bookDepreciation",
          header: "Book Depreciation",
          cell: ({ row }) => formatBookDepreciation(row.original),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];

      if (taxDepreciationEnabled) {
        cols.push({
          id: "taxDepreciation",
          header: "Tax Depreciation",
          cell: ({ row }) => formatTaxDepreciation(row.original),
          meta: {
            icon: <LuPercent />
          }
        });
      }

      return cols;
    }, [taxDepreciationEnabled]);

    const renderContextMenu = useCallback(
      (row: FixedAssetClassListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("update", "accounting")}
            onClick={() => navigate(path.to.assetClass(row.id))}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Asset Class
          </MenuItem>
          <MenuItem
            disabled={!permissions.can("delete", "accounting")}
            destructive
            onClick={() => {
              setSelectedClass(row);
              deleteModal.onOpen();
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Asset Class
          </MenuItem>
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<FixedAssetClassListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title="Asset Classes"
        />
        {selectedClass && (
          <ConfirmDelete
            action={path.to.deleteAssetClass(selectedClass.id)}
            isOpen={deleteModal.isOpen}
            name={selectedClass.name}
            text={`Are you sure you want to delete the asset class: ${selectedClass.name}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedClass(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedClass(null);
            }}
          />
        )}
      </>
    );
  }
);

AssetClassesTable.displayName = "AssetClassesTable";
export default AssetClassesTable;
