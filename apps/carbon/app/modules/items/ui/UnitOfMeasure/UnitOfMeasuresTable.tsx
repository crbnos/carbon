import { Enumerable, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import type { UnitOfMeasure } from "~/modules/items";
import { path } from "~/utils/path";

type UnitOfMeasuresTableProps = {
  data: UnitOfMeasure[];
  count: number;
};

const UnitOfMeasuresTable = memo(
  ({ data, count }: UnitOfMeasuresTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns = useCustomColumns<UnitOfMeasure>("unitOfMeasure");
    const columns = useMemo<ColumnDef<(typeof data)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof data)[number]>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Enumerable
              onClick={() => navigate(row.original.id)}
              value={row.original.name}
              className="cursor-pointer"
            />
          ),
        },
        {
          accessorKey: "code",
          header: "Code",
          cell: (item) => item.getValue(),
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [navigate, customColumns]);

    const renderContextMenu = useCallback(
      (row: (typeof data)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(`${path.to.uom(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Unit of Measure
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                navigate(`${path.to.deleteUom(row.id)}?${params.toString()}`);
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Unit of Measure
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof data)[number]>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label="Unit of Measure"
              to={`${path.to.newUom}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

UnitOfMeasuresTable.displayName = "UnitOfMeasuresTable";
export default UnitOfMeasuresTable;
