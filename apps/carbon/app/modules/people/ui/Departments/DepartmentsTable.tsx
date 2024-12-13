import { HStack, MenuIcon, MenuItem } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import { LuBuilding, LuPencil, LuTrash } from "react-icons/lu";
import { New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { useCustomColumns } from "~/hooks/useCustomColumns";
import { path } from "~/utils/path";
import type { Department } from "../../types";

type DepartmentsTableProps = {
  data: Department[];
  count: number;
};

const DepartmentsTable = memo(({ data, count }: DepartmentsTableProps) => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [params] = useUrlParams();

  const rows = data.map((row) => ({
    ...row,
    parentDepartment:
      (Array.isArray(row.department)
        ? row.department.map((d) => d.name).join(", ")
        : row.department?.name) ?? "",
  }));

  const customColumns = useCustomColumns<(typeof rows)[number]>("department");
  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(() => {
    const defaultColumns: ColumnDef<(typeof rows)[number]>[] = [
      {
        accessorKey: "name",
        header: "Department",
        cell: ({ row }) => (
          <Enumerable
            value={row.original.name}
            onClick={() => navigate(row.original.id)}
            className="cursor-pointer"
          />
        ),
        meta: {
          icon: <LuBuilding />,
        },
      },
      {
        header: "Sub-Departments",
        cell: ({ row }) => (
          <HStack>
            {row.original.parentDepartment.split(", ").map((v) => (
              <Enumerable key={v} value={v} />
            ))}
          </HStack>
        ),
        meta: {
          icon: <LuBuilding />,
        },
      },
    ];
    return [...defaultColumns, ...customColumns];
  }, [navigate, customColumns]);

  const renderContextMenu = useCallback(
    (row: (typeof data)[number]) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(`${path.to.department(row.id)}?${params.toString()}`);
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Department
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "people")}
            onClick={() => {
              navigate(
                `${path.to.deleteDepartment(row.id)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Department
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<(typeof rows)[number]>
      data={rows}
      count={count}
      columns={columns}
      primaryAction={
        permissions.can("create", "people") && (
          <New label="Department" to={`new?${params.toString()}`} />
        )
      }
      renderContextMenu={renderContextMenu}
    />
  );
});

DepartmentsTable.displayName = "DepartmentsTable";
export default DepartmentsTable;
