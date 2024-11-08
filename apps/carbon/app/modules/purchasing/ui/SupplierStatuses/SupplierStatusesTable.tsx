import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { BsPeopleFill } from "react-icons/bs";
import { LuPencil, LuStar, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { SupplierStatus } from "~/modules/purchasing";
import { path } from "~/utils/path";

type SupplierStatusesTableProps = {
  data: SupplierStatus[];
  count: number;
};

const SupplierStatusesTable = memo(
  ({ data, count }: SupplierStatusesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<SupplierStatus>("supplierStatus");
    const columns = useMemo<ColumnDef<SupplierStatus>[]>(() => {
      const defaultColumns: ColumnDef<SupplierStatus>[] = [
        {
          accessorKey: "name",
          header: "Supplier Status",
          cell: ({ row }) => (
            <Enumerable
              value={row.original.name}
              onClick={() =>
                navigate(`${row.original.id}?${params.toString()}`)
              }
              className="cursor-pointer"
            />
          ),
          meta: {
            icon: <LuStar />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [navigate, params, customColumns]);

    const renderContextMenu = useCallback(
      (row: SupplierStatus) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(`${path.to.suppliers}?filter=status:eq:${row.name}`);
              }}
            >
              <MenuIcon icon={<BsPeopleFill />} />
              View Suppliers
            </MenuItem>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.supplierStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Supplier Status
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "purchasing")}
              onClick={() => {
                navigate(
                  `${path.to.deleteSupplierStatus(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Supplier Status
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<SupplierStatus>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "purchasing") && (
            <New
              label="Supplier Status"
              to={`${path.to.newSupplierStatus}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

SupplierStatusesTable.displayName = "SupplierStatusesTable";
export default SupplierStatusesTable;
