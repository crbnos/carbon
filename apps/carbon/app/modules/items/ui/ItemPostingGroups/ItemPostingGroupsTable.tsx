import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { ItemPostingGroup } from "../../types";

type ItemPostingGroupsTableProps = {
  data: ItemPostingGroup[];
  count: number;
};

const ItemPostingGroupsTable = memo(
  ({ data, count }: ItemPostingGroupsTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const rows = useMemo(() => data, [data]);
    const customColumns =
      useCustomColumns<ItemPostingGroup>("itemPostingGroup");

    const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
      const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
        {
          accessorKey: "name",
          header: "Name",
          cell: ({ row }) => (
            <Enumerable
              value={row.original.name}
              onClick={() =>
                navigate(
                  `${path.to.itemPostingGroup(
                    row.original.id
                  )}?${params.toString()}`
                )
              }
              className="cursor-pointer"
            />
          ),
        },
        {
          accessorKey: "description",
          header: "Description",
          cell: (item) => item.getValue(),
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [navigate, params, customColumns]);

    const renderContextMenu = useCallback(
      (row: (typeof rows)[number]) => {
        return (
          <>
            <MenuItem
              disabled={!permissions.can("update", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.itemPostingGroup(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Item Group
            </MenuItem>
            <MenuItem
              disabled={!permissions.can("delete", "parts")}
              onClick={() => {
                navigate(
                  `${path.to.deleteItemPostingGroup(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Item Group
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<(typeof rows)[number]>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "parts") && (
            <New
              label="Posting Group"
              to={`${path.to.newItemPostingGroup}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
      />
    );
  }
);

ItemPostingGroupsTable.displayName = "ItemPostingGroupsTable";
export default ItemPostingGroupsTable;
