import { MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuOctagonX, LuPencil, LuTrash } from "react-icons/lu";
import { Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { NonConformanceType } from "../../types";

type NonConformanceTypesTableProps = {
  data: NonConformanceType[];
  count: number;
};

const NonConformanceTypesTable = memo(
  ({ data, count }: NonConformanceTypesTableProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();

    const customColumns =
      useCustomColumns<NonConformanceType>("nonConformanceType");

    const columns = useMemo<ColumnDef<NonConformanceType>[]>(() => {
      const defaultColumns: ColumnDef<NonConformanceType>[] = [
        {
          accessorKey: "name",
          header: "Non Conformance Type",
          cell: ({ row }) => (
            <Hyperlink to={row.original.id}>
              <Enumerable value={row.original.name} />
            </Hyperlink>
          ),
          meta: {
            icon: <LuOctagonX />,
          },
        },
      ];
      return [...defaultColumns, ...customColumns];
    }, [customColumns]);

    const renderContextMenu = useCallback(
      (row: NonConformanceType) => {
        return (
          <>
            <MenuItem
              onClick={() => {
                navigate(
                  `${path.to.nonConformanceType(row.id)}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuPencil />} />
              Edit Type
            </MenuItem>
            <MenuItem
              destructive
              disabled={!permissions.can("delete", "sales")}
              onClick={() => {
                navigate(
                  `${path.to.deleteNonConformanceType(
                    row.id
                  )}?${params.toString()}`
                );
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete Type
            </MenuItem>
          </>
        );
      },
      [navigate, params, permissions]
    );

    return (
      <Table<NonConformanceType>
        data={data}
        columns={columns}
        count={count}
        primaryAction={
          permissions.can("create", "quality") && (
            <New
              label="Non-Conformance Type"
              to={`${path.to.newNonConformanceType}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title="Non-Conformance Types"
      />
    );
  }
);

NonConformanceTypesTable.displayName = "NonConformanceTypesTable";
export default NonConformanceTypesTable;
